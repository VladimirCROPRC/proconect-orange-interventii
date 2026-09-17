import { configureDrive, createDriveAuthorization, getDriveStatus, syncAllDriveData } from "../../google-drive-server";
import { isManagementRole } from "../../project-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    return Response.json(await getDriveStatus(request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Proconect Drive status error:", error instanceof Error ? error.message : "Unknown Drive status failure");
    return Response.json({ error: "Starea Google Drive nu este disponibilă momentan." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    const body = await request.json() as { action?: unknown; clientId?: unknown; clientSecret?: unknown };

    if (body.action === "configure") {
      if (typeof body.clientId !== "string" || typeof body.clientSecret !== "string") {
        return Response.json({ error: "Completează Client ID și Client Secret." }, { status: 400 });
      }
      const result = await configureDrive(body.clientId, body.clientSecret);
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ configured: true });
    }

    if (body.action === "authorize") {
      const result = await createDriveAuthorization(request, session.userId);
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result);
    }

    if (body.action === "sync") {
      const result = await syncAllDriveData();
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result);
    }

    return Response.json({ error: "Operațiunea Google Drive nu este validă." }, { status: 400 });
  } catch (error) {
    console.error("Proconect Drive operation error:", error instanceof Error ? error.message : "Unknown Drive operation failure");
    return Response.json({ error: error instanceof Error ? error.message : "Operațiunea Google Drive nu a putut fi finalizată." }, { status: 503 });
  }
}
