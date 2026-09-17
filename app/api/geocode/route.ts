import { currentSession } from "../../server-auth";

export const dynamic = "force-dynamic";

type NominatimResult = {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
};

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });

    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 3 || query.length > 180) return Response.json({ error: "Introdu o adresă validă." }, { status: 400 });

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "ro");
    url.searchParams.set("addressdetails", "0");
    url.searchParams.set("q", query);

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Proconect-B2B/1.0 (https://proconect.online)",
      },
    });
    if (!response.ok) return Response.json({ error: "Serviciul de căutare a adreselor nu este disponibil momentan." }, { status: 502 });

    const payload = await response.json() as NominatimResult[];
    const results = payload.flatMap((item) => {
      const lat = typeof item.lat === "string" ? Number(item.lat) : Number.NaN;
      const lon = typeof item.lon === "string" ? Number(item.lon) : Number.NaN;
      const title = typeof item.display_name === "string" ? item.display_name.trim() : "";
      return title && Number.isFinite(lat) && Number.isFinite(lon) ? [{ title, lat, lon }] : [];
    });
    return Response.json({ results }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch {
    return Response.json({ error: "Adresa nu a putut fi căutată momentan." }, { status: 503 });
  }
}
