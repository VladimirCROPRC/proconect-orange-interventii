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
  assert.match(qaf, /writeCachedValuePreservingFormula\(mainXml, "C79", String\(validationDate\.day\)\)/);
  assert.match(qaf, /writeCachedValuePreservingFormula\(mainXml, "F79", formattedValidationDate, "string"\)/);
  assert.doesNotMatch(qaf, /writeFormula\(mainXml, "F79"/);
  assert.match(qaf, /validatedBy \? row\.documentation_updated_at \?\? row\.updated_at/);
  const cachedWriter = qaf.slice(qaf.indexOf("function writeCachedValuePreservingFormula"), qaf.indexOf("function normalizeCoordinateHelper"));
  assert.ok(cachedWriter.indexOf("selfClosing.test(xml)") < cachedWriter.indexOf("populated.exec(xml)"));
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

test("manual closing date and time feed QAF and both centralizers", async () => {
  const operations = await source("app/intervention-operations.tsx");
  const qaf = await source("app/orange-qaf.ts");
  const centralizer = await source("app/orange-centralizer.ts");
  const oneDrive = await source("app/onedrive-server.ts");
  assert.match(operations, /Data închiderii/);
  assert.match(operations, /closingDate/);
  assert.match(operations, /Ora de închidere/);
  assert.match(operations, /closingTime/);
  assert.match(qaf, /documentation\.closingTime/);
  assert.match(qaf, /manualClosingPlacement\(documentation\.closingDate, documentation\.closingTime, validationDate\)/);
  assert.match(centralizer, /closingTimestamp\(validated\?\.validatedAt, validated\?\.closingDate, validated\?\.closingTime\)/);
  assert.match(oneDrive, /orangeClosingTimestamp\(documentation\?\.validatedAt, documentation\?\.closingDate, documentation\?\.closingTime\)/);
});

test("field photo requirements are enforced by type", async () => {
  const operations = await source("app/intervention-operations.tsx");
  const execution = await source("app/intervention-execution.tsx");
  const server = await source("app/project-server.ts");
  const filesRoute = await source("app/api/files/route.ts");
  assert.match(operations, /damageType === "FO cut" \? 3 : 1/);
  assert.match(server, /assessment\.damageType === "FO cut" \? 3 : 1/);
  assert.match(execution, /junction-open/);
  assert.match(execution, /junction-closed/);
  assert.match(execution, /junction-site/);
  assert.match(server, /usesOrangeLinearMaterial/);
  assert.match(filesRoute, /junction-open\|junction-closed\|junction-site/);
});

test("Orange county is selected from the searchable approved list", async () => {
  const page = await source("app/page.tsx");
  const server = await source("app/project-server.ts");
  const counties = await source("app/orange-counties.ts");
  assert.match(page, /list="orange-counties"/);
  assert.match(server, /orangeCountySet\.has\(countyCandidate\)/);
  assert.match(counties, /Giurgiu County/);
  assert.equal((counties.match(/Vâlcea County/g) ?? []).length, 1);
});

test("Orange ticket creation only requires the ticket number and uses the manual request date and time", async () => {
  const page = await source("app/page.tsx");
  const server = await source("app/project-server.ts");
  const qaf = await source("app/orange-qaf.ts");
  const centralizer = await source("app/orange-centralizer.ts");
  const oneDrive = await source("app/onedrive-server.ts");
  assert.match(page, /Număr tichet \*<\/span><input name="requestId" required/);
  assert.match(page, /Data și ora solicitării intervenției<\/span><input type="datetime-local" name="requestDate"/);
  assert.match(page, /date: isOrangeForm \? String\(form\.get\("requestDate"\)/);
  assert.match(page, /required=\{!isOrangeForm\}/);
  assert.doesNotMatch(server, /Completează toate informațiile obligatorii ale proiectului/);
  assert.match(server, /normalizeRequestDateTime\(input\.date\)/);
  assert.match(qaf, /\[18, requested\]/);
  assert.match(qaf, /time: match\[4\] && match\[5\] \? `\$\{match\[4\]\}:\$\{match\[5\]\}` : ""/);
  assert.match(centralizer, /requestDateTimestamp\(project\.scheduled_label/);
  assert.match(oneDrive, /orangeRequestTimestamp\(project\.scheduled_label/);
});

test("Orange tickets support multiple assigned and completing technicians", async () => {
  const page = await source("app/page.tsx");
  const server = await source("app/project-server.ts");
  const operations = await source("app/intervention-operations.tsx");
  const centralizer = await source("app/orange-centralizer.ts");
  const oneDrive = await source("app/onedrive-server.ts");
  assert.match(page, /name="technicians"/);
  assert.match(page, /project\.technicians \?\? \[project\.technician\]/);
  assert.match(server, /encodedTechnicianUsernames/);
  assert.match(server, /instr\(technician_username, \?\) > 0/);
  assert.match(operations, /completedByTechnicians/);
  assert.match(operations, /Fără selecție, Centralizatorul va folosi echipa alocată inițial/);
  assert.match(centralizer, /validated\?\.completedByTechnicians/);
  assert.match(centralizer, /\n\s*completedBy,/);
  assert.match(oneDrive, /values\[13\] = completedBy/);
});

test("Orange technicians are not asked for Pretask or EIP", async () => {
  const page = await source("app/page.tsx");
  const server = await source("app/project-server.ts");
  const filesRoute = await source("app/api/files/route.ts");
  assert.match(page, /selected\?\.activityType === "Intervenție Orange"/);
  assert.match(page, /nextProject\.activityType !== "Intervenție Orange"/);
  assert.match(page, /project\.activityType !== "Intervenție Orange" && !safetyChecks/);
  assert.match(server, /project\?\.activity_type === "Intervenție Orange"\) return true|project\.activity_type === "Intervenție Orange"\) return true/);
  assert.match(server, /safetyChecks\[project\.id\] = \{ pretask: false, ppe: false, completed: true \}/);
  assert.match(filesRoute, /Tichetele Orange nu utilizează fotografii Pretask\/EIP/);
});

test("monthly Anexa 3 reports are grouped by technician and contractor", async () => {
  const page = await source("app/page.tsx");
  const reports = await source("app/monthly-contractor-reports.ts");
  const route = await source("app/api/monthly-reports/route.ts");
  const accounts = await source("app/api/accounts/route.ts");
  assert.match(page, /Rapoarte lunare/);
  assert.match(page, /saveTechnicianContractor/);
  assert.match(reports, /completedByTechnicians/);
  assert.match(reports, /subjectsFor\("technician"/);
  assert.match(reports, /subjectsFor\("contractor"/);
  assert.match(reports, /Material custodie/);
  assert.match(reports, /validatedRemediation: String\(documentation\.remediationDescription \?\? ""\)\.trim\(\)/);
  assert.match(reports, /boqItem: service\.code/);
  assert.match(reports, /textCell\(`F\$\{row\}`, line\.workDescription/);
  assert.match(reports, /textCell\(`G\$\{row\}`, line\.boqItem/);
  assert.doesNotMatch(reports, /documentation\.remediationDescription \?\? intervention\.execution/);
  assert.match(reports, /Anexa-3-Contractor\.xlsx/);
  assert.match(route, /buildAllMonthlyReports/);
  assert.match(accounts, /updateAccountContractor/);
  assert.match(reports, /CREATE TABLE IF NOT EXISTS technician_contractors/);
});
