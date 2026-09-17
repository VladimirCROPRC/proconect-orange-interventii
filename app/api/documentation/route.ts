import { saveFieldDocumentation } from "../../project-server";
import { syncReportIfConnected } from "../../backup-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const body = (await request.json()) as { projectId?: unknown; section?: unknown; content?: unknown };
    if (typeof body.projectId !== "string" || typeof body.section !== "string" || !body.content || typeof body.content !== "object") {
      return Response.json({ error: "Documentația transmisă nu este validă." }, { status: 400 });
    }
    const result = await saveFieldDocumentation(body.projectId, body.section, body.content, session.account);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    try { await syncReportIfConnected(body.projectId); } catch { console.error("Drive report refresh requires retry"); }
    return Response.json({ documentation: result.documentation, ...(result.project ? { project: result.project } : {}) });
  } catch (error) {
    console.error("Proconect field documentation error:", error instanceof Error ? error.message : "Unknown documentation failure");
    return Response.json({ error: "Documentația nu a putut fi salvată." }, { status: 503 });
  }
}
