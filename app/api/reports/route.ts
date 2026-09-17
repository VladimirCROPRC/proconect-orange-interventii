import { getAuthorizedProject, isManagementRole, readReport, writeReport } from "../../project-server";
import { syncReportIfConnected } from "../../backup-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId || !(await getAuthorizedProject(projectId, session.account))) return Response.json({ error: "Proiect indisponibil." }, { status: 404 });
    return Response.json({ saved: await readReport(projectId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Raportul nu este disponibil momentan." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const body = (await request.json()) as { projectId?: unknown; report?: unknown };
    if (typeof body.projectId !== "string" || !body.report || typeof body.report !== "object") {
      return Response.json({ error: "Raportul transmis nu este valid." }, { status: 400 });
    }
    if (!(await getAuthorizedProject(body.projectId, session.account))) return Response.json({ error: "Proiect indisponibil." }, { status: 404 });
    const result = await writeReport(body.projectId, body.report as Record<string, string>, session.account);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    try {
      await syncReportIfConnected(body.projectId);
    } catch (error) {
      console.error("Proconect Drive report sync error:", error instanceof Error ? error.message : "Unknown Drive report sync failure");
    }
    return Response.json(result);
  } catch {
    return Response.json({ error: "Raportul nu a putut fi salvat." }, { status: 503 });
  }
}
