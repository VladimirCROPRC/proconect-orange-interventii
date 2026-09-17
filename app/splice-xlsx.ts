import { zipPackage } from "./report-docx";

type SpliceRecord = {
  junction?: { code?: string; name?: string; documented?: boolean; lat?: number; lon?: number };
  junctionKind?: string;
  network?: string;
  siteCableType?: string;
  clientCableType?: string;
  spliceMode?: "fiber" | "end-to-end";
  spliceCount?: number;
  connections?: Array<{ siteBuffer: string; siteFiber: string; clientBuffer: string; clientFiber: string }>;
  siteBuffer?: string;
  siteFiber?: string;
  clientBuffer?: string;
  clientFiber?: string;
};

type SpliceSheetData = {
  projectId: string;
  client: string;
  address: string;
  siteCode?: string;
  lec?: string;
  count: number;
  noIntervention?: boolean;
  noInterventionReason?: string;
  records: SpliceRecord[];
};

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value) { value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

function cell(row: number, column: number, value: unknown, style = 0) {
  return `<c r="${columnName(column)}${row}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

export function buildSpliceSheetXlsx(data: SpliceSheetData) {
  const rows: Array<{ values: unknown[]; style?: number }> = [
    { values: ["FIȘĂ DE SUDURI FIBRĂ OPTICĂ"], style: 1 },
    { values: ["PROIECT", data.projectId] },
    { values: ["CLIENT", data.client] },
    { values: ["LOCAȚIE", data.address] },
    { values: ["COD SITE", data.siteCode ?? ""] },
    { values: ["CLIENT LEC", data.lec ?? ""] },
    { values: ["TOTAL SUDURI", data.count] },
    { values: [] },
  ];

  if (data.noIntervention) {
    rows.push({ values: ["NU S-A INTERVENIT", data.noInterventionReason ?? ""] });
  } else {
    rows.push({ values: ["NR.", "JONCȚIUNE", "NUME", "TIP / REȚEA", "COORDONATE", "CABLU SPRE SITE", "BUFFER / FIBRĂ SITE", "CABLU SPRE CLIENT", "BUFFER / FIBRĂ CLIENT"], style: 2 });
    for (const [index, record] of data.records.entries()) {
      const documented = record.junction?.documented === true;
      const kind = documented ? "Documentată" : record.junctionKind === "new" ? "Nouă" : "Existentă";
      const network = record.network === "mobile" ? "Orange Mobil" : record.network === "fixed" ? "Orange Fixed" : "";
      const coordinates = !documented && Number.isFinite(record.junction?.lat) && Number.isFinite(record.junction?.lon)
        ? `${record.junction!.lat!.toFixed(6)}, ${record.junction!.lon!.toFixed(6)}`
        : "";
      const connections = record.connections?.length ? record.connections : [{
        siteBuffer: record.siteBuffer ?? "",
        siteFiber: record.siteFiber ?? "",
        clientBuffer: record.clientBuffer ?? "",
        clientFiber: record.clientFiber ?? "",
      }];
      connections.forEach((connection, connectionIndex) => rows.push({ values: [
        `${index + 1}.${connectionIndex + 1}`,
        documented ? record.junction?.code ?? "" : "Fără cod",
        record.junction?.name ?? "",
        [kind, network, record.spliceMode === "end-to-end" ? "Cap–cap" : "Fibră–fibră"].filter(Boolean).join(" / "),
        coordinates,
        record.siteCableType || "Nespecificat",
        [connection.siteBuffer, connection.siteFiber].filter(Boolean).join(" / "),
        record.clientCableType || "Nespecificat",
        [connection.clientBuffer, connection.clientFiber].filter(Boolean).join(" / "),
      ] }));
    }
  }

  const sheetRows = rows.map((entry, index) => {
    const rowNumber = index + 1;
    return `<row r="${rowNumber}"${entry.style === 1 ? ' ht="28" customHeight="1"' : ""}>${entry.values.map((value, column) => cell(rowNumber, column, value, entry.style ?? 0)).join("")}</row>`;
  }).join("");
  const lastRow = rows.length;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="9" topLeftCell="A10" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="4" width="22" customWidth="1"/><col min="5" max="5" width="24" customWidth="1"/><col min="6" max="6" width="28" customWidth="1"/><col min="7" max="7" width="20" customWidth="1"/><col min="8" max="8" width="28" customWidth="1"/><col min="9" max="9" width="20" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A9:I${lastRow}"/><mergeCells count="1"><mergeCell ref="A1:I1"/></mergeCells></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF35477F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9DFEA"/></left><right style="thin"><color rgb="FFD9DFEA"/></right><top style="thin"><color rgb="FFD9DFEA"/></top><bottom style="thin"><color rgb="FFD9DFEA"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zipPackage([
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Fișa de suduri" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
    { name: "xl/styles.xml", content: styles },
  ]);
}
