import { env } from "cloudflare:workers";
import { backupMode } from "./onedrive-server";
import { usesGoogle } from "./onedrive-core";
import { getRawDb } from "../db";
import type { ProjectActivityType } from "./project-data";
import { bucket, getFileRow, readReport } from "./project-server";
import { buildAcceptanceReportDocx } from "./report-docx";
import { buildMaterialSheetPdf } from "./material-pdf";
import { buildOrangeQafXlsx } from "./orange-qaf";

type DriveEnvironment = { PROCONECT_DRIVE_ENCRYPTION_KEY?: string };
type DriveSettingsRow = {
  client_id: string;
  encrypted_client_secret: string;
  account_email: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  access_token_expires_at: number;
  root_folder_id: string;
  root_folder_name: string;
  connected_by: string;
};
type FolderRow = {
  project_id: string;
  folder_id: string;
  folder_url: string;
  section_folders_json: string;
  report_file_id: string;
};
type GoogleTokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number };
type GoogleFileResponse = { id?: string; webViewLink?: string; parents?: string[]; files?: Array<{ id: string; webViewLink?: string }> };

const driveEnvironment = env as unknown as DriveEnvironment;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const settingsId = "proconect-google-drive";
const oauthScope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const activityFolderMarker = "__activityFolder";

export const driveActivityFolders: Record<ProjectActivityType, string> = {
  Instalare: "Instalari",
  "Intervenție": "Interventii",
  "Intervenție Orange": "Interventii Orange",
  Survey: "Survey",
};

export const driveSectionFolders: Record<string, string> = {
  project: "01_Documente proiect",
  safety: "02_Pretask_si_EIP",
  client: "03_Client",
  route: "04_Traseu FO",
  splices: "05_Suduri FO",
  site: "06_Operatiuni site",
  documents: "07_Documente administrative",
};

const activitySectionFolders: Record<ProjectActivityType, Record<string, string>> = {
  Instalare: driveSectionFolders,
  "Intervenție": {
    safety: "01_Pretask_si_EIP",
    "intervention-assessment": "02_Constatare",
    "intervention-execution": "03_Executie",
    "intervention-documentation": "04_Documentare",
    project: "05_Documente interventie",
    documents: "06_Documente administrative",
  },
  "Intervenție Orange": {},
  Survey: {
    safety: "01_Pretask_si_EIP",
    project: "02_Documente survey",
    documents: "03_Documente administrative",
  },
};

function hexBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Protecția securizată Google Drive nu este configurată.");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesFromBase64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  return crypto.subtle.importKey("raw", hexBytes(driveEnvironment.PROCONECT_DRIVE_ENCRYPTION_KEY ?? ""), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(value));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

async function decryptSecret(value: string) {
  const [encodedIv, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedCiphertext) throw new Error("Datele securizate Google Drive nu sunt valide.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64url(encodedIv) },
    await encryptionKey(),
    bytesFromBase64url(encodedCiphertext),
  );
  return decoder.decode(decrypted);
}

async function settings() {
  return getRawDb().prepare("SELECT * FROM google_drive_settings WHERE id = ? LIMIT 1").bind(settingsId).first<DriveSettingsRow>();
}

function isConnected(configuration: DriveSettingsRow | null) {
  return Boolean(configuration?.encrypted_refresh_token && configuration.root_folder_id);
}

export function driveRedirectUri(request: Request) {
  return `${new URL(request.url).origin}/api/google-drive/callback`;
}

export async function getDriveStatus(request: Request) {
  const configuration = await settings();
  const [projectCount, fileCount, syncedCount, folderRows] = await Promise.all([
    getRawDb().prepare("SELECT COUNT(*) AS count FROM projects").first<{ count: number }>(),
    getRawDb().prepare("SELECT COUNT(*) AS count FROM project_files").first<{ count: number }>(),
    getRawDb().prepare("SELECT COUNT(*) AS count FROM google_drive_file_sync WHERE status = 'synced'").first<{ count: number }>(),
    getRawDb().prepare("SELECT project_id, folder_url FROM google_drive_project_folders ORDER BY updated_at DESC").all<{ project_id: string; folder_url: string }>(),
  ]);
  const folders = Object.fromEntries((folderRows.results ?? []).map((row: { project_id: string; folder_url: string }) => [row.project_id, row.folder_url]));

  return {
    configured: Boolean(configuration?.client_id && configuration.encrypted_client_secret),
    connected: isConnected(configuration),
    accountEmail: configuration?.account_email ?? "",
    clientId: configuration?.client_id ?? "",
    rootFolderId: configuration?.root_folder_id ?? "",
    rootFolderName: configuration?.root_folder_name ?? "Proconect B2B",
    rootFolderUrl: configuration?.root_folder_id ? `https://drive.google.com/drive/folders/${configuration.root_folder_id}` : "",
    redirectUri: driveRedirectUri(request),
    projectsTotal: projectCount?.count ?? 0,
    projectsSynced: Object.keys(folders).length,
    filesTotal: fileCount?.count ?? 0,
    filesSynced: syncedCount?.count ?? 0,
    folders,
    sections: driveSectionFolders,
    activityFolders: driveActivityFolders,
    activitySections: activitySectionFolders,
  };
}

export async function configureDrive(clientId: string, clientSecret: string) {
  const normalizedClientId = clientId.trim();
  if (!/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(normalizedClientId)) {
    return { error: "Client ID Google OAuth nu este valid.", status: 400 as const };
  }
  if (clientSecret.trim().length < 8 || clientSecret.trim().length > 500) {
    return { error: "Client Secret Google OAuth nu este valid.", status: 400 as const };
  }
  const encryptedClientSecret = await encryptSecret(clientSecret.trim());
  const now = Date.now();
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM google_drive_file_sync"),
    getRawDb().prepare("DELETE FROM google_drive_project_folders"),
    getRawDb().prepare("DELETE FROM google_drive_oauth_states"),
    getRawDb().prepare(
      "INSERT INTO google_drive_settings (id, client_id, encrypted_client_secret, account_email, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, root_folder_id, root_folder_name, connected_by, created_at, updated_at) VALUES (?, ?, ?, '', '', '', 0, '', 'Proconect B2B', '', ?, ?) ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, encrypted_client_secret = excluded.encrypted_client_secret, account_email = '', encrypted_access_token = '', encrypted_refresh_token = '', access_token_expires_at = 0, root_folder_id = '', root_folder_name = excluded.root_folder_name, connected_by = '', updated_at = excluded.updated_at",
    ).bind(settingsId, normalizedClientId, encryptedClientSecret, now, now),
  ]);
  return { configured: true as const };
}

export async function createDriveAuthorization(request: Request, userId: string) {
  const configuration = await settings();
  if (!configuration) return { error: "Configurează mai întâi Client ID și Client Secret Google.", status: 409 as const };
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM google_drive_oauth_states WHERE expires_at < ?").bind(Date.now()),
    getRawDb().prepare("INSERT INTO google_drive_oauth_states (id, user_id, encrypted_verifier, expires_at) VALUES (?, ?, ?, ?)")
      .bind(state, userId, await encryptSecret(verifier), Date.now() + 10 * 60_000),
  ]);
  const parameters = new URLSearchParams({
    client_id: configuration.client_id,
    redirect_uri: driveRedirectUri(request),
    response_type: "code",
    scope: oauthScope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}` };
}

async function tokenExchange(parameters: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters,
  });
  if (!response.ok) throw new Error("Google a respins autorizarea. Verifică datele OAuth și adresa de redirecționare.");
  return await response.json() as GoogleTokenResponse;
}

async function accessToken() {
  const configuration = await settings();
  if (!configuration?.encrypted_refresh_token) throw new Error("Google Drive nu este conectat.");
  if (configuration.encrypted_access_token && configuration.access_token_expires_at > Date.now() + 60_000) {
    return await decryptSecret(configuration.encrypted_access_token);
  }
  const refreshed = await tokenExchange(new URLSearchParams({
    client_id: configuration.client_id,
    client_secret: await decryptSecret(configuration.encrypted_client_secret),
    refresh_token: await decryptSecret(configuration.encrypted_refresh_token),
    grant_type: "refresh_token",
  }));
  if (!refreshed.access_token) throw new Error("Google nu a returnat un token valid.");
  await getRawDb().prepare("UPDATE google_drive_settings SET encrypted_access_token = ?, access_token_expires_at = ?, updated_at = ? WHERE id = ?")
    .bind(await encryptSecret(refreshed.access_token), Date.now() + (refreshed.expires_in ?? 3600) * 1000, Date.now(), settingsId).run();
  return refreshed.access_token;
}

async function googleFetch(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${await accessToken()}`);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) throw new Error(`Google Drive nu a putut procesa operațiunea (${response.status}).`);
  return response;
}

function quoteDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findOrCreateFolder(name: string, parentId?: string) {
  const query = ["mimeType = 'application/vnd.google-apps.folder'", "trashed = false", `name = '${quoteDriveQuery(name)}'`, parentId ? `'${quoteDriveQuery(parentId)}' in parents` : "'root' in parents"].join(" and ");
  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("fields", "files(id,webViewLink)");
  listUrl.searchParams.set("pageSize", "1");
  const existing = await (await googleFetch(listUrl.toString())).json() as GoogleFileResponse;
  if (existing.files?.[0]?.id) return existing.files[0];
  const created = await (await googleFetch("https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  })).json() as GoogleFileResponse;
  if (!created.id) throw new Error("Google Drive nu a creat dosarul solicitat.");
  return { id: created.id, webViewLink: created.webViewLink };
}

async function ensureActivityFolders(rootFolderId: string) {
  const folders = {} as Record<ProjectActivityType, { id: string; webViewLink?: string }>;
  for (const activity of Object.keys(driveActivityFolders) as ProjectActivityType[]) {
    folders[activity] = await findOrCreateFolder(driveActivityFolders[activity], rootFolderId);
  }
  return folders;
}

async function moveFolderToParent(folderId: string, parentId: string) {
  const metadataUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,parents,webViewLink`;
  const metadata = await (await googleFetch(metadataUrl)).json() as GoogleFileResponse;
  const currentParents = metadata.parents ?? [];
  if (currentParents.includes(parentId)) return;

  const destination = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`);
  destination.searchParams.set("addParents", parentId);
  if (currentParents.length) destination.searchParams.set("removeParents", currentParents.join(","));
  destination.searchParams.set("fields", "id,parents,webViewLink");
  await googleFetch(destination.toString(), { method: "PATCH" });
}

export async function finishDriveAuthorization(request: Request, userId: string, username: string, state: string, code: string) {
  const authorization = await getRawDb().prepare("SELECT encrypted_verifier, expires_at FROM google_drive_oauth_states WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(state, userId).first<{ encrypted_verifier: string; expires_at: number }>();
  if (!authorization || authorization.expires_at < Date.now()) throw new Error("Autorizarea Google a expirat. Reîncearcă din aplicație.");
  await getRawDb().prepare("DELETE FROM google_drive_oauth_states WHERE id = ?").bind(state).run();
  const configuration = await settings();
  if (!configuration) throw new Error("Configurarea Google Drive nu este disponibilă.");
  const tokens = await tokenExchange(new URLSearchParams({
    client_id: configuration.client_id,
    client_secret: await decryptSecret(configuration.encrypted_client_secret),
    code,
    code_verifier: await decryptSecret(authorization.encrypted_verifier),
    grant_type: "authorization_code",
    redirect_uri: driveRedirectUri(request),
  }));
  if (!tokens.access_token || !tokens.refresh_token) throw new Error("Google nu a acordat acces permanent. Repetă autorizarea și aprobă accesul.");
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!profileResponse.ok) throw new Error("Contul Google autorizat nu a putut fi identificat.");
  const profile = await profileResponse.json() as { email?: string };
  const now = Date.now();
  await getRawDb().prepare("UPDATE google_drive_settings SET account_email = ?, encrypted_access_token = ?, encrypted_refresh_token = ?, access_token_expires_at = ?, connected_by = ?, updated_at = ? WHERE id = ?")
    .bind(profile.email ?? "Cont Google autorizat", await encryptSecret(tokens.access_token), await encryptSecret(tokens.refresh_token), now + (tokens.expires_in ?? 3600) * 1000, username, now, settingsId).run();
  const root = await findOrCreateFolder(configuration.root_folder_name);
  await getRawDb().prepare("UPDATE google_drive_settings SET root_folder_id = ?, updated_at = ? WHERE id = ?").bind(root.id, Date.now(), settingsId).run();
  await ensureActivityFolders(root.id);
  return { email: profile.email ?? "", rootFolderId: root.id };
}

async function ensureProjectFolder(projectId: string, categoryFolders?: Record<ProjectActivityType, { id: string; webViewLink?: string }>) {
  const existing = await getRawDb().prepare("SELECT * FROM google_drive_project_folders WHERE project_id = ? LIMIT 1").bind(projectId).first<FolderRow>();
  const configuration = await settings();
  if (!isConnected(configuration) || !configuration) throw new Error("Google Drive nu este conectat.");
  const projectRecord = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ? LIMIT 1").bind(projectId).first<{ activity_type: ProjectActivityType }>();
  if (!projectRecord) throw new Error("Lucrarea nu mai este disponibilă pentru sincronizare.");
  const activityType: ProjectActivityType = projectRecord.activity_type;

  let sectionFolders: Record<string, string> = {};
  if (existing) {
    try {
      sectionFolders = JSON.parse(existing.section_folders_json) as Record<string, string>;
    } catch {
      sectionFolders = {};
    }
    if (
      sectionFolders[activityFolderMarker] === activityType
      && Object.keys(activitySectionFolders[activityType]).every((section) => Boolean(sectionFolders[section]))
    ) return existing;
  }

  const roots = categoryFolders ?? await ensureActivityFolders(configuration.root_folder_id);
  const activityRoot = roots[activityType];
  if (!activityRoot) throw new Error("Categoria Google Drive a lucrării nu este validă.");

  if (existing) {
    await moveFolderToParent(existing.folder_id, activityRoot.id);
    for (const [section, name] of Object.entries(activitySectionFolders[activityType])) {
      if (!sectionFolders[section]) sectionFolders[section] = (await findOrCreateFolder(name, existing.folder_id)).id;
    }
    sectionFolders[activityFolderMarker] = activityType;
    const updatedAt = Date.now();
    await getRawDb().prepare("UPDATE google_drive_project_folders SET section_folders_json = ?, updated_at = ? WHERE project_id = ?")
      .bind(JSON.stringify(sectionFolders), updatedAt, projectId).run();
    return { ...existing, section_folders_json: JSON.stringify(sectionFolders) };
  }

  const project = await findOrCreateFolder(projectId, activityRoot.id);
  for (const [section, name] of Object.entries(activitySectionFolders[activityType])) {
    sectionFolders[section] = (await findOrCreateFolder(name, project.id)).id;
  }
  sectionFolders[activityFolderMarker] = activityType;
  const now = Date.now();
  const folderUrl = project.webViewLink ?? `https://drive.google.com/drive/folders/${project.id}`;
  await getRawDb().prepare("INSERT INTO google_drive_project_folders (project_id, folder_id, folder_url, section_folders_json, report_file_id, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?) ON CONFLICT(project_id) DO UPDATE SET folder_id = excluded.folder_id, folder_url = excluded.folder_url, section_folders_json = excluded.section_folders_json, updated_at = excluded.updated_at")
    .bind(projectId, project.id, folderUrl, JSON.stringify(sectionFolders), now, now).run();
  return { project_id: projectId, folder_id: project.id, folder_url: folderUrl, section_folders_json: JSON.stringify(sectionFolders), report_file_id: "" };
}

async function uploadDriveFile(name: string, contentType: string, content: ArrayBuffer | string, folderId: string, description: string, existingFileId?: string) {
  const boundary = `proconect-${crypto.randomUUID()}`;
  const metadata = { name, description, ...(existingFileId ? {} : { parents: [folderId] }) };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const endpoint = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart&fields=id`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
  const result = await (await googleFetch(endpoint, { method: existingFileId ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body })).json() as GoogleFileResponse;
  if (!result.id) throw new Error("Google Drive nu a confirmat încărcarea fișierului.");
  return result.id;
}

async function uploadOrangeQaf(projectId: string, folderId: string) {
  const filename = `${readableOrangeName(projectId)}.xlsx`;
  await uploadDriveFile(
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    await buildOrangeQafXlsx(projectId),
    folderId,
    "QAF Orange generat automat din șablonul aprobat",
    await findDriveFileByName(folderId, filename),
  );
}

function readableOrangeName(value: string) {
  return value.normalize("NFC").replace(/[\u0000-\u001f"*:<>?\/\\|#%]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 140) || "Tichet Orange";
}

export async function syncProjectIfConnected(projectId: string) {
  if (!usesGoogle(await backupMode())) return false;
  if (!isConnected(await settings())) return false;
  const folders = await ensureProjectFolder(projectId);
  const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ? LIMIT 1").bind(projectId).first<{ activity_type: ProjectActivityType }>();
  if (project?.activity_type === "Intervenție Orange") await uploadOrangeQaf(projectId, folders.folder_id);
  return true;
}

export async function deleteDriveFileCopy(fileId: string) {
  const synced = await getRawDb().prepare("SELECT drive_file_id FROM google_drive_file_sync WHERE file_id = ? LIMIT 1")
    .bind(fileId).first<{ drive_file_id: string }>();
  if (!synced?.drive_file_id) return;
  const configuration = await settings();
  if (!isConnected(configuration)) throw new Error("Reconectează Google Drive pentru a șterge copia arhivată.");
  const headers = new Headers({ Authorization: `Bearer ${await accessToken()}` });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(synced.drive_file_id)}`, { method: "DELETE", headers });
  if (!response.ok && response.status !== 404) throw new Error(`Google Drive nu a putut șterge copia fișierului (${response.status}).`);
  await getRawDb().prepare("DELETE FROM google_drive_file_sync WHERE file_id = ?").bind(fileId).run();
}

function splicePhotoFolder(category: string) {
  const parts = category.split(":");
  if (parts.length < 3) return "";
  const token = parts[1] ?? "";
  if (!token) return "";
  const undocumented = /^J_nedocumentata_(\d+)$/i.exec(token);
  return undocumented ? `J nedocumentată ${undocumented[1]}` : token;
}

export async function syncFileIfConnected(fileId: string) {
  if (!usesGoogle(await backupMode())) return false;
  if (!isConnected(await settings())) return false;
  const file = await getFileRow(fileId);
  if (!file) return false;
  const synced = await getRawDb().prepare("SELECT drive_file_id, status FROM google_drive_file_sync WHERE file_id = ? LIMIT 1")
    .bind(fileId).first<{ drive_file_id: string; status: string }>();
  if (synced?.status === "synced") return true;
  try {
    const folders = await ensureProjectFolder(file.project_id);
    const sectionFolders = JSON.parse(folders.section_folders_json) as Record<string, string>;
    const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ? LIMIT 1").bind(file.project_id).first<{ activity_type: ProjectActivityType }>();
    const stored = await bucket().get(file.storage_key);
    if (!stored) throw new Error("Fișierul nu mai este disponibil în stocarea proiectului.");
    const description = [file.category, file.geolocation ? `GPS: ${file.geolocation}` : "", `Încărcat de: ${file.uploaded_by}`].filter(Boolean).join(" · ");
    let destinationFolderId = project?.activity_type === "Intervenție Orange" ? folders.folder_id : (sectionFolders[file.section] ?? folders.folder_id);
    const spliceFolder = project?.activity_type !== "Intervenție Orange" && file.section === "splices" ? splicePhotoFolder(file.category) : "";
    if (spliceFolder) destinationFolderId = (await findOrCreateFolder(spliceFolder, destinationFolderId)).id;
    const driveFileId = await uploadDriveFile(file.original_name, file.content_type, await new Response(stored.body).arrayBuffer(), destinationFolderId, description, synced?.drive_file_id || undefined);
    await getRawDb().prepare("INSERT INTO google_drive_file_sync (file_id, project_id, drive_file_id, status, last_error, updated_at) VALUES (?, ?, ?, 'synced', '', ?) ON CONFLICT(file_id) DO UPDATE SET drive_file_id = excluded.drive_file_id, status = 'synced', last_error = '', updated_at = excluded.updated_at")
      .bind(file.id, file.project_id, driveFileId, Date.now()).run();
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : "Sincronizarea a eșuat.";
    await getRawDb().prepare("INSERT INTO google_drive_file_sync (file_id, project_id, drive_file_id, status, last_error, updated_at) VALUES (?, ?, ?, 'error', ?, ?) ON CONFLICT(file_id) DO UPDATE SET status = 'error', last_error = excluded.last_error, updated_at = excluded.updated_at")
      .bind(file.id, file.project_id, synced?.drive_file_id ?? "", reason, Date.now()).run();
    throw error;
  }
}

async function findDriveFileByName(folderId: string, name: string) {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = encodeURIComponent(`'${folderId}' in parents and name = '${escaped}' and trashed = false`);
  const response = await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
  const payload = await response.json() as GoogleFileResponse;
  return payload.files?.[0]?.id;
}

export async function syncReportIfConnected(projectId: string) {
  if (!usesGoogle(await backupMode())) return false;
  if (!isConnected(await settings())) return false;
  const saved = await readReport(projectId);
  const folders = await ensureProjectFolder(projectId);
  const project = await getRawDb().prepare("SELECT activity_type FROM projects WHERE id = ? LIMIT 1").bind(projectId).first<{ activity_type: ProjectActivityType }>();
  if (project?.activity_type === "Intervenție Orange") {
    await uploadOrangeQaf(projectId, folders.folder_id);
    return true;
  }
  if (!saved) return false;
  const sectionFolders = JSON.parse(folders.section_folders_json) as Record<string, string>;
  const document = buildAcceptanceReportDocx(projectId, saved.report);
  const driveFileId = await uploadDriveFile(
    `Raport_acceptanta_${projectId}.docx`,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    document.buffer,
    sectionFolders.documents,
    "Raport administrativ Word generat din Proconect B2B",
    folders.report_file_id || undefined
  );
  await getRawDb().prepare("UPDATE google_drive_project_folders SET report_file_id = ?, updated_at = ? WHERE project_id = ?").bind(driveFileId, Date.now(), projectId).run();
  const materialPdf = await buildMaterialSheetPdf(projectId);
  if (materialPdf) {
    const materialName = `Fisa_materiale_${projectId}.pdf`;
    await uploadDriveFile(
      materialName,
      "application/pdf",
      materialPdf,
      sectionFolders.documents,
      "Fisa de materiale PDF landscape generata din Proconect B2B",
      await findDriveFileByName(sectionFolders.documents, materialName),
    );
  }
  return true;
}

export async function syncAllDriveData() {
  if (!usesGoogle(await backupMode())) return { error: "Google Drive este dezactivat ca destinație. Selectează Google Drive sau ambele destinații.", status: 409 as const };
  const configuration = await settings();
  if (!isConnected(configuration) || !configuration) return { error: "Conectează mai întâi contul Google Drive.", status: 409 as const };
  const categoryFolders = await ensureActivityFolders(configuration.root_folder_id);
  const projectRows = await getRawDb().prepare("SELECT id FROM projects ORDER BY created_at DESC").all<{ id: string }>();
  let projectsSynced = 0;
  let filesSynced = 0;
  let failures = 0;
  for (const project of projectRows.results ?? []) {
    try {
      await ensureProjectFolder(project.id, categoryFolders);
      projectsSynced += 1;
      const files = await getRawDb().prepare("SELECT id FROM project_files WHERE project_id = ? ORDER BY created_at ASC").bind(project.id).all<{ id: string }>();
      for (const file of files.results ?? []) {
        try {
          if (await syncFileIfConnected(file.id)) filesSynced += 1;
        } catch {
          failures += 1;
        }
      }
      try {
        await syncReportIfConnected(project.id);
      } catch {
        failures += 1;
      }
    } catch {
      failures += 1;
    }
  }
  return { projectsSynced, filesSynced, failures };
}
