import { getRawDb } from "../db";
import { zipPackage } from "./report-docx";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ticketParts(projectId: string) {
  const match = /^(IMO|FITT|PBM)0*(\d+)$/i.exec(projectId.trim());
  return match ? { type: match[1].toUpperCase(), number: match[2] } : { type: "", number: projectId.trim() };
}

export async function buildOrangeKmz(projectId: string) {
  const row = await getRawDb().prepare("SELECT content_json FROM project_field_documentation WHERE project_id = ? LIMIT 1")
    .bind(projectId).first<{ content_json: string }>();
  if (!row?.content_json) throw new Error("Documentarea intervenției nu este disponibilă.");
  const content = JSON.parse(row.content_json) as {
    intervention?: {
      assessment?: { damageLocation?: { lat?: number; lon?: number } };
      execution?: { activities?: Array<{ type?: string; junction?: { kind?: string; lat?: number; lon?: number } }> };
    };
  };
  const ticket = ticketParts(projectId);
  const points: Array<{ name: string; lat: number; lon: number }> = [];
  const damage = content.intervention?.assessment?.damageLocation;
  if (Number.isFinite(damage?.lat) && Number.isFinite(damage?.lon)) points.push({ name: ticket.number, lat: damage!.lat!, lon: damage!.lon! });
  const junctions = (content.intervention?.execution?.activities ?? [])
    .filter((activity) => activity.type === "junction-installation" && activity.junction?.kind === "new" && Number.isFinite(activity.junction.lat) && Number.isFinite(activity.junction.lon))
    .slice(0, 4);
  junctions.forEach((activity, index) => points.push({
    name: `J${index + 1}_${ticket.type}${ticket.number}`,
    lat: activity.junction!.lat!,
    lon: activity.junction!.lon!,
  }));
  const placemarks = points.map((point) => `<Placemark><name>${escapeXml(point.name)}</name><Point><coordinates>${point.lon},${point.lat},0</coordinates></Point></Placemark>`).join("");
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(projectId)}</name>${placemarks}</Document></kml>`;
  const bytes = zipPackage([{ name: "doc.kml", content: new TextEncoder().encode(kml) }]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
