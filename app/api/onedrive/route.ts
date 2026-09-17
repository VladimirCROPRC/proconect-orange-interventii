import { beginOneDrive, disconnectOneDrive, drainOneDrive, oneDriveSameOrigin, oneDriveStatus, retryOneDrive, setBackupMode } from "../../onedrive-server";
import { currentSession } from "../../server-auth";
export const dynamic = "force-dynamic";
async function authorized(request: Request) {
  const session = await currentSession(request);
  if (!session || session.account.passwordResetRequired) return { response: Response.json({ error: "Autentificare necesară." }, { status: 401 }) };
  if (session.account.role !== "Admin") return { response: Response.json({ error: "Acces rezervat administratorului." }, { status: 403 }) };
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
    const auth = await authorized(request); if (auth.response) return auth.response;
    if (!oneDriveSameOrigin(request)) return Response.json({ error: "Origine neautorizată sau PROCONECT_APP_URL neconfigurat." }, { status: 403 });
    const body = await request.json() as { action?: string; mode?: unknown };
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
