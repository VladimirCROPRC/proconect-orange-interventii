import { env } from "cloudflare:workers";
import { getRawDb } from "../db";

type AssetEnvironment = { ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } };
type ZipEntry = { name: string; content: Uint8Array };
type Scope = "technician" | "contractor";
type ProjectRow = {
  id: string;
  departure_locality: string;
  county: string;
  technician: string;
  scheduled_label: string;
  content_json: string | null;
};
type AccountRow = { name: string; contractor: string };
type ServiceSelection = { code?: string; quantity?: number };
type MaterialSelection = { source?: string; description?: string; unit?: string; quantity?: number };
type ParsedProject = ProjectRow & {
  closingDate: string;
  requestedDate: string;
  validatedRemediation: string;
  participants: string[];
  services: ServiceSelection[];
  materials: MaterialSelection[];
};
type CatalogItem = { row: number; description: string; unit: string; price: number };
type ReportLine = {
  ticket: string;
  county: string;
  locality: string;
  requestedDate: string;
  closingDate: string;
  workDescription: string;
  boqItem: string;
  unit: string;
  quantity: number;
  price: number;
  observation: string;
};

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const monthNames = ["IANUARIE", "FEBRUARIE", "MARTIE", "APRILIE", "MAI", "IUNIE", "IULIE", "AUGUST", "SEPTEMBRIE", "OCTOMBRIE", "NOIEMBRIE", "DECEMBRIE"];

const serviceRows: Record<string, number> = {
  "FO Incident Diagnose": 3,
  "SP1 FO": 4,
  "SP2 FOA": 5,
  "SP3 FOA": 6,
  "CR4 FOA": 7,
  "SP5 FOU": 8,
  "CR6 FOU": 9,
  "CR7 FOU": 9,
  "Directed drilling": 10,
  "Unguided drilling": 11,
  "Pole replacement wood, composite": 12,
  "Pole instalation": 13,
  "Asphalt coatings": 14,
  "Restoration of pavements, pedestrian alleys": 15,
  Ditch: 16,
  "Rock digging with a pneumatic hammer and hand tools": 17,
  "Concrete breakage": 18,
  "Restoration of aerian crossing type1": 19,
  "Restoration of aerian crossing type2": 19,
  "Small civil works intervention": 20,
  "Pole dismantling wood, composite": 30,
};

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

export async function compressedZip(files: ZipEntry[]) {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const packed = await deflate(file.content);
    const crc = crc32(file.content);
    const localHeader = new Uint8Array(30 + name.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 8, true); lv.setUint32(14, crc, true); lv.setUint32(18, packed.length, true); lv.setUint32(22, file.content.length, true);
    lv.setUint16(26, name.length, true); localHeader.set(name, 30);
    local.push(localHeader, packed);
    const centralHeader = new Uint8Array(46 + name.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 8, true); cv.setUint32(16, crc, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, file.content.length, true);
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
  if (end < 0) throw new Error("Șablonul raportului lunar nu este un fișier Excel valid.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Arhiva raportului lunar este coruptă.");
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
    } else throw new Error("Raportul lunar folosește o compresie nesuportată.");
    files.push({ name, content });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function textCell(reference: string, value: unknown, style: number) {
  const normalized = String(value ?? "").trim();
  return normalized ? `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${xml(normalized)}</t></is></c>` : `<c r="${reference}" s="${style}"/>`;
}

function numberCell(reference: string, value: number, style: number) {
  return Number.isFinite(value) ? `<c r="${reference}" s="${style}"><v>${value}</v></c>` : `<c r="${reference}" s="${style}"/>`;
}

function formulaCell(reference: string, formula: string, cached: number, style: number) {
  return `<c r="${reference}" s="${style}"><f>${xml(formula)}</f><v>${Number.isFinite(cached) ? cached : 0}</v></c>`;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\bml\b/g, "m").replace(/[^a-z0-9]+/g, " ").trim();
}

function parseSharedStrings(xmlText: string) {
  return Array.from(xmlText.matchAll(/<si>([\s\S]*?)<\/si>/g), (match) => Array.from(match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g), (text) => text[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).join(""));
}

function catalogFromTemplate(files: ZipEntry[]) {
  const sharedFile = files.find((file) => file.name === "xl/sharedStrings.xml");
  const catalogFile = files.find((file) => file.name === "xl/worksheets/sheet2.xml");
  if (!sharedFile || !catalogFile) throw new Error("Șablonul nu conține catalogul Anexa 3.");
  const shared = parseSharedStrings(decoder.decode(sharedFile.content));
  const sheetXml = decoder.decode(catalogFile.content);
  const byRow = new Map<number, Record<string, string | number>>();
  for (const cell of sheetXml.matchAll(/<c r="([A-F])(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const column = cell[1];
    const row = Number(cell[2]);
    const type = /t="s"/.test(cell[3]);
    const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[4])?.[1] ?? "";
    const value = type ? (shared[Number(raw)] ?? "") : Number(raw);
    byRow.set(row, { ...(byRow.get(row) ?? {}), [column]: value });
  }
  const items = new Map<number, CatalogItem>();
  const byDescription = new Map<string, CatalogItem>();
  for (const [row, cells] of byRow) {
    if (typeof cells.B !== "string" || !cells.B.trim()) continue;
    const item = { row, description: cells.B.trim(), unit: typeof cells.C === "string" ? cells.C.trim() : "", price: typeof cells.D === "number" && Number.isFinite(cells.D) ? cells.D : 0 };
    items.set(row, item);
    byDescription.set(normalize(item.description), item);
  }
  return { items, byDescription };
}

function parseProject(row: ProjectRow): ParsedProject | null {
  try {
    const intervention = (row.content_json ? JSON.parse(row.content_json).intervention : null) ?? {};
    const documentation = intervention.documentation ?? {};
    const closingDate = typeof documentation.closingDate === "string" ? documentation.closingDate : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closingDate)) return null;
    const participantSource = Array.isArray(documentation.completedByTechnicians) && documentation.completedByTechnicians.length
      ? documentation.completedByTechnicians
      : row.technician.split(" · ");
    return {
      ...row,
      closingDate,
      requestedDate: /^\d{4}-\d{2}-\d{2}/.test(row.scheduled_label) ? row.scheduled_label.slice(0, 10) : "",
      validatedRemediation: String(documentation.remediationDescription ?? "").trim(),
      participants: Array.from(new Set(participantSource.map((name: unknown) => String(name).trim()).filter(Boolean))),
      services: Array.isArray(documentation.services) ? documentation.services : [],
      materials: Array.isArray(intervention.execution?.materials) ? intervention.execution.materials : [],
    };
  } catch {
    return null;
  }
}

async function loadMonthlyData(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Luna selectată nu este validă.");
  await getRawDb().prepare("CREATE TABLE IF NOT EXISTS technician_contractors (technician_username TEXT PRIMARY KEY, contractor TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)").run();
  const [projectsResult, accountsResult] = await Promise.all([
    getRawDb().prepare("SELECT projects.id, projects.departure_locality, projects.county, projects.technician, projects.scheduled_label, project_field_documentation.content_json FROM projects INNER JOIN project_field_documentation ON project_field_documentation.project_id = projects.id WHERE projects.activity_type = 'Intervenție Orange' AND projects.status = 'Finalizat' ORDER BY projects.id").all<ProjectRow>(),
    getRawDb().prepare("SELECT app_users.name, COALESCE(technician_contractors.contractor, '') AS contractor FROM app_users LEFT JOIN technician_contractors ON technician_contractors.technician_username = app_users.username WHERE app_users.role = 'Tehnician' ORDER BY app_users.name").all<AccountRow>(),
  ]);
  const projects = (projectsResult.results ?? []).map(parseProject).filter((project): project is ParsedProject => Boolean(project && project.closingDate.startsWith(`${month}-`)));
  const contractorByTechnician = new Map((accountsResult.results ?? []).map((account) => [account.name, account.contractor.trim()]));
  return { projects, contractorByTechnician };
}

function subjectsFor(scope: Scope, projects: ParsedProject[], contractorByTechnician: Map<string, string>) {
  const grouped = new Map<string, Map<string, ParsedProject>>();
  for (const project of projects) {
    const subjects = scope === "technician"
      ? project.participants
      : Array.from(new Set(project.participants.map((name) => contractorByTechnician.get(name) ?? "").filter(Boolean)));
    for (const subject of subjects) {
      const projectsById = grouped.get(subject) ?? new Map<string, ParsedProject>();
      projectsById.set(project.id, project);
      grouped.set(subject, projectsById);
    }
  }
  return Array.from(grouped, ([name, projectMap]) => ({ name, projects: Array.from(projectMap.values()) })).sort((a, b) => a.name.localeCompare(b.name, "ro"));
}

export async function listMonthlyReportSubjects(month: string) {
  const { projects, contractorByTechnician } = await loadMonthlyData(month);
  return {
    month,
    technicians: subjectsFor("technician", projects, contractorByTechnician).map((subject) => ({ name: subject.name, tickets: subject.projects.length })),
    contractors: subjectsFor("contractor", projects, contractorByTechnician).map((subject) => ({ name: subject.name, tickets: subject.projects.length })),
    unassignedTechnicians: Array.from(new Set(projects.flatMap((project) => project.participants).filter((name) => !(contractorByTechnician.get(name) ?? "").trim()))).sort((a, b) => a.localeCompare(b, "ro")),
  };
}

function linesFor(projects: ParsedProject[], catalog: ReturnType<typeof catalogFromTemplate>) {
  const lines: ReportLine[] = [];
  for (const project of projects) {
    const common = {
      ticket: project.id,
      county: project.county.replace(/\s+County$/i, "").toLocaleUpperCase("ro-RO"),
      locality: project.departure_locality,
      requestedDate: project.requestedDate,
      closingDate: project.closingDate,
      workDescription: project.validatedRemediation,
    };
    for (const service of project.services) {
      const quantity = Number(service.quantity);
      if (!service.code || !Number.isFinite(quantity) || quantity <= 0) continue;
      const item = catalog.items.get(serviceRows[service.code]);
      lines.push({ ...common, boqItem: service.code, unit: item?.unit ?? "", quantity, price: item?.price ?? 0, observation: "" });
    }
    for (const material of project.materials) {
      const quantity = Number(material.quantity);
      if (!material.description || !Number.isFinite(quantity) || quantity <= 0) continue;
      const item = catalog.byDescription.get(normalize(material.description));
      lines.push({
        ...common,
        boqItem: item?.description ?? material.description,
        unit: item?.unit || String(material.unit ?? ""),
        quantity,
        price: item?.price ?? 0,
        observation: material.source === "orange" ? "Material custodie" : "",
      });
    }
  }
  return lines;
}

function excelSerial(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return 0;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000) + 25569;
}

function renderDataRow(line: ReportLine, row: number) {
  const total = line.quantity * line.price;
  return `<row r="${row}" spans="1:12" s="70" customFormat="1" ht="15" customHeight="1">` +
    textCell(`A${row}`, line.ticket, 44) + textCell(`B${row}`, line.county, 43) + textCell(`C${row}`, line.locality, 93) +
    numberCell(`D${row}`, excelSerial(line.requestedDate), 46) + numberCell(`E${row}`, excelSerial(line.closingDate), 46) +
    textCell(`F${row}`, line.workDescription, 86) + textCell(`G${row}`, line.boqItem, 76) + textCell(`H${row}`, line.unit, 45) +
    numberCell(`I${row}`, line.quantity, 80) + numberCell(`J${row}`, line.price, 47) + formulaCell(`K${row}`, `I${row}*J${row}`, total, 48) +
    textCell(`L${row}`, line.observation, 49) + `</row>`;
}

function renderBlankDataRow(row: number) {
  return `<row r="${row}" spans="1:12" s="70" customFormat="1" ht="15" customHeight="1">` +
    textCell(`A${row}`, "", 44) + textCell(`B${row}`, "", 43) + textCell(`C${row}`, "", 93) + textCell(`D${row}`, "", 46) +
    textCell(`E${row}`, "", 46) + textCell(`F${row}`, "", 86) + textCell(`G${row}`, "", 76) + textCell(`H${row}`, "", 45) +
    textCell(`I${row}`, "", 80) + textCell(`J${row}`, "", 47) + textCell(`K${row}`, "", 48) + textCell(`L${row}`, "", 49) + `</row>`;
}

function safeFileName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "raport";
}

async function templateBytes() {
  const assets = (env as unknown as AssetEnvironment).ASSETS;
  if (!assets) throw new Error("Șablonul raportului lunar nu este disponibil.");
  const response = await assets.fetch(new Request("https://assets.local/templates/Anexa-3-Contractor.xlsx"));
  if (!response.ok) throw new Error("Șablonul raportului lunar nu a putut fi încărcat.");
  return new Uint8Array(await response.arrayBuffer());
}

export async function buildMonthlyWorkbook(template: Uint8Array, month: string, subject: string, projects: ParsedProject[], exchangeRate: number, exchangeDate: string) {
  const files = await unzip(template);
  const catalog = catalogFromTemplate(files);
  const lines = linesFor(projects, catalog);
  const sheet = files.find((file) => file.name === "xl/worksheets/sheet1.xml");
  const workbook = files.find((file) => file.name === "xl/workbook.xml");
  if (!sheet || !workbook) throw new Error("Șablonul raportului lunar este incomplet.");
  const original = decoder.decode(sheet.content);
  const header = /<row r="1"[\s\S]*?<\/row>/.exec(original)?.[0];
  if (!header) throw new Error("Antetul raportului lunar lipsește din șablon.");
  const dataRows = lines.length ? lines.map((line, index) => renderDataRow(line, index + 3)).join("") : renderBlankDataRow(3);
  const lastDataRow = Math.max(3, lines.length + 2);
  const totalEur = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  const summaryRow = lastDataRow + 2;
  const rateRow = summaryRow + 2;
  const labelsRow = summaryRow + 3;
  const namesRow = summaryRow + 4;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthLabel = `${monthNames[monthNumber - 1]} ${year}`;
  const rateLabel = exchangeDate ? `Curs EUR/RON ${exchangeDate.split("-").reverse().join(".")}` : "Curs EUR/RON";
  const monthRow = `<row r="2" spans="1:12" ht="15" customHeight="1">${textCell("A2", monthLabel, 37)}${textCell("B2", "", 37)}${textCell("C2", "", 37)}${textCell("D2", "", 39)}${textCell("E2", "", 39)}${textCell("F2", "", 38)}${textCell("G2", "", 40)}${textCell("H2", "", 38)}${textCell("I2", "", 39)}${textCell("J2", "", 41)}${formulaCell("K2", `SUBTOTAL(9,K3:K${lastDataRow})`, totalEur, 41)}${textCell("L2", "", 42)}</row>`;
  const summary = `<row r="${summaryRow}" spans="1:12" ht="15" customHeight="1">${textCell(`G${summaryRow}`, "TOTAL RON FARA TVA", 94)}${formulaCell(`K${summaryRow}`, `K2*H${rateRow}`, totalEur * exchangeRate, 79)}</row>`;
  const rate = `<row r="${rateRow}" spans="1:12" ht="15" customHeight="1">${textCell(`G${rateRow}`, rateLabel, 67)}${numberCell(`H${rateRow}`, exchangeRate, 68)}</row>`;
  const labels = `<row r="${labelsRow}" spans="1:12" ht="15" customHeight="1">${textCell(`A${labelsRow}`, "Antreprenor", 32)}${textCell(`F${labelsRow}`, "Subantreprenor", 34)}</row>`;
  const names = `<row r="${namesRow}" spans="1:12" ht="15" customHeight="1">${textCell(`A${namesRow}`, "SC Pro Conect SRL", 55)}${textCell(`F${namesRow}`, subject, 78)}</row>`;
  const sheetData = `<sheetData>${header}${monthRow}${dataRows}${summary}${rate}${labels}${names}</sheetData>`;
  let sheetXml = original.replace(/<sheetData>[\s\S]*?<\/sheetData>/, sheetData);
  sheetXml = sheetXml.replace(/<dimension ref="[^"]+"\/>/, `<dimension ref="A1:L${namesRow}"/>`);
  sheetXml = sheetXml.replace(/<autoFilter ref="[^"]+"/, `<autoFilter ref="A1:L${lastDataRow}"`);
  sheetXml = sheetXml.replace(/<mergeCells[^>]*>[\s\S]*?<\/mergeCells>/, `<mergeCells count="1"><mergeCell ref="G${summaryRow}:J${summaryRow}"/></mergeCells>`);
  sheet.content = encoder.encode(sheetXml);
  workbook.content = encoder.encode(decoder.decode(workbook.content).replace(/<calcPr[^>]*\/>/, `<calcPr calcId="191028" fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>`));
  const drawing = files.find((file) => file.name === "xl/drawings/drawing1.xml");
  if (drawing) {
    const delta = rateRow - 27;
    drawing.content = encoder.encode(decoder.decode(drawing.content).replace(/<xdr:row>(\d+)<\/xdr:row>/g, (_match, value: string) => `<xdr:row>${Math.max(0, Number(value) + delta)}</xdr:row>`));
  }
  const relationships = files.find((file) => file.name === "xl/_rels/workbook.xml.rels");
  if (relationships) relationships.content = encoder.encode(decoder.decode(relationships.content).replace(/<Relationship[^>]+Type="[^"]*\/calcChain"[^>]*\/>/g, ""));
  const contentTypes = files.find((file) => file.name === "[Content_Types].xml");
  if (contentTypes) contentTypes.content = encoder.encode(decoder.decode(contentTypes.content).replace(/<Override[^>]+PartName="\/xl\/calcChain.xml"[^>]*\/>/g, ""));
  const result = await compressedZip(files.filter((file) => file.name !== "xl/calcChain.xml"));
  return { bytes: result, lineCount: lines.length };
}

function validateRate(value: number) {
  return Number.isFinite(value) && value > 0 && value < 20 ? value : 4.977;
}

export async function buildMonthlySubjectReport(month: string, scope: Scope, subjectName: string, exchangeRateInput: number, exchangeDate: string) {
  const { projects, contractorByTechnician } = await loadMonthlyData(month);
  const subject = subjectsFor(scope, projects, contractorByTechnician).find((item) => item.name === subjectName);
  if (!subject) throw new Error("Nu există intervenții închise pentru persoana sau contractorul selectat.");
  const template = await templateBytes();
  const built = await buildMonthlyWorkbook(template, month, subject.name, subject.projects, validateRate(exchangeRateInput), exchangeDate);
  return { ...built, filename: `${month}_${scope === "technician" ? "Tehnician" : "Contractor"}_${safeFileName(subject.name)}.xlsx` };
}

export async function buildAllMonthlyReports(month: string, exchangeRateInput: number, exchangeDate: string) {
  const { projects, contractorByTechnician } = await loadMonthlyData(month);
  const template = await templateBytes();
  const reports: ZipEntry[] = [];
  for (const scope of ["technician", "contractor"] as const) {
    for (const subject of subjectsFor(scope, projects, contractorByTechnician)) {
      const built = await buildMonthlyWorkbook(template, month, subject.name, subject.projects, validateRate(exchangeRateInput), exchangeDate);
      reports.push({ name: `${scope === "technician" ? "Tehnicieni" : "Contractori"}/${month}_${safeFileName(subject.name)}.xlsx`, content: built.bytes });
    }
  }
  if (!reports.length) throw new Error("Nu există intervenții finalizate în luna selectată.");
  return { bytes: await compressedZip(reports), filename: `Rapoarte-lunare-${month}.zip`, count: reports.length };
}
