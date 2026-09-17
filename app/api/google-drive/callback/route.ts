import { finishDriveAuthorization, syncAllDriveData } from "../../../google-drive-server";
import { isManagementRole } from "../../../project-server";
import { currentSession } from "../../../server-auth";

export const dynamic = "force-dynamic";

function redirectToDrive(request: Request, key: "drive" | "drive_error", value: string) {
  const destination = new URL("/", request.url);
  destination.searchParams.set(key, value);
  return Response.redirect(destination.toString(), 303);
}

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired || !isManagementRole(session.account)) {
      return redirectToDrive(request, "drive_error", "Sesiunea a expirat. Autentifică-te și repetă autorizarea Google.");
    }
    const query = new URL(request.url).searchParams;
    if (query.get("error")) return redirectToDrive(request, "drive_error", "Accesul Google Drive nu a fost aprobat.");
    const code = query.get("code");
    const state = query.get("state");
    if (!code || !state) return redirectToDrive(request, "drive_error", "Răspunsul de autorizare Google este incomplet.");

    await finishDriveAuthorization(request, session.userId, session.account.username, state, code);
    try {
      await syncAllDriveData();
    } catch (error) {
      console.error("Proconect initial Drive sync error:", error instanceof Error ? error.message : "Unknown Drive sync failure");
    }
    return redirectToDrive(request, "drive", "connected");
  } catch (error) {
    console.error("Proconect Drive callback error:", error instanceof Error ? error.message : "Unknown Google callback failure");
    return redirectToDrive(request, "drive_error", error instanceof Error ? error.message : "Google Drive nu a putut fi conectat.");
  }
}
