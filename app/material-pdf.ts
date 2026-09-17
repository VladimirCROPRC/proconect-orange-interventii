import { getRawDb } from "../db";

type MaterialRow = { name: string; quantity: number; unit: string };
type Documentation = {
  route?: {
    segments?: Array<{ cableType?: string; lengthMeters?: number }>;
    aerialMaterials?: { boat?: number; stainlessClamp?: number; hook?: number; armorod?: number };
  };
};

function ascii(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ș/g, "s").replace(/Ș/g, "S").replace(/ț/g, "t").replace(/Ț/g, "T").replace(/[^\x20-\x7e]/g, "?");
}

function pdfText(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function materialPdf(input: { projectId: string; client: string; address: string; orange: MaterialRow[]; proconect: MaterialRow[] }) {
  const commands: string[] = [];
  const text = (x: number, y: number, size: number, value: string, bold = false) => commands.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`);
  const line = (x1: number, y1: number, x2: number, y2: number) => commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  const fill = (x: number, y: number, width: number, height: number, gray: number) => commands.push(`${gray} g ${x} ${y} ${width} ${height} re f 0 g`);

  text(42, 550, 20, "FISA DE MATERIALE", true);
  text(650, 550, 12, input.projectId, true);
  line(42, 540, 800, 540);
  text(42, 516, 9, "CLIENT", true);
  text(105, 516, 11, input.client || "-", true);
  text(420, 516, 9, "LOCATIE", true);
  text(475, 516, 10, input.address || "-");

  let y = 475;
  const table = (title: string, rows: MaterialRow[]) => {
    text(42, y, 14, title, true);
    y -= 22;
    fill(42, y - 4, 758, 22, 0.18);
    commands.push("1 g");
    text(52, y + 3, 9, "NR.", true);
    text(100, y + 3, 9, "MATERIAL", true);
    text(650, y + 3, 9, "CANTITATE", true);
    text(750, y + 3, 9, "UM", true);
    commands.push("0 g");
    y -= 22;
    const displayed = rows.length ? rows : [{ name: "Nu exista materiale documentate.", quantity: 0, unit: "-" }];
    displayed.forEach((row, index) => {
      if (index % 2 === 1) fill(42, y - 4, 758, 20, 0.95);
      text(56, y + 2, 9, String(index + 1));
      text(100, y + 2, 9, row.name);
      text(672, y + 2, 9, row.quantity.toLocaleString("ro-RO"));
      text(750, y + 2, 9, row.unit);
      line(42, y - 5, 800, y - 5);
      y -= 20;
    });
    y -= 26;
  };

  table("Materiale Orange", input.orange);
  table("Materiale Proconect", input.proconect);
  text(42, 28, 8, `${input.projectId} - ${input.client} - Cantitati preluate din documentatia proiectului`);

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output).buffer as ArrayBuffer;
}

export async function buildMaterialSheetPdf(projectId: string) {
  const row = await getRawDb().prepare(
    "SELECT projects.client, projects.address, projects.cpe, projects.sfp, projects.mc, projects.mc_type, projects.terminal_box, project_field_documentation.content_json FROM projects LEFT JOIN project_field_documentation ON project_field_documentation.project_id = projects.id WHERE projects.id = ? LIMIT 1"
  ).bind(projectId).first<{ client: string; address: string; cpe: string; sfp: number; mc: number; mc_type: string; terminal_box: number; content_json?: string }>();
  if (!row) return null;
  let documentation: Documentation = {};
  try { if (row.content_json) documentation = JSON.parse(row.content_json); } catch { documentation = {}; }

  const cableTotals = new Map<string, number>();
  for (const segment of documentation.route?.segments ?? []) {
    const name = segment.cableType?.trim();
    const quantity = Number(segment.lengthMeters ?? 0);
    if (name && quantity > 0) cableTotals.set(name, (cableTotals.get(name) ?? 0) + quantity);
  }
  const orange: MaterialRow[] = [
    ...(row.cpe ? [{ name: `CPE ${row.cpe}`, quantity: 1, unit: "buc." }] : []),
    ...(row.sfp ? [{ name: "SFP", quantity: 1, unit: "buc." }] : []),
    ...(row.mc ? [{ name: `Media Converter${row.mc_type ? ` ${row.mc_type}` : ""}`, quantity: 1, unit: "buc." }] : []),
    ...(row.terminal_box ? [{ name: "Terminal Box", quantity: 1, unit: "buc." }] : []),
    ...[...cableTotals].map(([name, quantity]) => ({ name, quantity, unit: "m" })),
  ];
  const aerial = documentation.route?.aerialMaterials;
  const proconect: MaterialRow[] = [
    { name: "Barcuta", quantity: Number(aerial?.boat ?? 0), unit: "buc." },
    { name: "Colier tabla inox", quantity: Number(aerial?.stainlessClamp ?? 0), unit: "buc." },
    { name: "Carlig", quantity: Number(aerial?.hook ?? 0), unit: "buc." },
    { name: "Armorod", quantity: Number(aerial?.armorod ?? 0), unit: "buc." },
  ].filter((item) => item.quantity > 0);

  return materialPdf({ projectId, client: row.client, address: row.address, orange, proconect });
}
