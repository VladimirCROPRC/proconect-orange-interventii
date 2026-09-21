import { beginOneDrive, disconnectOneDrive, drainOneDrive, oneDriveSameOrigin, oneDriveStatus, previewOrangeMail, retryOneDrive, setBackupMode, syncOneDriveProject } from "../../onedrive-server";
import { currentSession } from "../../server-auth";
export const dynamic = "force-dynamic";
async function authorized(request: Request) {
  const session = await currentSession(request);
  if (!session || session.account.passwordResetRequired) return { response: Response.json({ error: "Autentificare necesară." }, { status: 401 }) };
  if (session.account.role !== "Admin") return { response: Response.json({ error: "Acces rezervat administratorului." }, { status: 403 }) };
  return { session };
}
async function authenticated(request: Request) {
  const session = await currentSession(request);
  if (!session || session.account.passwordResetRequired) return { response: Response.json({ error: "Autentificare necesară." }, { status: 401 }) };
  return { session };
}
export async function GET(request: Request) {
  try {
    const auth = await authorized(request); if (auth.response) return auth.response;
    return Response.json(await oneDriveStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Starea OneDrive nu este disponibilă. Verifică migrarea bazei de date și configurarea Cloudflare." }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    const auth = await authenticated(request); if (auth.response) return auth.response;
    if (!oneDriveSameOrigin(request)) return Response.json({ error: "Origine neautorizată sau PROCONECT_APP_URL neconfigurat." }, { status: 403 });
    const body = await request.json() as { action?: string; mode?: unknown; projectId?: unknown; restart?: unknown };
    if (body.action === "sync-project") {
      if (!["Admin", "Manager", "Coordonator"].includes(auth.session!.account.role)) return Response.json({ error: "Acces rezervat coordonatorilor și managerilor." }, { status: 403 });
      const projectSync = await syncOneDriveProject(body.projectId, body.restart === true);
      return Response.json({ projectSync }, { headers: { "Cache-Control": "no-store" } });
    }
    if (auth.session!.account.role !== "Admin") return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    if (body.action === "preview-mail") {
      try { return Response.json(await previewOrangeMail(), { headers: { "Cache-Control": "no-store" } }); }
      catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Mesajele nu au putut fi citite." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
    }
    switch (body.action) {
      case "authorize": return Response.json({ authorizationUrl: await beginOneDrive(auth.session!.sessionId) }, { headers: { "Cache-Control": "no-store" } });
      case "mode": await setBackupMode(body.mode); break;
      case "disconnect": await disconnectOneDrive(); break;
      case "retry": await retryOneDrive(); break;
      case "process": await drainOneDrive(); break;
      default: return Response.json({ error: "Operațiune invalidă." }, { status: 400 });
    }
    return Response.json(await oneDriveStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Operațiunea nu a reușit. Verifică setările, conectarea OneDrive și aprobarea IT. Nicio parolă Microsoft nu trebuie introdusă în aplicație." }, { status: 503 });
  }
}
