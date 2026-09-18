import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { bucket, getFileRow } from "./project-server";
import { buildAcceptanceReportDocx } from "./report-docx";
import { buildSpliceSheetXlsx } from "./splice-xlsx";
import { buildMaterialSheetPdf } from "./material-pdf";
import { buildOrangeQafXlsx } from "./orange-qaf";
import { buildOrangeKmz } from "./orange-kmz";
import { base64url, decode64, fixedOrigin, retryDelay, safeName, usesOneDrive, validMode, type BackupMode } from "./onedrive-core";

type Environment = { PROCONECT_APP_URL?: string; ONEDRIVE_CLIENT_ID?: string; ONEDRIVE_TENANT_ID?: string; ONEDRIVE_CLIENT_SECRET?: string; ONEDRIVE_ENCRYPTION_KEY?: string; ORANGE_TICKETS_WORKBOOK_URL?: string };
type Connection = { mode: BackupMode; generation: string; access_token: string; refresh_token: string; expires_at: number; drive_id: string; root_id: string; root_url: string; account: string; owner_id: string; lease: string; lease_until: number };
type Job = { id: string; kind: "file" | "project"; item_id: string; revision: number; attempts: number };
type Item = { id: string; webUrl?: string; folder?: object; driveType?: string; owner?: { user?: { id?: string; displayName?: string; email?: string } } };
const encoder = new TextEncoder();
const settingsId = "onedrive";
const scope = "offline_access https://graph.microsoft.com/Files.ReadWrite";
const environment = () => env as unknown as Environment;
export function oneDriveConfigured() {
  const e = environment();
  return Boolean(e.PROCONECT_APP_URL && e.ONEDRIVE_CLIENT_ID && e.ONEDRIVE_TENANT_ID && e.ONEDRIVE_CLIENT_SECRET && e.ONEDRIVE_ENCRYPTION_KEY);
}
function config() {
  const e = environment();
  if (!oneDriveConfigured()) throw new Error("Configurează variabilele OneDrive în Cloudflare înainte de conectare.");
  const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!guid.test(e.ONEDRIVE_CLIENT_ID!) || !guid.test(e.ONEDRIVE_TENANT_ID!) || !/^[a-f0-9]{64}$/i.test(e.ONEDRIVE_ENCRYPTION_KEY!)) throw new Error("Configurarea OneDrive nu este validă.");
  return { client: e.ONEDRIVE_CLIENT_ID!, tenant: e.ONEDRIVE_TENANT_ID!, secret: e.ONEDRIVE_CLIENT_SECRET!, key: e.ONEDRIVE_ENCRYPTION_KEY!, origin: fixedOrigin(e.PROCONECT_APP_URL!) };
}
async function cryptKey() {
  return crypto.subtle.importKey("raw", Uint8Array.from(config().key.match(/../g)!, n => parseInt(n, 16)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode("proconect-onedrive-v1") }, await cryptKey(), encoder.encode(value));
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}
async function unseal(value: string) {
  const [iv, ciphertext] = value.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode64(iv), additionalData: encoder.encode("proconect-onedrive-v1") }, await cryptKey(), decode64(ciphertext)));
}
async function connection() {
  return getRawDb().prepare("SELECT * FROM onedrive_connection WHERE id = ?").bind(settingsId).first<Connection>();
}
export async function backupMode(): Promise<BackupMode> {
  // A rollout without OneDrive secrets must keep the existing Google integration working.
  if (!oneDriveConfigured()) return "google";
  return (await connection())?.mode ?? "google";
}
export function oneDriveSameOrigin(request: Request) {
  try { return request.headers.get("Origin") === config().origin; } catch { return false; }
}
class RemoteFailure extends Error {
  constructor(message: string, public delay = 30_000) { super(message); }
}
async function exchange(parameters: URLSearchParams) {
  const c = config();
  parameters.set("client_id", c.client); parameters.set("client_secret", c.secret);
  let response: Response;
  try {
    response = await fetch(`https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/token`, { method: "POST", body: parameters, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new RemoteFailure("MICROSOFT_TOKEN:network");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: unknown };
    const allowed = new Set(["invalid_client", "invalid_grant", "invalid_scope", "unauthorized_client", "interaction_required", "temporarily_unavailable"]);
    const code = typeof payload.error === "string" && allowed.has(payload.error) ? payload.error : "other";
    throw new RemoteFailure(`MICROSOFT_TOKEN:${code}`);
  }
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new RemoteFailure("Microsoft nu a returnat un token valid.");
  return tokens;
}
async function graph(token: string, path: string, options: RequestInit = {}) {
  const workbookPath = /^\/drives\/[^/]+\/items\/[^/]+\/workbook(?:\/|$)/.test(path);
  if (!path.startsWith("/me/drive") && !path.startsWith("/shares/") && !workbookPath) throw new Error("Adresă Graph nepermisă.");
  const headers = new Headers(options.headers); headers.set("Authorization", `Bearer ${token}`);
  return fetch(`https://graph.microsoft.com/v1.0${path}`, { ...options, headers, signal: AbortSignal.timeout(20_000) });
}
async function checked(response: Response): Promise<Item> {
  if (!response.ok) throw new RemoteFailure(`OneDrive: operațiunea a eșuat (HTTP ${response.status}).${response.status === 401 || response.status === 403 ? " Reconectează contul sau solicită aprobarea IT." : ""}`, retryDelay(0, response.headers.get("Retry-After")));
  return response.json() as Promise<Item>;
}
async function folder(token: string, parent: string, name: string) {
  const path = `/me/drive/items/${encodeURIComponent(parent)}`;
  const lookup = () => graph(token, `${path}:/${encodeURIComponent(name)}`);
  let response = await lookup();
  if (response.status === 404) {
    response = await graph(token, `${path}/children`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }) });
    if (response.status === 409) response = await lookup();
  }
  const item = await checked(response);
  if (!item.id || !item.folder) throw new Error("Destinația OneDrive nu este un dosar.");
  return item;
}
export async function beginOneDrive(sessionId: string) {
  const c = config();
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM onedrive_oauth_states WHERE expires_at < ? OR session_id = ?").bind(Date.now(), sessionId),
    getRawDb().prepare("INSERT INTO onedrive_oauth_states (id, session_id, verifier, expires_at) VALUES (?, ?, ?, ?)").bind(state, sessionId, await seal(verifier), Date.now() + 600_000),
  ]);
  const parameters = new URLSearchParams({ client_id: c.client, redirect_uri: `${c.origin}/api/onedrive/callback`, response_type: "code", response_mode: "query", scope, state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  return `https://login.microsoftonline.com/${c.tenant}/oauth2/v2.0/authorize?${parameters}`;
}
async function oneDriveStage<T>(name: string, action: () => Promise<T>) {
  try { return await action(); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("MICROSOFT_TOKEN:")) throw error;
    throw new Error(`ONEDRIVE_STAGE:${name}`);
  }
}
export async function finishOneDrive(sessionId: string, state: string, code: string) {
  const c = config();
  // DELETE RETURNING atomically consumes state, bound to the current app session.
  const authorization = await oneDriveStage("state-db", () => getRawDb().prepare("DELETE FROM onedrive_oauth_states WHERE id = ? AND session_id = ? AND expires_at > ? RETURNING verifier").bind(state, sessionId, Date.now()).first<{ verifier: string }>());
  if (!authorization) throw new Error("Autorizarea a expirat sau a fost deja folosită. Reîncearcă din aplicație.");
  const verifier = await oneDriveStage("state-decrypt", () => unseal(authorization.verifier));
  const tokens = await oneDriveStage("token", () => exchange(new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: `${c.origin}/api/onedrive/callback`, scope })));
  if (!tokens.refresh_token) throw new Error("Microsoft nu a acordat acces pentru sincronizarea în fundal.");
  const drive = await oneDriveStage("drive", async () => checked(await graph(tokens.access_token!, "/me/drive")));
  if (drive.driveType !== "business" || !drive.id) throw new Error("Conectează contul OneDrive de serviciu Microsoft 365.");
  const existing = await oneDriveStage("connection-db", () => connection());
  if (existing?.drive_id && existing.drive_id !== drive.id) throw new Error("Este conectat alt OneDrive. Deconectează-l explicit înainte de schimbarea contului.");
  const root = await oneDriveStage("root", async () => checked(await graph(tokens.access_token!, "/me/drive/root")));
  const destination = await oneDriveStage("folder", async () => {
    const operationalRoot = await folder(tokens.access_token!, root.id, "OROC + ORO");
    const orange = await folder(tokens.access_token!, operationalRoot.id, "Orange");
    return folder(tokens.access_token!, orange.id, "Rapoarte incidente Pro Conect");
  });
  const generation = crypto.randomUUID();
  await oneDriveStage("save-db", async () => {
    const accessToken = await seal(tokens.access_token!);
    const refreshToken = await seal(tokens.refresh_token!);
    return getRawDb().prepare("INSERT INTO onedrive_connection (id, mode, generation, access_token, refresh_token, expires_at, drive_id, root_id, root_url, account, owner_id, lease, lease_until) VALUES (?, 'google', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0) ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, drive_id = excluded.drive_id, root_id = excluded.root_id, root_url = excluded.root_url, account = excluded.account, owner_id = excluded.owner_id, lease = '', lease_until = 0")
      .bind(settingsId, generation, accessToken, refreshToken, Date.now() + (tokens.expires_in ?? 3600) * 1000, drive.id, destination.id, destination.webUrl ?? "", drive.owner?.user?.email ?? drive.owner?.user?.displayName ?? "OneDrive Microsoft 365", drive.owner?.user?.id ?? "").run();
  });
}
export async function setBackupMode(value: unknown) {
  if (!validMode(value)) throw new Error("Destinație de salvare invalidă.");
  const c = await connection();
  if (usesOneDrive(value) && !c?.refresh_token) throw new Error("Conectează mai întâi OneDrive.");
  if (!c) return;
  await getRawDb().prepare("UPDATE onedrive_connection SET mode = ? WHERE id = ?").bind(value, settingsId).run();
  if (usesOneDrive(value)) await seedOneDrive();
}
export async function disconnectOneDrive() {
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM onedrive_oauth_states"),
    getRawDb().prepare("DELETE FROM onedrive_jobs"),
    getRawDb().prepare("DELETE FROM onedrive_connection"),
  ]);
  // Remote archives are deliberately retained. Revoke consent separately in Microsoft.
}
export async function queueOneDrive(kind: "file" | "project", id: string) {
  if (!usesOneDrive(await backupMode())) return;
  await getRawDb().prepare("INSERT INTO onedrive_jobs (id, kind, item_id, revision, done_revision, attempts, next_at, last_error) VALUES (?, ?, ?, 1, 0, 0, 0, '') ON CONFLICT(id) DO UPDATE SET revision = revision + 1, attempts = 0, next_at = 0, last_error = ''")
    .bind(`${kind}:${id}`, kind, id).run();
}
export async function seedOneDrive() {
  if (!usesOneDrive(await backupMode())) return;
  await getRawDb().batch([
    getRawDb().prepare("INSERT OR IGNORE INTO onedrive_jobs (id, kind, item_id) SELECT 'file:' || id, 'file', id FROM project_files"),
    getRawDb().prepare("INSERT OR IGNORE INTO onedrive_jobs (id, kind, item_id) SELECT 'project:' || id, 'project', id FROM projects"),
  ]);
}
export async function retryOneDrive() {
  await seedOneDrive();
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM onedrive_jobs WHERE kind = 'file' AND NOT EXISTS (SELECT 1 FROM project_files WHERE project_files.id = onedrive_jobs.item_id)"),
    getRawDb().prepare("DELETE FROM onedrive_jobs WHERE kind = 'project' AND NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = onedrive_jobs.item_id)"),
    getRawDb().prepare("UPDATE onedrive_jobs SET revision = revision + 1, attempts = 0, next_at = 0, last_error = '' WHERE (kind = 'file' AND EXISTS (SELECT 1 FROM project_files WHERE project_files.id = onedrive_jobs.item_id)) OR (kind = 'project' AND EXISTS (SELECT 1 FROM projects WHERE projects.id = onedrive_jobs.item_id))"),
  ]);
}
export async function oneDriveStatus() {
  const configured = oneDriveConfigured();
  if (!configured) return { configured: false, connected: false, mode: "google", account: "", rootUrl: "", synced: 0, pending: 0, errors: [] };
  config();
  const c = await connection();
  const counts = await getRawDb().prepare("SELECT SUM(CASE WHEN done_revision = revision THEN 1 ELSE 0 END) AS synced, SUM(CASE WHEN done_revision < revision THEN 1 ELSE 0 END) AS pending FROM onedrive_jobs").first<{ synced: number; pending: number }>();
  const errors = await getRawDb().prepare("SELECT kind, item_id, last_error FROM onedrive_jobs WHERE last_error != '' ORDER BY next_at LIMIT 10").all();
  return { configured, connected: Boolean(c?.refresh_token), mode: c?.mode ?? "google", account: c?.account ?? "", rootUrl: c?.root_url ?? "", synced: counts?.synced ?? 0, pending: counts?.pending ?? 0, errors: errors.results ?? [] };
}
type OrangeWorkbookDriveItem = {
  id?: string;
  parentReference?: { driveId?: string };
  remoteItem?: { id?: string; parentReference?: { driveId?: string } };
};
type WorkbookRange = { values?: unknown[][] };

function orangeWorkbookUrl() {
  const value = environment().ORANGE_TICKETS_WORKBOOK_URL?.trim();
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".sharepoint.com")) throw new Error("ORANGE_TICKETS_WORKBOOK_URL trebuie să fie un link SharePoint HTTPS.");
  return url.toString();
}

function bucharestTimestamp(value: number) {
  const parts = new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function orangeRequestTimestamp(value: string | undefined, fallback: number) {
  if (typeof value === "string" && !value.trim()) return "";
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`
    : bucharestTimestamp(fallback);
}

function orangeClosingTimestamp(validatedAt: number | undefined, closingDate: string | undefined, closingTime: string | undefined) {
  if (!validatedAt) return "";
  const timestamp = bucharestTimestamp(validatedAt);
  return closingDate && /^\d{4}-\d{2}-\d{2}$/.test(closingDate) && closingTime && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(closingTime)
    ? `${closingDate.slice(8, 10)}.${closingDate.slice(5, 7)}.${closingDate.slice(0, 4)} ${closingTime}:00`
    : timestamp;
}

async function graphJson<T>(response: Response) {
  if (!response.ok) {
    const explanation = response.status === 423
      ? " Registrul este temporar blocat de Excel/OneDrive; sincronizarea va reîncerca automat după eliberarea lui."
      : response.status === 401 || response.status === 403
        ? " Reconectează contul Microsoft sau verifică accesul la registru."
        : "";
    throw new RemoteFailure(`Excel Online: operațiunea a eșuat (HTTP ${response.status}).${explanation}`, retryDelay(0, response.headers.get("Retry-After")));
  }
  return response.json() as Promise<T>;
}

export async function syncOrangeTicketWorkbook(projectId: string) {
  const workbookUrl = orangeWorkbookUrl();
  if (!workbookUrl) return { configured: false, written: false };
  const c = await connection();
  if (!c?.refresh_token) throw new Error("Conectează contul Microsoft 365 pentru registrul tichetelor Orange.");
  const project = await getRawDb().prepare(
    "SELECT projects.id, projects.activity_type, projects.fo_section_name, projects.topology, projects.cable_capacity, projects.route_type, projects.orange_intervention_type, projects.sla, projects.departure_locality, projects.county, projects.requirements, projects.technician, projects.scheduled_label, projects.created_at, projects.status, project_field_documentation.content_json AS documentation_json FROM projects LEFT JOIN project_field_documentation ON project_field_documentation.project_id = projects.id WHERE projects.id = ? LIMIT 1",
  ).bind(projectId).first<{
    id: string; activity_type: string; fo_section_name: string; topology: string; cable_capacity: number;
    route_type: string; orange_intervention_type: string; sla: string; departure_locality: string; county: string;
    requirements: string; technician: string; scheduled_label: string; created_at: number; status: string; documentation_json?: string;
  }>();
  if (!project || project.activity_type !== "Intervenție Orange") return { configured: true, written: false };

  let intervention: {
    assessment?: { arrivedAt?: number; documentedAt?: number; incidentDescription?: string; damageLocation?: { lat?: number; lon?: number; placedAt?: number } };
    execution?: { remediationDescription?: string };
    documentation?: { validatedAt?: number; validatedBy?: string; closingDate?: string; closingTime?: string; incidentDescription?: string; remediationDescription?: string };
  } = {};
  try { intervention = project.documentation_json ? (JSON.parse(project.documentation_json).intervention ?? {}) : {}; } catch { intervention = {}; }
  const assessment = intervention.assessment;
  const documentation = intervention.documentation;
  const damageLocation = assessment?.damageLocation;
  const incidentDescription = documentation?.incidentDescription ?? assessment?.incidentDescription ?? project.requirements;
  const remediationDescription = documentation?.remediationDescription ?? intervention.execution?.remediationDescription ?? "";

  const token = await tokenFor(c);
  const shareId = `u!${base64url(encoder.encode(workbookUrl))}`;
  const shared = await graphJson<OrangeWorkbookDriveItem>(await graph(token, `/shares/${encodeURIComponent(shareId)}/driveItem?$select=id,parentReference,remoteItem`, {
    headers: { Prefer: "redeemSharingLinkIfNecessary" },
  }));
  const itemId = shared.remoteItem?.id ?? shared.id;
  const driveId = shared.remoteItem?.parentReference?.driveId ?? shared.parentReference?.driveId;
  if (!itemId || !driveId) throw new RemoteFailure("Excel Online: registrul partajat nu a putut fi identificat.");

  const workbook = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook`;
  const ticketColumn = await graph(token, `${workbook}/tables/Table1/columns/${encodeURIComponent("Ticket ID")}/dataBodyRange?$select=values`);
  let existingIndex = -1;
  if (ticketColumn.ok) {
    const range = await ticketColumn.json() as WorkbookRange;
    existingIndex = (range.values ?? []).findIndex((row) => String(row[0] ?? "").trim().toUpperCase() === project.id.toUpperCase());
  } else if (ticketColumn.status !== 404) {
    await graphJson(ticketColumn);
  }

  // Table1 in the existing ENO3 centralizer spans A:AE (31 columns).
  // Microsoft Graph rejects rows whose value count differs from the table width.
  let values = Array.from({ length: 31 }, () => "") as Array<string | number>;
  if (existingIndex >= 0) {
    const existingRow = await graphJson<WorkbookRange>(await graph(token, `${workbook}/tables/Table1/rows/itemAt(index=${existingIndex})/range?$select=values`));
    if (existingRow.values?.[0]?.length === 31) values = existingRow.values[0].map((value) => typeof value === "number" ? value : String(value ?? ""));
  }
  values[1] = project.fo_section_name;
  values[3] = project.id;
  values[4] = project.departure_locality;
  values[5] = project.county;
  values[6] = documentation?.validatedBy ?? "";
  values[7] = project.topology;
  values[8] = project.status === "Finalizat" ? "Raport finalizat" : assessment ? "În lucru" : "Tichet generat";
  values[9] = project.sla;
  values[11] = orangeRequestTimestamp(project.scheduled_label, project.created_at);
  values[12] = project.technician;
  values[13] = project.technician;
  values[14] = assessment?.arrivedAt ? bucharestTimestamp(assessment.arrivedAt) : "";
  values[15] = damageLocation?.placedAt || assessment?.documentedAt ? bucharestTimestamp(damageLocation?.placedAt ?? assessment!.documentedAt!) : "";
  values[16] = orangeClosingTimestamp(documentation?.validatedAt, documentation?.closingDate, documentation?.closingTime);
  values[17] = project.cable_capacity;
  values[18] = incidentDescription;
  values[20] = "";
  values[21] = remediationDescription;
  values[22] = typeof damageLocation?.lat === "number" && typeof damageLocation?.lon === "number" ? `${damageLocation.lat.toFixed(6)}, ${damageLocation.lon.toFixed(6)}` : "";
  values[23] = "";

  const rowPath = existingIndex >= 0 ? `${workbook}/tables/Table1/rows/itemAt(index=${existingIndex})/range` : `${workbook}/tables/Table1/rows/add`;
  await graphJson(await graph(token, rowPath, {
    method: existingIndex >= 0 ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(existingIndex >= 0 ? { values: [values] } : { index: null, values: [values] }),
  }));
  return { configured: true, written: existingIndex < 0, updated: existingIndex >= 0 };
}

async function tokenFor(c: Connection) {
  if (c.expires_at > Date.now() + 60_000) return unseal(c.access_token);
  const tokens = await exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: await unseal(c.refresh_token), scope }));
  const result = await getRawDb().prepare("UPDATE onedrive_connection SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ? AND generation = ? AND lease = ?")
    .bind(await seal(tokens.access_token!), tokens.refresh_token ? await seal(tokens.refresh_token) : c.refresh_token, Date.now() + (tokens.expires_in ?? 3600) * 1000, settingsId, c.generation, c.lease).run();
  if (!result.meta.changes) throw new Error("Conexiunea OneDrive s-a schimbat. Reîncearcă.");
  return tokens.access_token!;
}
type OneDriveActivity = "Instalare" | "Intervenție" | "Intervenție Orange" | "Survey";
const oneDriveActivityFolders: Record<OneDriveActivity, string> = {
  Instalare: "Instalări",
  "Intervenție": "Intervenții",
  "Intervenție Orange": "Interventii Orange",
  Survey: "Survey",
};
const oneDriveSectionFolders: Record<OneDriveActivity, Record<string, string>> = {
  Instalare: {
    project: "01_Documente proiect",
    safety: "02_Pretask și EIP",
    client: "03_Client",
    route: "04_Traseu FO",
    splices: "05_Suduri FO",
    site: "06_Operațiuni site",
    documents: "07_Documente administrative",
  },
  "Intervenție": {
    safety: "01_Pretask și EIP",
    "intervention-assessment": "02_Constatare",
    "intervention-execution": "03_Execuție",
    "intervention-documentation": "04_Documentare",
    project: "05_Documente intervenție",
    documents: "06_Documente administrative",
  },
  "Intervenție Orange": {},
  Survey: {
    safety: "01_Pretask și EIP",
    project: "02_Documente survey",
    documents: "03_Documente administrative",
  },
};
function readableFolderName(value: string) {
  return value.normalize("NFC").replace(/[\u0000-\u001f"*:<>?\/\\|#%]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 140) || "Lucrare";
}

function validOrangeTicketId(value: string) {
  return /^(IMO|FITT|PBM)\d+$/i.test(value.trim());
}

const romanianMonths = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];

function shortOrangeTicket(projectId: string) {
  const match = /^(IMO|FITT|PBM)0*(\d+)$/i.exec(projectId.trim());
  return match ? `${match[1].toUpperCase()}${match[2]}` : projectId.trim();
}

async function orangeProjectDestination(token: string, rootId: string, projectId: string) {
  const project = await getRawDb().prepare("SELECT departure_locality, county, scheduled_label, created_at FROM projects WHERE id = ? LIMIT 1")
    .bind(projectId).first<{ departure_locality?: string; county?: string; scheduled_label?: string; created_at?: number }>();
  if (!project) throw new Error("Tichetul Orange nu mai există.");
  const date = project.scheduled_label && /^\d{4}-\d{2}-\d{2}$/.test(project.scheduled_label)
    ? new Date(`${project.scheduled_label}T12:00:00Z`)
    : new Date(project.created_at ?? Date.now());
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Bucharest", year: "numeric" }).format(date));
  const month = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Bucharest", month: "2-digit" }).format(date));
  const day = new Intl.DateTimeFormat("en", { timeZone: "Europe/Bucharest", day: "2-digit" }).format(date);
  const yearFolder = await folder(token, rootId, `ENO3 Y${Math.max(1, year - 2022)} - ${year}- rapoarte de interventie`);
  const monthFolder = await folder(token, yearFolder.id, `${String(month).padStart(2, "0")} ${romanianMonths[month - 1]} ${year}`);
  const location = [project.departure_locality, project.county].filter(Boolean).map((value) => readableFolderName(String(value)).replace(/\s+/g, "")).join("_");
  const ticketFolderName = `${day}.${String(month).padStart(2, "0")}.${year}_${projectId}${location ? `_${location}` : ""}`;
  return folder(token, monthFolder.id, readableFolderName(ticketFolderName));
}

async function oneDriveDestination(token: string, rootId: string, projectId: string, activity: OneDriveActivity, section: string) {
  if (activity === "Intervenție Orange") return orangeProjectDestination(token, rootId, projectId);
  const activityFolder = await folder(token, rootId, oneDriveActivityFolders[activity]);
  const projectFolder = await folder(token, activityFolder.id, readableFolderName(projectId));
  const sectionName = oneDriveSectionFolders[activity][section] ?? "99_Alte documente";
  return folder(token, projectFolder.id, sectionName);
}
function splicePhotoFolder(category: string) {
  const parts = category.split(":");
  if (parts.length < 3) return "";
  const token = parts[1] ?? "";
  if (!token) return "";
  const undocumented = /^J_nedocumentata_(\d+)$/i.exec(token);
  return undocumented ? `J nedocumentată ${undocumented[1]}` : token;
}

async function oneDriveFileDestination(token: string, rootId: string, projectId: string, activity: OneDriveActivity, section: string, category: string, filename: string) {
  const destination = await oneDriveDestination(token, rootId, projectId, activity, section);
  if (activity === "Intervenție Orange") {
    return /\.kmz$/i.test(filename) ? destination : folder(token, destination.id, shortOrangeTicket(projectId));
  }
  const spliceFolder = section === "splices" ? splicePhotoFolder(category) : "";
  return spliceFolder ? folder(token, destination.id, spliceFolder) : destination;
}

async function uploadAcceptanceReport(token: string, projectId: string, destinationId: string) {
  const saved = await getRawDb().prepare("SELECT content_json FROM project_reports WHERE project_id = ? LIMIT 1").bind(projectId).first<{ content_json: string }>();
  if (!saved) return;
  let report: Record<string, string>;
  try { report = JSON.parse(saved.content_json); } catch { return; }
  const document = buildAcceptanceReportDocx(projectId, report);
  const filename = `Raport acceptanță - ${readableFolderName(projectId)}.docx`;
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destinationId)}:/${encodeURIComponent(filename)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    body: document,
  }));
}

async function uploadSpliceSheet(token: string, projectId: string, destinationId: string) {
  const row = await getRawDb().prepare(
    "SELECT projects.client, projects.address, project_field_documentation.content_json AS documentation_json, project_reports.content_json AS report_json FROM projects LEFT JOIN project_field_documentation ON project_field_documentation.project_id = projects.id LEFT JOIN project_reports ON project_reports.project_id = projects.id WHERE projects.id = ? LIMIT 1"
  ).bind(projectId).first<{ client: string; address: string; documentation_json?: string; report_json?: string }>();
  if (!row?.documentation_json) return;

  let documentation: { splices?: { noIntervention?: boolean; noInterventionReason?: string; count?: number; records?: Array<{ junction?: { code?: string; name?: string; documented?: boolean; lat?: number; lon?: number }; junctionKind?: string; network?: string; siteCableType?: string; clientCableType?: string; siteBuffer?: string; siteFiber?: string; clientBuffer?: string; clientFiber?: string }> } };
  let report: { siteCode?: string; lec?: string } = {};
  try {
    documentation = JSON.parse(row.documentation_json);
    if (row.report_json) report = JSON.parse(row.report_json);
  } catch {
    return;
  }
  if (!documentation.splices) return;

  const splices = documentation.splices;
  const workbook = buildSpliceSheetXlsx({
    projectId,
    client: row.client,
    address: row.address,
    siteCode: report.siteCode,
    lec: report.lec,
    count: splices.count ?? splices.records?.length ?? 0,
    noIntervention: splices.noIntervention,
    noInterventionReason: splices.noInterventionReason,
    records: splices.records ?? [],
  });
  const baseName = `Fișa de suduri - ${readableFolderName(projectId)}`;
  const legacy = await graph(token, `/me/drive/items/${encodeURIComponent(destinationId)}:/${encodeURIComponent(`${baseName}.csv`)}`, { method: "DELETE" });
  if (!legacy.ok && legacy.status !== 404) throw new RemoteFailure(`OneDrive: fișierul CSV anterior nu a putut fi înlocuit (HTTP ${legacy.status}).`);
  const filename = `${baseName}.xlsx`;
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destinationId)}:/${encodeURIComponent(filename)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    body: workbook,
  }));
}

async function uploadMaterialSheet(token: string, projectId: string, destinationId: string) {
  const document = await buildMaterialSheetPdf(projectId);
  if (!document) return;
  const filename = `Fisa materiale - ${readableFolderName(projectId)}.pdf`;
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destinationId)}:/${encodeURIComponent(filename)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: document,
  }));
}

async function uploadJob(c: Connection, job: Job) {
  const token = await tokenFor(c);
  if (job.kind === "project") {
    const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ?").bind(job.item_id).first<{ activity_type?: OneDriveActivity }>();
    if (!project) return;
    const activity: OneDriveActivity = project.activity_type && project.activity_type in oneDriveActivityFolders ? project.activity_type : "Instalare";
    if (activity === "Intervenție Orange") {
      // Ignore legacy/demo rows that predate the Orange-only ticket guard.
      if (!validOrangeTicketId(job.item_id)) return;
      const projectFolder = await orangeProjectDestination(token, c.root_id, job.item_id);
      const qaf = await buildOrangeQafXlsx(job.item_id);
      const shortTicket = shortOrangeTicket(job.item_id);
      const filename = `${readableFolderName(shortTicket)}.xlsx`;
      await checked(await graph(token, `/me/drive/items/${encodeURIComponent(projectFolder.id)}:/${encodeURIComponent(filename)}:/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        body: qaf,
      }));
      try {
        const kmz = await buildOrangeKmz(job.item_id);
        await checked(await graph(token, `/me/drive/items/${encodeURIComponent(projectFolder.id)}:/${encodeURIComponent(`${readableFolderName(shortTicket)}.kmz`)}:/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/vnd.google-earth.kmz" },
          body: kmz,
        }));
      } catch (error) {
        // A newly generated ticket has no field documentation yet. Its KMZ is
        // created automatically after the first mapped field action.
        if (!(error instanceof Error) || !error.message.includes("Documentarea intervenției nu este disponibilă")) throw error;
      }
      await folder(token, projectFolder.id, shortTicket);
      // Update the centralizer last. A workbook failure must not prevent the
      // QAF, KMZ and photo destination from reaching OneDrive.
      await syncOrangeTicketWorkbook(job.item_id);
      return;
    }
    const activityFolder = await folder(token, c.root_id, oneDriveActivityFolders[activity]);
    const projectFolder = await folder(token, activityFolder.id, readableFolderName(job.item_id));
    const sections = await Promise.all(Object.entries(oneDriveSectionFolders[activity]).map(async ([section, name]) => ({
      section,
      item: await folder(token, projectFolder.id, name),
    })));
    const administrative = sections.find(({ section }) => section === "documents");
    if (administrative) {
      await uploadAcceptanceReport(token, job.item_id, administrative.item.id);
      await uploadSpliceSheet(token, job.item_id, administrative.item.id);
      await uploadMaterialSheet(token, job.item_id, administrative.item.id);
    }
    return;
  }
  const file = await getFileRow(job.item_id);
  if (!file) return;
  const projectId = file.project_id;
  let activity: OneDriveActivity = "Instalare";
  const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ?").bind(projectId).first<{ activity_type?: OneDriveActivity }>();
  if (!project) return;
  if (project.activity_type && project.activity_type in oneDriveActivityFolders) activity = project.activity_type;
  if (activity === "Intervenție Orange" && !validOrangeTicketId(projectId)) return;
  const stored = await bucket().get(file.storage_key);
  if (!stored) throw new Error("Fișierul sursă nu mai este disponibil în Cloudflare.");
  const filename = await safeName(file.original_name, file.id);
  const body = await new Response(stored.body).arrayBuffer();
  const destination = await oneDriveFileDestination(token, c.root_id, projectId, activity, file.section, file.category, filename);
  // Recheck before external write; switching/disconnecting does not resurrect old credentials.
  const current = await connection();
  if (!current || current.generation !== c.generation || current.lease !== c.lease || !usesOneDrive(current.mode)) throw new Error("Sincronizarea OneDrive a fost oprită.");
  await checked(await graph(token, `/me/drive/items/${encodeURIComponent(destination.id)}:/${encodeURIComponent(filename)}:/content`, { method: "PUT", headers: { "Content-Type": file.content_type }, body }));
}
export async function deleteOneDriveFileCopy(fileId: string) {
  if (!oneDriveConfigured()) return;
  const c = await connection();
  if (!c?.refresh_token) return;
  const file = await getFileRow(fileId);
  if (!file) return;
  const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ?").bind(file.project_id).first<{ activity_type?: OneDriveActivity }>();
  if (!project) return;
  const activity: OneDriveActivity = project.activity_type && project.activity_type in oneDriveActivityFolders ? project.activity_type : "Instalare";
  const token = await tokenFor(c);
  const filename = await safeName(file.original_name, file.id);
  const destination = await oneDriveFileDestination(token, c.root_id, file.project_id, activity, file.section, file.category, filename);
  const response = await graph(token, `/me/drive/items/${encodeURIComponent(destination.id)}:/${encodeURIComponent(filename)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`OneDrive nu a putut șterge copia fișierului (${response.status}).`);
  await getRawDb().prepare("DELETE FROM onedrive_jobs WHERE id = ?").bind(`file:${fileId}`).run();
}

export async function drainOneDrive() {
  if (!oneDriveConfigured()) return;
  const lease = crypto.randomUUID();
  const c = await getRawDb().prepare("UPDATE onedrive_connection SET lease = ?, lease_until = ? WHERE id = ? AND mode IN ('onedrive', 'both') AND refresh_token != '' AND lease_until < ? RETURNING *")
    .bind(lease, Date.now() + 120_000, settingsId, Date.now()).first<Connection>();
  if (!c) return;
  try {
    const job = await getRawDb().prepare("SELECT * FROM onedrive_jobs WHERE revision > done_revision AND next_at <= ? ORDER BY next_at, CASE WHEN kind = 'project' THEN 0 ELSE 1 END, id LIMIT 1").bind(Date.now()).first<Job>();
    if (!job) return;
    try {
      await uploadJob(c, job);
      await getRawDb().prepare("UPDATE onedrive_jobs SET done_revision = ?, attempts = 0, last_error = '', next_at = 0 WHERE id = ? AND EXISTS (SELECT 1 FROM onedrive_connection WHERE generation = ? AND lease = ?)").bind(job.revision, job.id, c.generation, lease).run();
    } catch (error) {
      const message = error instanceof RemoteFailure ? error.message : "Sincronizarea nu a reușit. Verifică conexiunea și fișierul sursă, apoi reîncearcă.";
      const delay = Math.max(retryDelay(job.attempts), error instanceof RemoteFailure ? error.delay : 0);
      await getRawDb().prepare("UPDATE onedrive_jobs SET attempts = attempts + 1, next_at = ?, last_error = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM onedrive_connection WHERE generation = ? AND lease = ?)").bind(Date.now() + delay, message, job.id, job.revision, c.generation, lease).run();
    }
  } finally {
    await getRawDb().prepare("UPDATE onedrive_connection SET lease = '', lease_until = 0 WHERE id = ? AND lease = ?").bind(settingsId, lease).run();
  }
}
