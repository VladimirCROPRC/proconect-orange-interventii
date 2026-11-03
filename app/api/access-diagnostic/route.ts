export const dynamic = "force-dynamic";

function hasCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const prefix = `${name}=`;
  return cookie.split(";").some((part) => part.trim().startsWith(prefix));
}

export async function GET(request: Request) {
  return Response.json({
    accessEmailHeader: Boolean(request.headers.get("cf-access-authenticated-user-email")),
    accessJwtHeader: Boolean(request.headers.get("cf-access-jwt-assertion")),
    accessCookie: hasCookie(request, "CF_Authorization"),
    forwardedProto: request.headers.get("x-forwarded-proto") ?? "",
    forwardedHost: request.headers.get("x-forwarded-host") ?? "",
    host: request.headers.get("host") ?? "",
  }, { headers: { "Cache-Control": "no-store" } });
}
