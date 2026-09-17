import { zipPackage } from "./report-docx";
import type { ProjectRecord } from "./project-data";

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value) {
    value -= 1;
    result = String.fromCharCode(65 + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function cell(row: number, column: number, value: unknown, style = 0) {
  return `<c r="${columnName(column)}${row}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

export function buildTicketsWithoutOrderXlsx(tickets: ProjectRecord[]) {
  const rows: Array<{ values: unknown[]; style?: number }> = [
    { values: ["TICHETE FĂRĂ NUMĂR DE COMANDĂ"], style: 1 },
    { values: ["GENERAT LA", new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short" }).format(new Date())] },
    { values: ["TOTAL TICHETE", tickets.length] },
    { values: [] },
    { values: ["NR.", "NUMĂR TICHET", "CLIENT", "ADRESĂ", "TEHNICIAN", "STATUS", "PROGRAMARE", "CONTACT", "TELEFON"], style: 2 },
    ...tickets.map((ticket, index) => ({ values: [
      index + 1,
      ticket.id,
      ticket.client,
      ticket.address,
      ticket.technician,
      ticket.status,
      ticket.date,
      ticket.contact,
      ticket.phone,
    ] })),
  ];

  const sheetRows = rows.map((entry, index) => {
    const rowNumber = index + 1;
    return `<row r="${rowNumber}"${entry.style === 1 ? ' ht="28" customHeight="1"' : ""}>${entry.values.map((value, column) => cell(rowNumber, column, value, entry.style ?? 0)).join("")}</row>`;
  }).join("");
  const lastRow = Math.max(5, rows.length);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="4" width="44" customWidth="1"/><col min="5" max="5" width="22" customWidth="1"/><col min="6" max="6" width="18" customWidth="1"/><col min="7" max="7" width="20" customWidth="1"/><col min="8" max="8" width="24" customWidth="1"/><col min="9" max="9" width="18" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A5:I${lastRow}"/><mergeCells count="1"><mergeCell ref="A1:I1"/></mergeCells></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF35477F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9DFEA"/></left><right style="thin"><color rgb="FFD9DFEA"/></right><top style="thin"><color rgb="FFD9DFEA"/></top><bottom style="thin"><color rgb="FFD9DFEA"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  return zipPackage([
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tichete fără comandă" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", content: sheet },
    { name: "xl/styles.xml", content: styles },
  ]);
}
