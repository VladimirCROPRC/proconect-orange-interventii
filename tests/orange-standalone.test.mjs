import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

async function sourceFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = `${directory}${entry.name}`;
    if (entry.isDirectory()) files.push(...await sourceFiles(`${relative}/`));
    else if (/\.(?:ts|tsx|js|mjs|json|md|sql)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

test("uses dedicated Orange Cloudflare resources", async () => {
  const wrangler = await source("wrangler.jsonc");
  assert.match(wrangler, /proconect-orange-interventii-db/);
  assert.match(wrangler, /proconect-orange-interventii-files/);
  assert.match(wrangler, /"database_id"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/i);
  assert.doesNotMatch(wrangler, /6624aba0-1008-423d-8599-1e840a60cadc/);

  const forbidden = [["op", "tix"].join(""), ["voda", "fone"].join("")];
  const files = [
    ...await sourceFiles("app/"),
    ...await sourceFiles("db/"),
    ...await sourceFiles("public/"),
    ...await sourceFiles("scripts/"),
  ];
  for (const file of files) {
    const contents = (await source(file)).toLowerCase();
    for (const token of forbidden) assert.equal(contents.includes(token), false, `${file} contains a forbidden network reference`);
  }
});

test("server accepts and returns only Orange interventions", async () => {
  const server = await source("app/project-server.ts");
  assert.match(server, /activity_type = 'Intervenție Orange'/);
  assert.match(server, /Această aplicație acceptă exclusiv intervenții Orange/);
  assert.match(server, /if \(project\.activity_type !== "Intervenție Orange"\)/);

  const schema = await source("db/schema.ts");
  assert.match(schema, /activity_type"\)\.notNull\(\)\.default\("Intervenție Orange"\)/);

  const databaseGuard = await source("drizzle/0011_orange_only_guard.sql");
  assert.match(databaseGuard, /projects_orange_only_insert/);
  assert.match(databaseGuard, /projects_orange_only_update/);
  assert.match(databaseGuard, /NEW\.`activity_type` <> 'Intervenție Orange'/);
});

test("Orange is the default and only activity in navigation", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /useState<View>\("orange-interventions"\)/);
  assert.match(page, /const isActivityListView = view === "orange-interventions"/);
  const navigation = page.slice(page.indexOf('<nav className="side-nav">'), page.indexOf('</nav>', page.indexOf('<nav className="side-nav">')));
  assert.match(navigation, /Intervenții Orange/);
  assert.doesNotMatch(navigation, /> Instalări/);
  assert.doesNotMatch(navigation, /> Survey/);
});

test("OneDrive uses the existing Orange reports hierarchy", async () => {
  const oneDrive = await source("app/onedrive-server.ts");
  assert.match(oneDrive, /OROC \+ ORO/);
  assert.match(oneDrive, /Rapoarte incidente Pro Conect/);
  assert.match(oneDrive, /rapoarte de interventie/);
  assert.match(oneDrive, /romanianMonths/);
  assert.doesNotMatch(oneDrive, /"Depuse"/);
});

test("QAF records the coordinator who validates the intervention", async () => {
  const qaf = await source("app/orange-qaf.ts");
  assert.match(qaf, /validatedBy/);
  assert.match(qaf, /\["C77", documentation\.validatedBy\]/);
  assert.match(qaf, /writeCachedValuePreservingFormula\(mainXml, "C79", String\(finalized\.day\)\)/);
  assert.match(qaf, /writeCachedValuePreservingFormula\(mainXml, "F79", validationDate, "string"\)/);
  assert.doesNotMatch(qaf, /writeFormula\(mainXml, "F79"/);
});

test("QAF preserves the original workbook hyperlink formulas", async () => {
  const qaf = await source("app/orange-qaf.ts");
  assert.doesNotMatch(qaf, /mainRelationships|rIdMap|mapLinks|addMapLink/);
  assert.doesNotMatch(qaf, /writeText\(mainXml, "G34"/);
  assert.doesNotMatch(qaf, /NUMBERVALUE/);
  assert.match(qaf, /LAT ok, LONG ok/);
  assert.match(qaf, /writeText\(mainXml, "C34", latitude\)/);
  assert.match(qaf, /fullCalcOnLoad="1"/);
});
