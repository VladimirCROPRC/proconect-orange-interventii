import { currentSession, ensureInitialAccounts, expiredSessionCookie, sameOrigin, signIn, signOut, updatePassword } from "../../server-auth";

export const dynamic = "force-dynamic";

function unexpectedError(error: unknown) {
  console.error("Proconect authentication error:", error instanceof Error ? error.message : "Unknown authentication failure");
  return Response.json({ error: "Autentificarea nu este disponibilă momentan. Încearcă din nou." }, { status: 503 });
}

export async function GET(request: Request) {
  try {
    await ensureInitialAccounts();
    const session = await currentSession(request);
    return Response.json({ authenticated: Boolean(session), account: session?.account ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return unexpectedError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    await ensureInitialAccounts();
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    if (typeof body.username !== "string" || typeof body.password !== "string" || body.username.length > 80 || body.password.length > 256) {
      return Response.json({ error: "Completează username-ul și parola." }, { status: 400 });
    }

    const result = await signIn(body.username, body.password);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ authenticated: true, account: result.account }, { headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" } });
  } catch (error) {
    return unexpectedError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password !== "string" || body.password.length > 256) {
      return Response.json({ error: "Completează noua parolă." }, { status: 400 });
    }
    const result = await updatePassword(request, body.password);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ authenticated: true, account: result.account }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return unexpectedError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    await signOut(request);
    return Response.json({ authenticated: false }, { headers: { "Set-Cookie": expiredSessionCookie(), "Cache-Control": "no-store" } });
  } catch (error) {
    return unexpectedError(error);
  }
}
