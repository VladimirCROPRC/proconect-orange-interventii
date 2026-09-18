import { env } from "cloudflare:workers";
import { getRawDb } from "../db";

type AssetEnvironment = { ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
type ZipEntry = { name: string; content: Uint8Array };
type ProjectRow = {
  id: string; fo_section_name: string; topology: string; cable_capacity: number; route_type: string;
  orange_intervention_type: string; sla: string; departure_locality: string; county: string;
  requirements: string; technician: string; status: string; created_at: number; content_json: string | null;
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const firstApplicationRow = 1919;

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function join(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

async function deflate(bytes: Uint8Array) {
  const stream = new Response(bytes.slice().buffer).body!.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compressedZip(files: ZipEntry[]) {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.content;
    const packed = await deflate(data);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 8, true); lv.setUint32(14, crc, true); lv.setUint32(18, packed.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); localHeader.set(name, 30);
    local.push(localHeader, packed);
    const centralHeader = new Uint8Array(46 + name.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 8, true); cv.setUint32(16, crc, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); centralHeader.set(name, 46);
    central.push(centralHeader);
    offset += localHeader.length + packed.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return join([...local, ...central, end]);
}

async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Șablonul centralizatorului Orange nu este un fișier Excel valid.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Arhiva centralizatorului Orange este coruptă.");
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
    if (method === 0) content = compressed.slice();
    else if (method === 8) {
      const stream = new Response(compressed.slice().buffer).body!.pipeThrough(new DecompressionStream("deflate-raw"));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error("Centralizatorul Orange folosește o compresie nesuportată.");
    files.push({ name, content });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textCell(reference: string, value: unknown, style = "") {
  const normalized = String(value ?? "").trim();
  return normalized ? `<c r="${reference}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t>${xml(normalized)}</t></is></c>` : `<c r="${reference}"${style ? ` s="${style}"` : ""}/>`;
}

function numberCell(reference: string, value: unknown, style = "") {
  const number = Number(value);
  return Number.isFinite(number) && number !== 0 ? `<c r="${reference}"${style ? ` s="${style}"` : ""}><v>${number}</v></c>` : `<c r="${reference}"${style ? ` s="${style}"` : ""}/>`;
}

function bucharestTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

function closingTimestamp(validatedAt: unknown, closingTime: unknown) {
  const timestamp = bucharestTimestamp(validatedAt);
  if (!timestamp || typeof closingTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(closingTime)) return timestamp;
  return timestamp.replace(/\d{2}:\d{2}$/, closingTime);
}

function projectValues(project: ProjectRow) {
  let intervention: {
    assessment?: { cause?: string; arrivedAt?: number; documentedAt?: number; incidentDescription?: string; damageLocation?: { lat?: number; lon?: number; placedAt?: number } };
    execution?: { remediationDescription?: string };
    documentation?: { validatedAt?: number; validatedBy?: string; closingTime?: string; incidentDescription?: string; remediationDescription?: string };
  } = {};
  try { intervention = project.content_json ? (JSON.parse(project.content_json).intervention ?? {}) : {}; } catch { intervention = {}; }
  const assessment = intervention.assessment;
  const location = assessment?.damageLocation;
  const validated = intervention.documentation;
  return {
    section: project.fo_section_name,
    ticket: project.id,
    locality: project.departure_locality,
    county: project.county,
    technician: project.technician,
    responsible: validated?.validatedBy ?? "",
    topology: project.topology,
    status: project.status === "Finalizat" ? "Raport finalizat" : assessment ? "În lucru" : "Tichet generat",
    sla: project.sla,
    created: bucharestTimestamp(project.created_at),
    arrived: bucharestTimestamp(assessment?.arrivedAt),
    located: bucharestTimestamp(location?.placedAt ?? assessment?.documentedAt),
    completed: closingTimestamp(validated?.validatedAt, validated?.closingTime),
    capacity: project.cable_capacity,
    cause: validated?.incidentDescription ?? assessment?.incidentDescription ?? project.requirements,
    incident: "",
    remediation: validated?.remediationDescription ?? intervention.execution?.remediationDescription ?? "",
    coordinates: typeof location?.lat === "number" && typeof location?.lon === "number" ? `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}` : "",
    details: "",
  };
}

function renderRow(project: ProjectRow, row: number) {
  const value = projectValues(project);
  return `<row r="${row}" spans="1:31" ht="15" customHeight="1">` +
    `<c r="A${row}" s="60"><f>ROW() - ROW(Table1[[#Headers],[s]])</f><v>${row - 1}</v></c>` +
    textCell(`B${row}`, value.section) + textCell(`D${row}`, value.ticket) + textCell(`E${row}`, value.locality) +
    textCell(`F${row}`, value.county, "5") + textCell(`G${row}`, value.responsible) + textCell(`H${row}`, value.topology, "18") +
    textCell(`I${row}`, value.status, "18") + textCell(`J${row}`, value.sla) + textCell(`K${row}`, "", "20") +
    textCell(`L${row}`, value.created, "18") + textCell(`M${row}`, value.technician) + textCell(`N${row}`, value.technician, "18") +
    textCell(`O${row}`, value.arrived, "3") + textCell(`P${row}`, value.located, "22") + textCell(`Q${row}`, value.completed) +
    numberCell(`R${row}`, value.capacity) + textCell(`S${row}`, value.cause) + textCell(`U${row}`, value.incident, "21") +
    textCell(`V${row}`, value.remediation) + textCell(`W${row}`, value.coordinates) + textCell(`X${row}`, value.details) + `</row>`;
}

export async function buildOrangeCentralizerXlsx() {
  const assets = (env as unknown as AssetEnvironment).ASSETS;
  if (!assets) throw new Error("Șablonul centralizatorului Orange nu este disponibil.");
  const response = await assets.fetch(new Request("https://assets.local/templates/Centralizator-ENO3-Y4.xlsx"));
  if (!response.ok) throw new Error("Șablonul centralizatorului Orange nu a putut fi încărcat.");
  const files = await unzip(new Uint8Array(await response.arrayBuffer()));
  const projects = await getRawDb().prepare(
    "SELECT projects.id, projects.fo_section_name, projects.topology, projects.cable_capacity, projects.route_type, projects.orange_intervention_type, projects.sla, projects.departure_locality, projects.county, projects.requirements, projects.technician, projects.status, projects.created_at, project_field_documentation.content_json FROM projects LEFT JOIN project_field_documentation ON project_field_documentation.project_id = projects.id WHERE projects.activity_type = 'Intervenție Orange' ORDER BY projects.created_at ASC, projects.id ASC",
  ).all<ProjectRow>();
  const rows = projects.results ?? [];
  const sheet = files.find((file) => file.name === "xl/worksheets/sheet6.xml");
  const table = files.find((file) => file.name === "xl/tables/table3.xml");
  if (!sheet || !table) throw new Error("Șablonul nu conține foaia sau tabelul centralizatorului Orange.");
  const lastRow = Math.max(1918, firstApplicationRow + rows.length - 1);
  let sheetXml = decoder.decode(sheet.content);
  rows.forEach((project, index) => {
    const rowNumber = firstApplicationRow + index;
    const replacement = renderRow(project, rowNumber);
    const rowPattern = new RegExp(`<row r="${rowNumber}"[^>]*>.*?<\\/row>`);
    sheetXml = rowPattern.test(sheetXml)
      ? sheetXml.replace(rowPattern, replacement)
      : sheetXml.replace("</sheetData>", `${replacement}</sheetData>`);
  });
  // The source workbook contains formatting and a stray cell down to row 1,046,918.
  // Google Sheets counts that declared grid as tens of millions of cells and refuses
  // to open the file even when the compressed XLSX is small. Keep only real rows and
  // constrain validation ranges to the populated table.
  sheetXml = sheetXml.replace(/<row r="(\d+)"[^>]*>.*?<\/row>/g, (rowXml, rowNumber: string) => Number(rowNumber) > lastRow ? "" : rowXml);
  sheetXml = sheetXml.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="A1:AV${lastRow}"/>`);
  sheetXml = sheetXml.replace(/1048576/g, String(lastRow)).replace(/1046918/g, String(lastRow));
  sheet.content = encoder.encode(sheetXml);
  table.content = encoder.encode(decoder.decode(table.content).replace(/ref="A1:AE1918"/g, `ref="A1:AE${lastRow}"`));
  const workbook = await compressedZip(files);
  return workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) as ArrayBuffer;
}
