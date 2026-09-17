import { finishOneDrive } from "../../../onedrive-server";
import { currentSession } from "../../../server-auth";
export const dynamic = "force-dynamic";

function safeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const tokenCode = message.match(/^MICROSOFT_TOKEN:(invalid_client|invalid_grant|invalid_scope|unauthorized_client|interaction_required|temporarily_unavailable|network|other)$/)?.[1];
  if (tokenCode) return `token-${tokenCode}`;
  const stage = message.match(/^ONEDRIVE_STAGE:(state-db|state-decrypt|token|drive|connection-db|root|folder|save-db)$/)?.[1];
  if (stage) return `stage-${stage}`;
  if (message.includes("Microsoft a refuzat autorizarea")) return "token";
  if (message.includes("sincronizarea în fundal")) return "offline";
  if (message.includes("OneDrive de serviciu")) return "business";
  if (message.includes("Este conectat alt OneDrive")) return "different-drive";
  if (message.includes("Autorizarea a expirat")) return "state";
  if (message.includes("OneDrive:")) return "graph";
  if (message.includes("Configurarea OneDrive")) return "config";
  return "callback";
}

export async function GET(request: Request) {
  let result = "callback";
  try {
    const session = await currentSession(request);
    const query = new URL(request.url).searchParams;
    if (!session || session.account.role !== "Admin" || session.account.passwordResetRequired) {
      result = "session";
    } else if (query.has("error")) {
      result = "microsoft-denied";
    } else if (!query.get("state") || !query.get("code")) {
      result = "response";
    } else {
      await finishOneDrive(session.sessionId, query.get("state")!, query.get("code")!);
      result = "connected";
    }
  } catch (error) {
    // Only expose a fixed category. Never log or return authorization codes,
    // tokens, client secrets, raw Microsoft payloads, or exception details.
    result = safeFailure(error);
  }
  return new Response(null, { status: 303, headers: { Location: `/?onedrive=${result}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
