import { env } from "cloudflare:workers";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

type ContractorRow = {
  id: string;
  name: string;
  users: number;
};

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

async function requireAdmin(request: Request) {
  const session = await currentSession(request);
  if (!session || session.account.passwordResetRequired) {
    return { response: Response.json({ error: "Autentificare necesară." }, { status: 401 }) };
  }
  if (session.account.role !== "Admin") {
    return { response: Response.json({ error: "Acces rezervat administratorului." }, { status: 403 }) };
  }
  return { session };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ("response" in auth) return auth.response;

    const result = await database()
      .prepare(
        "SELECT contractors.id, contractors.name, COUNT(CASE WHEN trim(technician_contractors.contractor) <> '' THEN 1 END) AS users FROM contractors LEFT JOIN technician_contractors ON lower(trim(technician_contractors.contractor)) = lower(contractors.name) GROUP BY contractors.id, contractors.name ORDER BY contractors.name COLLATE NOCASE",
      )
      .all<ContractorRow>();

    return Response.json({ contractors: result.results ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Contractorii nu sunt disponibili momentan." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const auth = await requireAdmin(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 160) : "";
    if (name.length < 2) return Response.json({ error: "Denumirea contractorului trebuie să conțină minimum 2 caractere." }, { status: 400 });

    const existing = await database().prepare("SELECT id FROM contractors WHERE lower(name) = lower(?) LIMIT 1").bind(name).first();
    if (existing) return Response.json({ error: "Contractorul există deja." }, { status: 409 });

    const contractor = { id: crypto.randomUUID(), name, users: 0 };
    await database().prepare("INSERT INTO contractors (id, name, created_at) VALUES (?, ?, ?)").bind(contractor.id, contractor.name, Date.now()).run();
    return Response.json({ contractor }, { status: 201 });
  } catch {
    return Response.json({ error: "Contractorul nu a putut fi creat." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const auth = await requireAdmin(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const contractor = await database().prepare("SELECT id, name FROM contractors WHERE id = ? LIMIT 1").bind(id).first<{ id: string; name: string }>();
    if (!contractor) return Response.json({ error: "Contractorul nu există." }, { status: 404 });

    const usage = await database()
      .prepare("SELECT COUNT(*) AS count FROM technician_contractors WHERE lower(trim(contractor)) = lower(?) AND trim(contractor) <> ''")
      .bind(contractor.name)
      .first<{ count: number }>();
    if (Number(usage?.count ?? 0) > 0) {
      return Response.json({ error: "Contractorul este asociat unor tehnicieni. Elimină mai întâi asocierile." }, { status: 409 });
    }

    await database().prepare("DELETE FROM contractors WHERE id = ?").bind(id).run();
    return Response.json({ id: contractor.id });
  } catch {
    return Response.json({ error: "Contractorul nu a putut fi șters." }, { status: 503 });
  }
}
