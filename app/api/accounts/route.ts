import { addAccount, currentSession, listAccounts, sameOrigin, type AppRole } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    return Response.json({ accounts: await listAccounts() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Conturile nu sunt disponibile momentan." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });

    const body = (await request.json()) as { username?: unknown; name?: unknown; role?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.name !== "string" || typeof body.role !== "string" || typeof body.password !== "string") {
      return Response.json({ error: "Completează toate câmpurile utilizatorului." }, { status: 400 });
    }

    const result = await addAccount({ username: body.username, name: body.name, role: body.role as AppRole, password: body.password });
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ account: result.account }, { status: 201 });
  } catch {
    return Response.json({ error: "Contul nu a putut fi creat." }, { status: 503 });
  }
}
