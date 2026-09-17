import { env } from "cloudflare:workers";
import { getRawDb } from "../../../db";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

type SiteRow = [code: string, description: string, region: string, lat: number, lon: number];
type StorageEnvironment = {
  BUCKET?: {
    put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
    get(key: string): Promise<{ text(): Promise<string> } | null>;
    delete(key: string): Promise<void>;
  };
};
const storage = env as unknown as StorageEnvironment;

function validRow(value: unknown): value is SiteRow {
  if (!Array.isArray(value) || value.length !== 5) return false;
  const [code, description, region, lat, lon] = value;
  return typeof code === "string" && Boolean(code.trim()) &&
    typeof description === "string" && typeof region === "string" &&
    typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lon === "number" && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

async function activeSites(marker: string) {
  if (marker.startsWith("r2:")) {
    const object = await storage.BUCKET?.get(marker.slice(3));
    if (!object) throw new Error("Active map sites object is missing from R2");
    return JSON.parse(await object.text()) as SiteRow[];
  }
  if (!marker.startsWith("chunked:")) return JSON.parse(marker) as SiteRow[];
  const generation = marker.slice("chunked:".length);
  const chunks = await getRawDb()
    .prepare("SELECT content_json FROM map_site_dataset_chunks WHERE generation = ? ORDER BY chunk_index ASC")
    .bind(generation)
    .all<{ content_json: string }>();
  if (!(chunks.results?.length)) throw new Error("Active map site chunks are missing");
  return chunks.results.flatMap((chunk) => JSON.parse(chunk.content_json) as SiteRow[]);
}

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const row = await getRawDb().prepare("SELECT source_name, content_json, site_count, rejected_count, updated_at FROM map_site_dataset WHERE id = 'active'").first<{
      source_name: string; content_json: string; site_count: number; rejected_count: number; updated_at: number;
    }>();
    if (!row) return Response.json({ configured: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const sites = await activeSites(row.content_json);
    return Response.json({
      configured: true,
      source: row.source_name,
      valid: row.site_count,
      rejected: { import: row.rejected_count },
      schema: ["code", "description", "region", "lat", "lon"],
      sites,
      updatedAt: row.updated_at,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Map sites read error:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Lista site-urilor nu este disponibilă." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let stage = "validare";
  let newKey = "";
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Importul este rezervat administratorului." }, { status: 403 });
    if (!storage.BUCKET) return Response.json({ error: "Bucket-ul R2 nu este configurat pentru Worker." }, { status: 503 });

    const body = await request.json() as { source?: unknown; sites?: unknown; rejected?: unknown };
    if (typeof body.source !== "string" || !Array.isArray(body.sites)) return Response.json({ error: "Fișierul importat nu este valid." }, { status: 400 });
    if (!body.sites.length || body.sites.length > 250_000) return Response.json({ error: "Lista trebuie să conțină între 1 și 250.000 de site-uri." }, { status: 400 });
    if (!body.sites.every(validRow)) return Response.json({ error: "Lista conține coordonate sau câmpuri invalide." }, { status: 400 });

    const sites = (body.sites as SiteRow[]).map(([code, description, region, lat, lon]) =>
      [code.trim().slice(0, 120), description.trim().slice(0, 300), region.trim().slice(0, 160), lat, lon] as SiteRow
    );
    const rejected = typeof body.rejected === "number" && Number.isInteger(body.rejected) && body.rejected >= 0 ? body.rejected : 0;
    const generation = crypto.randomUUID();
    newKey = `system/map-sites/${generation}.json`;

    stage = "salvarea în R2";
    await storage.BUCKET.put(newKey, JSON.stringify(sites), { httpMetadata: { contentType: "application/json" } });

    stage = "activarea listei";
    const now = Date.now();
    const previous = await getRawDb().prepare("SELECT content_json FROM map_site_dataset WHERE id = 'active'").first<{ content_json: string }>();
    await getRawDb().prepare(
      "INSERT INTO map_site_dataset (id, source_name, content_json, site_count, rejected_count, updated_by, updated_at) VALUES ('active', ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_name = excluded.source_name, content_json = excluded.content_json, site_count = excluded.site_count, rejected_count = excluded.rejected_count, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
    ).bind(body.source.trim().slice(0, 240), `r2:${newKey}`, sites.length, rejected, session.account.username, now).run();

    if (previous?.content_json.startsWith("r2:")) {
      storage.BUCKET.delete(previous.content_json.slice(3)).catch(() => undefined);
    } else if (previous?.content_json.startsWith("chunked:")) {
      const oldGeneration = previous.content_json.slice("chunked:".length);
      getRawDb().prepare("DELETE FROM map_site_dataset_chunks WHERE generation = ?").bind(oldGeneration).run().catch(() => undefined);
    }
    return Response.json({ source: body.source, valid: sites.length, rejected, updatedAt: now });
  } catch (error) {
    if (newKey && stage !== "activarea listei") storage.BUCKET?.delete(newKey).catch(() => undefined);
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error(`Map sites import error during ${stage}:`, detail);
    return Response.json({ error: `Importul a eșuat la „${stage}”. ${detail.slice(0, 180)}` }, { status: 503 });
  }
}
