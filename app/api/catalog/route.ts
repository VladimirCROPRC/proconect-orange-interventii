import { addCpe, isManagementRole, updateCpe } from "../../project-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const body = (await request.json()) as { name?: unknown; requiresGrounding?: unknown };
    if (typeof body.name !== "string" || typeof body.requiresGrounding !== "boolean") return Response.json({ error: "Completează denumirea și regula de împământare a echipamentului." }, { status: 400 });
    const result = await addCpe(body.name, body.requiresGrounding);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result, { status: 201 });
  } catch {
    return Response.json({ error: "Echipamentul nu a putut fi salvat." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului.", status: 403 });
    const body = (await request.json()) as { previousName?: unknown; name?: unknown; requiresGrounding?: unknown };
    if (typeof body.previousName !== "string" || typeof body.name !== "string" || typeof body.requiresGrounding !== "boolean") {
      return Response.json({ error: "Completează denumirea și regula de împământare a echipamentului." }, { status: 400 });
    }
    const result = await updateCpe(body.previousName, body.name, body.requiresGrounding);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  } catch (error) {
    console.error("Proconect catalog update error:", error instanceof Error ? error.message : "Unknown catalog update failure");
    return Response.json({ error: "Echipamentul nu a putut fi actualizat." }, { status: 503 });
  }
}
