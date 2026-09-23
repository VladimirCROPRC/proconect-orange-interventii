import { currentSession } from "../../server-auth";

export const dynamic = "force-dynamic";

type OroKind = "site" | "junction";
type OroResult = { kind: OroKind; id: string; code: string; name: string; owner: string; lat: number; lon: number };
type SiteCode = { c?: unknown; n?: unknown; p?: unknown };
type GeoFeature = { geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };

const ORO_ORIGIN = "https://oro.proconect.online";
const SITE_CODES_URL = `${ORO_ORIGIN}/site-codes.json`;
const JUNCTIONS_URL = `${ORO_ORIGIN}/layers/orange-jonctiuni-oro.geojson`;
const MAX_RESULTS = 25;

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("ro").trim();
}

function text(value: unknown, maximum = 240) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : typeof value === "number" ? String(value).slice(0, maximum) : "";
}

function cachedFetch(url: string) {
  return fetch(url, {
    headers: { Accept: "application/json" },
    cf: { cacheEverything: true, cacheTtl: 3600 },
    signal: AbortSignal.timeout(25_000),
  } as RequestInit & { cf: { cacheEverything: boolean; cacheTtl: number } });
}

async function searchSites(query: string) {
  const response = await cachedFetch(SITE_CODES_URL);
  if (!response.ok) throw new Error(`Registrul site-urilor ORO nu răspunde (${response.status}).`);
  const rows = await response.json() as SiteCode[];
  const matches: OroResult[] = [];
  for (const row of rows) {
    const code = text(row.c, 100);
    const name = text(row.n, 300);
    const coordinates = Array.isArray(row.p) ? row.p : [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!normalized(code).includes(query) && !normalized(name).includes(query)) continue;
    matches.push({ kind: "site", id: code, code, name: name || code, owner: "", lat, lon });
    if (matches.length >= MAX_RESULTS) break;
  }
  return matches;
}

function junctionResult(feature: GeoFeature, query: string): OroResult | null {
  if (feature.geometry?.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) return null;
  const [rawLon, rawLat] = feature.geometry.coordinates;
  const lon = Number(rawLon);
  const lat = Number(rawLat);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const properties = feature.properties ?? {};
  const code = text(properties["ORO Alias"] ?? properties.rec_id ?? properties.n, 120);
  const name = text(properties.Nume ?? properties.n ?? properties.tip ?? code, 300);
  const owner = text(properties.Owner ?? properties.proprietar ?? properties.pr, 180);
  const id = text(properties.rec_id ?? code, 120);
  if (!code || (!normalized(code).includes(query) && !normalized(name).includes(query) && !normalized(owner).includes(query))) return null;
  return { kind: "junction", id: id || code, code, name: name || code, owner, lat, lon };
}

async function searchJunctions(query: string) {
  const response = await cachedFetch(JUNCTIONS_URL);
  if (!response.ok || !response.body) throw new Error(`Registrul joncțiunilor ORO nu răspunde (${response.status}).`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const matches: OroResult[] = [];
  let prelude = "";
  let started = false;
  let collecting = false;
  let object = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  function consume(value: string) {
    let input = value;
    if (!started) {
      prelude += input;
      const marker = prelude.indexOf('"features"');
      if (marker < 0) {
        prelude = prelude.slice(-32);
        return;
      }
      const bracket = prelude.indexOf("[", marker);
      if (bracket < 0) return;
      input = prelude.slice(bracket + 1);
      prelude = "";
      started = true;
    }
    for (const character of input) {
      if (!collecting) {
        if (character !== "{") continue;
        collecting = true;
        object = "{";
        depth = 1;
        inString = false;
        escaped = false;
        continue;
      }
      object += character;
      if (escaped) { escaped = false; continue; }
      if (character === "\\" && inString) { escaped = true; continue; }
      if (character === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      if (depth !== 0) continue;
      collecting = false;
      try {
        const result = junctionResult(JSON.parse(object) as GeoFeature, query);
        if (result) matches.push(result);
      } catch { /* Ignore malformed source features. */ }
      object = "";
      if (matches.length >= MAX_RESULTS) break;
    }
  }

  try {
    while (matches.length < MAX_RESULTS) {
      const chunk = await reader.read();
      if (chunk.done) break;
      consume(decoder.decode(chunk.value, { stream: true }));
    }
  } finally {
    if (matches.length >= MAX_RESULTS) await reader.cancel().catch(() => undefined);
  }
  return matches;
}

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const url = new URL(request.url);
    const kind = url.searchParams.get("type") === "junction" ? "junction" : "site";
    const query = normalized(url.searchParams.get("q"));
    if (query.length < 2 || query.length > 100) return Response.json({ error: "Introdu minimum două caractere." }, { status: 400 });
    const results = kind === "junction" ? await searchJunctions(query) : await searchSites(query);
    return Response.json({ results }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    console.error("ORO lookup failed:", error instanceof Error ? error.message : "Unknown error");
    return Response.json({ error: "Registrul ORO nu este disponibil momentan." }, { status: 503 });
  }
}
