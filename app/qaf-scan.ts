import { env } from "cloudflare:workers";
import { orangeMaterials, proconectMaterials } from "./orange-materials";
import { orangeServicePackages } from "./orange-services";
import { zipPackage } from "./report-docx";

type ZipEntry = { name: string; content: Uint8Array };
type DeclaredMaterial = { source: "orange" | "proconect"; code: string; description: string; unit: string; quantity: number };
type DeclaredService = { code: string; description: string; unit: string; quantity: number };
type SuggestedMaterial = DeclaredMaterial & { reason: string };
type SuggestedService = DeclaredService & { reason: string };
export type ParsedQaf = {
  ticket: string;
  date: string;
  remediationDescription: string;
  materials: DeclaredMaterial[];
  services: DeclaredService[];
};
export type QafScanInput = ParsedQaf & { id: string; fileName: string; path: string };
export type QafSuggestion = {
  id: string;
  materials: SuggestedMaterial[];
  services: SuggestedService[];
  summary: string;
  status: string;
};

type OpenAiEnvironment = { OPENAI_API_KEY?: string; OPENAI_QAF_MODEL?: string; OPENAI_VISION_MODEL?: string };
const environment = env as unknown as OpenAiEnvironment;
const decoder = new TextDecoder();

function decodeXml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Fișierul nu este o arhivă Excel validă.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Arhiva Excel este coruptă.");
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
    let fileContent: Uint8Array;
    if (method === 0) {
      fileContent = compressed.slice();
    } else if (method === 8) {
      const stream = new Response(compressed.slice().buffer).body!.pipeThrough(new DecompressionStream("deflate-raw"));
      fileContent = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new Error("Fișierul Excel folosește o compresie nesuportată.");
    }
    files.push({ name, content: fileContent });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function sharedStrings(xmlText: string) {
  return Array.from(xmlText.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g), (match) =>
    decodeXml(Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (text) => text[1]).join("")),
  );
}

function cellValue(sheetXml: string, reference: string, strings: string[]) {
  const escaped = reference.replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
  const match = new RegExp('<c\\b([^>]*\\br="' + escaped + '"[^>]*)>([\\s\\S]*?)<\\/c>').exec(sheetXml);
  if (!match) return "";
  const attributes = match[1];
  const body = match[2];
  if (/\bt="inlineStr"/.test(attributes)) {
    return decodeXml(Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (text) => text[1]).join(""));
  }
  const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
  if (/\bt="s"/.test(attributes)) return strings[Number(value)] ?? "";
  return decodeXml(value);
}

function quantity(sheetXml: string, reference: string, strings: string[]) {
  const value = Number(cellValue(sheetXml, reference, strings).replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function qafDate(sheetXml: string, strings: string[]) {
  for (const row of [79, 21, 18]) {
    const day = Number(cellValue(sheetXml, "C" + row, strings));
    const month = Number(cellValue(sheetXml, "D" + row, strings));
    const year = Number(cellValue(sheetXml, "E" + row, strings));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year >= 2000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return String(day).padStart(2, "0") + "." + String(month).padStart(2, "0") + "." + year;
    }
  }
  return "";
}

function normalizedTicket(sheetXml: string, strings: string[], path: string) {
  const pathTicket = /\b(IMO|FITT|PBM)0*(\d{3,})\b/i.exec(path);
  if (pathTicket) return pathTicket[1].toUpperCase() + pathTicket[2];
  const ticketNumber = cellValue(sheetXml, "D15", strings).trim();
  const flow = /\b(IMO|FITT|PBM)\b/i.exec(cellValue(sheetXml, "D14", strings))?.[1]?.toUpperCase() ?? "";
  return flow && ticketNumber ? flow + ticketNumber.replace(/^0+/, "") : ticketNumber;
}

export async function parseQafWorkbook(buffer: ArrayBuffer, path: string): Promise<ParsedQaf | null> {
  const files = await unzip(new Uint8Array(buffer));
  const sheet = (name: string) => {
    const entry = files.find((file) => file.name === name);
    return entry ? decoder.decode(entry.content) : "";
  };
  const main = sheet("xl/worksheets/sheet1.xml");
  const orangeSheet = sheet("xl/worksheets/sheet2.xml");
  const proconectSheet = sheet("xl/worksheets/sheet3.xml");
  const servicesSheet = sheet("xl/worksheets/sheet4.xml");
  if (!main || !orangeSheet || !proconectSheet || !servicesSheet) return null;
  const strings = sharedStrings(sheet("xl/sharedStrings.xml"));
  const ticket = normalizedTicket(main, strings, path);
  if (!ticket) return null;
  const materials: DeclaredMaterial[] = [];
  orangeMaterials.forEach((item, index) => {
    const selected = quantity(orangeSheet, "D" + (index + 2), strings);
    if (selected) materials.push({ source: "orange", ...item, quantity: selected });
  });
  proconectMaterials.forEach((item, index) => {
    const selected = quantity(proconectSheet, "E" + (index + 2), strings);
    if (selected) materials.push({ source: "proconect", ...item, quantity: selected });
  });
  const services: DeclaredService[] = [];
  orangeServicePackages.forEach((item) => {
    const selected = quantity(servicesSheet, "E" + item.qafRow, strings);
    if (selected) services.push({ code: item.code, description: item.description, unit: item.unit, quantity: selected });
  });
  return {
    ticket,
    date: qafDate(main, strings),
    remediationDescription: cellValue(main, "C29", strings).trim(),
    materials,
    services,
  };
}

function outputText(payload: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return (payload.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text).join("");
}

export async function suggestQafSelections(items: QafScanInput[]): Promise<Map<string, QafSuggestion>> {
  const result = new Map<string, QafSuggestion>();
  items.forEach((item) => {
    if (!item.remediationDescription) result.set(item.id, { id: item.id, materials: [], services: [], summary: "", status: "Fără descriere remediere" });
  });
  const eligible = items.filter((item) => item.remediationDescription);
  if (!eligible.length) return result;
  if (!environment.OPENAI_API_KEY) {
    eligible.forEach((item) => result.set(item.id, { id: item.id, materials: [], services: [], summary: "", status: "OPENAI_API_KEY neconfigurat" }));
    return result;
  }
  const materialCatalog = [
    ...orangeMaterials.map((item) => ({ source: "orange", ...item })),
    ...proconectMaterials.map((item) => ({ source: "proconect", ...item })),
  ];
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            materials: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                properties: {
                  source: { type: "string", enum: ["orange", "proconect"] },
                  code: { type: "string" },
                  quantity: { type: "number", minimum: 0 },
                  reason: { type: "string" },
                },
                required: ["source", "code", "quantity", "reason"],
              },
            },
            services: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                properties: {
                  code: { type: "string" },
                  quantity: { type: "number", minimum: 0 },
                  reason: { type: "string" },
                },
                required: ["code", "quantity", "reason"],
              },
            },
            summary: { type: "string" },
          },
          required: ["id", "materials", "services", "summary"],
        },
      },
    },
    required: ["items"],
  };
  const prompt = [
    "Analizează descrierile de remediere pentru intervenții de fibră optică.",
    "Sugerează numai materiale și servicii care există exact în cataloagele furnizate.",
    "Nu inventa coduri. Cantitățile sunt estimări prudente. Dacă descrierea nu justifică o selecție, întoarce liste goale.",
    "Păstrează exact id-ul fiecărei înregistrări.",
    "CATALOG MATERIALE:\n" + JSON.stringify(materialCatalog),
    "CATALOG SERVICII:\n" + JSON.stringify(orangeServicePackages.map(({ code, description, unit }) => ({ code, description, unit }))),
    "QAF-URI:\n" + JSON.stringify(eligible.map((item) => ({ id: item.id, descriereRemediere: item.remediationDescription.slice(0, 2500) }))),
  ].join("\n\n");
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + environment.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: environment.OPENAI_QAF_MODEL || environment.OPENAI_VISION_MODEL || "gpt-6-astra",
        store: false,
        max_output_tokens: 8000,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
        text: { format: { type: "json_schema", name: "qaf_material_service_suggestions", strict: true, schema } },
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error("OpenAI HTTP " + response.status);
    const payload = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const parsed = JSON.parse(outputText(payload)) as {
      items?: Array<{
        id?: string;
        materials?: Array<{ source?: string; code?: string; quantity?: number; reason?: string }>;
        services?: Array<{ code?: string; quantity?: number; reason?: string }>;
        summary?: string;
      }>;
    };
    const eligibleIds = new Set(eligible.map((item) => item.id));
    for (const suggestion of parsed.items ?? []) {
      if (!suggestion.id || !eligibleIds.has(suggestion.id)) continue;
      const materials: SuggestedMaterial[] = [];
      for (const selection of suggestion.materials ?? []) {
        const source = selection.source === "orange" || selection.source === "proconect" ? selection.source : null;
        const catalogItem = source ? materialCatalog.find((item) => item.source === source && item.code === selection.code) : undefined;
        const selectedQuantity = Number(selection.quantity);
        if (!source || !catalogItem || !Number.isFinite(selectedQuantity) || selectedQuantity <= 0) continue;
        materials.push({ source, code: catalogItem.code, description: catalogItem.description, unit: catalogItem.unit, quantity: selectedQuantity, reason: String(selection.reason ?? "").trim() });
      }
      const services: SuggestedService[] = [];
      for (const selection of suggestion.services ?? []) {
        const catalogItem = orangeServicePackages.find((item) => item.code === selection.code);
        const selectedQuantity = Number(selection.quantity);
        if (!catalogItem || !Number.isFinite(selectedQuantity) || selectedQuantity <= 0) continue;
        services.push({ code: catalogItem.code, description: catalogItem.description, unit: catalogItem.unit, quantity: selectedQuantity, reason: String(selection.reason ?? "").trim() });
      }
      result.set(suggestion.id, { id: suggestion.id, materials, services, summary: String(suggestion.summary ?? "").trim(), status: "Sugestie generată" });
    }
    eligible.forEach((item) => {
      if (!result.has(item.id)) result.set(item.id, { id: item.id, materials: [], services: [], summary: "", status: "Fără sugestie validă" });
    });
  } catch {
    eligible.forEach((item) => result.set(item.id, { id: item.id, materials: [], services: [], summary: "", status: "Sugestia OpenAI nu a putut fi generată" }));
  }
  return result;
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

function cell(row: number, column: number, value: unknown, style = 0) {
  return '<c r="' + columnName(column) + row + '" t="inlineStr" s="' + style + '"><is><t xml:space="preserve">' + xml(value) + "</t></is></c>";
}

function materialText(value: Array<DeclaredMaterial | SuggestedMaterial>) {
  return value.map((item) => (item.source === "orange" ? "Orange" : "Proconect") + " | " + item.code + " | " + item.quantity + " " + item.unit + " | " + item.description + ("reason" in item && item.reason ? " | " + item.reason : "")).join("\n");
}

function serviceText(value: Array<DeclaredService | SuggestedService>) {
  return value.map((item) => item.code + " | " + item.quantity + " " + item.unit + " | " + item.description + ("reason" in item && item.reason ? " | " + item.reason : "")).join("\n");
}

export function buildQafScanXlsx(items: QafScanInput[], suggestions: Map<string, QafSuggestion>, folderUrl: string) {
  const rows: Array<{ values: unknown[]; style?: number }> = [
    { values: ["CENTRALIZATOR QAF – SCANARE UNICĂ"], style: 1 },
    { values: ["Folder sursă", folderUrl, "", "Generat", new Date().toISOString()], style: 3 },
    { values: ["TICHET", "DATA QAF", "FIȘIER QAF", "CALE ONEDRIVE", "DESCRIERE REMEDIERE", "MATERIALE DECLARATE", "MANOPERĂ DECLARATĂ", "MATERIALE SUGERATE", "MANOPERĂ SUGERATĂ", "EXPLICAȚIE AI", "STATUS AI"], style: 2 },
  ];
  for (const item of items) {
    const suggestion = suggestions.get(item.id) ?? { id: item.id, materials: [], services: [], summary: "", status: "Neprocesat" };
    rows.push({ values: [
      item.ticket, item.date, item.fileName, item.path, item.remediationDescription,
      materialText(item.materials), serviceText(item.services),
      materialText(suggestion.materials), serviceText(suggestion.services),
      suggestion.summary, suggestion.status,
    ] });
  }
  const sheetRows = rows.map((entry, index) => {
    const row = index + 1;
    return '<row r="' + row + '"' + (row === 1 ? ' ht="28" customHeight="1"' : "") + ">" + entry.values.map((value, column) => cell(row, column, value, entry.style ?? 0)).join("") + "</row>";
  }).join("");
  const lastRow = Math.max(3, rows.length);
  const widths = [18, 14, 28, 46, 54, 54, 54, 54, 54, 50, 24];
  const columns = widths.map((width, index) => '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' + width + '" customWidth="1"/>').join("");
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + columns + "</cols><sheetData>" + sheetRows + '</sheetData><autoFilter ref="A3:K' + lastRow + '"/><mergeCells count="1"><mergeCell ref="A1:K1"/></mergeCells></worksheet>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF35477F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F3F8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9DFEA"/></left><right style="thin"><color rgb="FFD9DFEA"/></right><top style="thin"><color rgb="FFD9DFEA"/></top><bottom style="thin"><color rgb="FFD9DFEA"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return zipPackage([
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Centralizator QAF" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
    { name: "xl/styles.xml", content: styles },
  ]);
}
