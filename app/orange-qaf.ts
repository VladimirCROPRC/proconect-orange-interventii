import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { orangeMaterials, proconectMaterials } from "./orange-materials";
import { orangeServicePackages } from "./orange-services";
import { zipPackage } from "./report-docx";

type AssetEnvironment = { ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
type Material = { source?: string; code?: string; quantity?: number };
type DamageLocation = { lat?: number; lon?: number; placedAt?: number };
type ExecutionJunction = { lat?: number; lon?: number; kind?: string };
type ExecutionActivity = { type?: string; junction?: ExecutionJunction };
type SiteMeasurement = { siteCode?: string; otdrLengthMeters?: number; photoCount?: number };
type ZipEntry = { name: string; content: Uint8Array };
const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Șablonul QAF Orange nu este un fișier Excel valid.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Arhiva QAF Orange este coruptă.");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(start, start + compressedSize);
    let content: Uint8Array;
    if (method === 0) {
      content = compressed.slice();
    } else if (method === 8) {
      const input = compressed.slice().buffer;
      const stream = new Response(input).body!.pipeThrough(new DecompressionStream("deflate-raw"));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error("Șablonul QAF Orange folosește o compresie nesuportată.");
    }
    files.push({ name, content });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function writeQuantity(xml: string, cell: string, quantity: number) {
  const value = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(3)));
  const selfClosing = new RegExp(`<c r="${cell}"([^>]*)\\/>`);
  const populated = new RegExp(`<c r="${cell}"([^>]*)>.*?<\\/c>`);
  const render = (attributes: string) => `<c r="${cell}"${attributes.replace(/\s+t="[^"]*"/g, "")}><v>${value}</v></c>`;
  const empty = selfClosing.exec(xml);
  if (empty) return xml.replace(empty[0], render(empty[1]));
  const existing = populated.exec(xml);
  return existing ? xml.replace(existing[0], render(existing[1])) : xml;
}

async function orangeDocumentation(projectId: string) {
  const row = await getRawDb().prepare(
    "SELECT projects.client, projects.address, projects.fo_section_name, projects.topology, projects.cable_capacity, projects.route_type, projects.orange_intervention_type, projects.sla, projects.departure_locality, project_field_documentation.content_json FROM projects LEFT JOIN project_field_documentation ON project_field_documentation.project_id = projects.id WHERE projects.id = ? LIMIT 1",
  ).bind(projectId).first<{
    client: string; address: string; fo_section_name: string; topology: string; cable_capacity: number;
    route_type: string; orange_intervention_type: string; sla: string; departure_locality: string; content_json: string | null;
  }>();
  if (!row) return null;
  let materials: Material[] = [];
  let activities: ExecutionActivity[] = [];
  let damageLocation: DamageLocation | undefined;
  let documentedAt: number | undefined;
  let siteMeasurement: SiteMeasurement | undefined;
  let arrivedAt: number | undefined;
  let incidentDescription = "";
  let remediationDescription = "";
  let validatedAt: number | undefined;
  let services: Array<{ code?: string; quantity?: number }> = [];
  let cause = "";
  let assessedCableCapacity = 0;
  let assessedRouteType = "";
  if (row.content_json) {
    try {
      const documentation = JSON.parse(row.content_json) as {
        intervention?: {
          assessment?: { cause?: string; arrivedAt?: number; incidentDescription?: string; damageLocation?: DamageLocation; documentedAt?: number; siteMeasurement?: SiteMeasurement; cableCapacity?: number; routeType?: string };
          execution?: { materials?: Material[]; activities?: ExecutionActivity[]; remediationDescription?: string };
          documentation?: { incidentDescription?: string; remediationDescription?: string; services?: Array<{ code?: string; quantity?: number }>; validatedAt?: number };
        };
      };
      materials = Array.isArray(documentation.intervention?.execution?.materials) ? documentation.intervention!.execution!.materials! : [];
      activities = Array.isArray(documentation.intervention?.execution?.activities) ? documentation.intervention!.execution!.activities! : [];
      damageLocation = documentation.intervention?.assessment?.damageLocation;
      documentedAt = documentation.intervention?.assessment?.documentedAt;
      siteMeasurement = documentation.intervention?.assessment?.siteMeasurement;
      arrivedAt = documentation.intervention?.assessment?.arrivedAt;
      incidentDescription = documentation.intervention?.documentation?.incidentDescription ?? documentation.intervention?.assessment?.incidentDescription ?? "";
      remediationDescription = documentation.intervention?.documentation?.remediationDescription ?? documentation.intervention?.execution?.remediationDescription ?? "";
      validatedAt = documentation.intervention?.documentation?.validatedAt;
      services = Array.isArray(documentation.intervention?.documentation?.services) ? documentation.intervention!.documentation!.services! : [];
      cause = documentation.intervention?.assessment?.cause ?? "";
      assessedCableCapacity = Number(documentation.intervention?.assessment?.cableCapacity) || 0;
      assessedRouteType = documentation.intervention?.assessment?.routeType ?? "";
    } catch {
      // The ticket data remains usable even if older field documentation is malformed.
    }
  }
  const measurementPhotos = siteMeasurement
    ? await getRawDb().prepare(
      "SELECT original_name FROM project_files WHERE project_id = ? AND section = 'intervention-assessment' AND category = 'site-measurement' ORDER BY created_at ASC",
    ).bind(projectId).all<{ original_name: string }>()
    : { results: [] as Array<{ original_name: string }> };
  return {
    materials, damageLocation, documentedAt, cause, siteMeasurement, arrivedAt, incidentDescription, remediationDescription, validatedAt, services,
    measurementPhotoNames: (measurementPhotos.results ?? []).map((photo) => photo.original_name).filter(Boolean),
    newJunctions: activities
      .filter((activity) => activity.type === "junction-installation" && activity.junction?.kind === "new")
      .map((activity) => activity.junction!)
      .filter((junction) => Number.isFinite(junction.lat) && Number.isFinite(junction.lon))
      .slice(0, 4),
    siteA: row.client ?? "", siteB: row.address ?? "", foSectionName: row.fo_section_name ?? "",
    topology: row.topology ?? "", cableCapacity: assessedCableCapacity || Number(row.cable_capacity) || 0, routeType: assessedRouteType || row.route_type || "",
    interventionType: row.orange_intervention_type ?? "", sla: row.sla ?? "", departureLocality: row.departure_locality ?? "",
  };
}

function qafTicketNumber(projectId: string) {
  const match = /^(IMO|FITT|PBM)0*(\d+)$/i.exec(projectId.trim());
  return match ? match[2] : projectId.trim();
}

function qafJunctionNicmName(projectId: string, junctionNumber: number) {
  const ticketNumber = qafTicketNumber(projectId);
  const ticketType = /^(IMO|FITT|PBM)/i.exec(projectId.trim())?.[1]?.toUpperCase() ?? "";
  return `J${junctionNumber}_${ticketType}${ticketNumber}`;
}

function writeNumber(xml: string, cell: string, value: number) {
  return writeQuantity(xml, cell, value);
}

function writeMapsLink(xml: string, cell: string, lat: number, lon: number) {
  const latitude = lat.toFixed(6);
  const longitude = lon.toFixed(6);
  const formula = `HYPERLINK("https://maps.google.com/?q=${latitude},${longitude}","Deschide Google Maps")`;
  const selfClosing = new RegExp(`<c r="${cell}"([^>]*)\\/>`);
  const populated = new RegExp(`<c r="${cell}"([^>]*)>.*?<\\/c>`);
  const render = (attributes: string) => `<c r="${cell}"${attributes.replace(/\s+t="[^"]*"/g, "")} t="str"><f>${formula}</f><v>Deschide Google Maps</v></c>`;
  const empty = selfClosing.exec(xml);
  if (empty) return xml.replace(empty[0], render(empty[1]));
  const existing = populated.exec(xml);
  return existing ? xml.replace(existing[0], render(existing[1])) : xml;
}

function writeText(xml: string, cell: string, value: string) {
  const selfClosing = new RegExp(`<c r="${cell}"([^>]*)\\/>`);
  const populated = new RegExp(`<c r="${cell}"([^>]*)>.*?<\\/c>`);
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const render = (attributes: string) => `<c r="${cell}"${attributes.replace(/\s+t="[^"]*"/g, "")} t="inlineStr"><is><t>${escaped}</t></is></c>`;
  const empty = selfClosing.exec(xml);
  if (empty) return xml.replace(empty[0], render(empty[1]));
  const existing = populated.exec(xml);
  return existing ? xml.replace(existing[0], render(existing[1])) : xml;
}

function localPlacement(timestamp: number | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const day = Number(value("day"));
  const month = Number(value("month"));
  const year = Number(value("year"));
  const hour = value("hour");
  const minute = value("minute");
  return Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year) && hour && minute
    ? { day, month, year, time: `${hour}:${minute}` }
    : null;
}

/** Builds the approved QAF and fills only the material quantity cells selected by the technician. */
export async function buildOrangeQafXlsx(projectId: string) {
  const assets = (env as unknown as AssetEnvironment).ASSETS;
  if (!assets) throw new Error("Șablonul QAF Orange nu este disponibil în configurația aplicației.");
  const response = await assets.fetch(new Request("https://assets.local/templates/QAF.xlsx"));
  if (!response.ok) throw new Error("Șablonul QAF Orange nu a putut fi încărcat.");
  const files = await unzip(new Uint8Array(await response.arrayBuffer()));
  const documentation = await orangeDocumentation(projectId);
  if (!documentation) throw new Error("Tichetul Orange nu a fost găsit.");
  const quantities = new Map<string, number>();
  for (const item of documentation.materials) {
    const quantity = Number(item.quantity);
    if ((item.source !== "orange" && item.source !== "proconect") || !item.code || !Number.isFinite(quantity) || quantity <= 0) continue;
    const key = `${item.source}:${item.code}`;
    quantities.set(key, (quantities.get(key) ?? 0) + quantity);
  }
  const sheets = [
    { name: "xl/worksheets/sheet2.xml", source: "orange", column: "D", catalog: orangeMaterials },
    { name: "xl/worksheets/sheet3.xml", source: "proconect", column: "E", catalog: proconectMaterials },
  ] as const;
  for (const sheet of sheets) {
    const entry = files.find((file) => file.name === sheet.name);
    if (!entry) throw new Error("Șablonul QAF Orange nu conține foile de materiale.");
    let xml = decoder.decode(entry.content);
    sheet.catalog.forEach((item, index) => {
      const quantity = quantities.get(`${sheet.source}:${item.code}`);
      if (quantity) xml = writeQuantity(xml, `${sheet.column}${index + 2}`, quantity);
    });
    entry.content = encoder.encode(xml);
  }
  const servicesSheet = files.find((file) => file.name === "xl/worksheets/sheet4.xml");
  if (!servicesSheet) throw new Error("Șablonul QAF Orange nu conține foaia de servicii.");
  let servicesXml = decoder.decode(servicesSheet.content);
  for (const selection of documentation.services) {
    const service = orangeServicePackages.find((item) => item.code === selection.code);
    const quantity = Number(selection.quantity);
    if (service && Number.isFinite(quantity) && quantity > 0) servicesXml = writeQuantity(servicesXml, `E${service.qafRow}`, quantity);
  }
  servicesSheet.content = encoder.encode(servicesXml);
  const main = files.find((file) => file.name === "xl/worksheets/sheet1.xml");
  if (!main) throw new Error("Șablonul QAF Orange nu conține foaia principală.");
  const location = documentation.damageLocation;
  const arrived = localPlacement(documentation.arrivedAt);
  const located = localPlacement(location?.placedAt ?? documentation.documentedAt);
  const finalized = localPlacement(documentation.validatedAt);
  let mainXml = decoder.decode(main.content);
  const textCells: Array<[string, string]> = [
    ["D5", documentation.siteA], ["K5", documentation.siteB], ["D7", documentation.foSectionName],
    ["D9", documentation.topology], ["I11", documentation.routeType], ["D14", documentation.interventionType],
    ["F14", documentation.sla], ["D15", qafTicketNumber(projectId)], ["D16", documentation.departureLocality], ["C23", documentation.cause],
    ["C25", documentation.incidentDescription], ["C29", documentation.remediationDescription],
  ];
  for (const [cell, value] of textCells) {
    if (value) mainXml = writeText(mainXml, cell, value);
  }
  if (documentation.cableCapacity > 0) mainXml = writeNumber(mainXml, "D11", documentation.cableCapacity);
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lon)) {
    mainXml = writeNumber(mainXml, "C34", Number(location.lat!.toFixed(6)));
    mainXml = writeNumber(mainXml, "E34", Number(location.lon!.toFixed(6)));
    mainXml = writeMapsLink(mainXml, "G34", location.lat!, location.lon!);
  }
  documentation.newJunctions.forEach((junction, index) => {
    const row = 41 + index;
    mainXml = writeNumber(mainXml, `C${row}`, Number(junction.lat!.toFixed(6)));
    mainXml = writeNumber(mainXml, `E${row}`, Number(junction.lon!.toFixed(6)));
    mainXml = writeMapsLink(mainXml, `G${row}`, junction.lat!, junction.lon!);
    mainXml = writeText(mainXml, `C${46 + index}`, qafJunctionNicmName(projectId, index + 1));
  });
  if (documentation.siteMeasurement) {
    const siteCode = documentation.siteMeasurement.siteCode?.trim() ?? "";
    const length = Number(documentation.siteMeasurement.otdrLengthMeters);
    if (siteCode) mainXml = writeText(mainXml, "C56", siteCode);
    if (Number.isFinite(length) && length > 0) mainXml = writeText(mainXml, "I56", `${Number(length.toFixed(2))} m`);
    if (documentation.measurementPhotoNames.length) mainXml = writeText(mainXml, "K56", documentation.measurementPhotoNames.join(", "));
  }
  for (const [row, timestamp] of [[19, arrived], [20, located], [21, finalized]] as const) {
    if (!timestamp) continue;
    mainXml = writeNumber(mainXml, `C${row}`, timestamp.day);
    mainXml = writeNumber(mainXml, `D${row}`, timestamp.month);
    mainXml = writeNumber(mainXml, `E${row}`, timestamp.year);
    mainXml = writeText(mainXml, `G${row}`, timestamp.time);
  }
  main.content = encoder.encode(mainXml);

  const workbook = zipPackage(files);
  return workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) as ArrayBuffer;
}
