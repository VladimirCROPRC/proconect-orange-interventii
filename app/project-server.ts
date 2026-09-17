import { env } from "cloudflare:workers";
import { getRawDb } from "../db";
import { requiredInterventionCablePhotos, type InterventionDocumentationSummary, type InterventionExecutionActivity, type InterventionExecutionSummary, type InterventionJunction, type ProjectFieldDocumentation } from "./field-documentation";
import { initialCpeCatalog, initialFieldDocumentation, initialProjects, type CpeCatalogItem, type ProjectActivityType, type ProjectRecord } from "./project-data";
import type { AuthenticatedAccount } from "./server-auth";

type ProjectRow = {
  id: string;
  activity_type: ProjectActivityType;
  order_number: string;
  fo_section_name: string;
  topology: string;
  cable_capacity: number;
  route_type: string;
  orange_intervention_type: string;
  sla: string;
  departure_locality: string;
  county: string;
  client: string;
  address: string;
  contact: string;
  phone: string;
  email: string;
  requirements: string;
  technician: string;
  technician_username: string;
  cpe: string;
  cpe_requires_grounding: number;
  sfp: number;
  mc: number;
  mc_type: string;
  terminal_box: number;
  status: ProjectRecord["status"];
  scheduled_label: string;
  ipwo: string;
  splice: string;
};

type StoredFileRow = {
  id: string;
  project_id: string;
  section: string;
  category: string;
  original_name: string;
  content_type: string;
  byte_size: number;
  storage_key: string;
  geolocation: string;
  captured_at: number;
  uploaded_by: string;
  created_at: number;
};

type StorageEnvironment = {
  BUCKET?: {
    put(key: string, value: ReadableStream | ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream; size: number; httpMetadata?: { contentType?: string } } | null>;
    delete(key: string): Promise<void>;
  };
};

const storageEnvironment = env as unknown as StorageEnvironment;
const fileSections = new Set(["project", "safety", "client", "route", "splices", "site", "documents", "intervention-assessment", "intervention-execution"]);
const maximumUploadBytes = 20 * 1024 * 1024;
const mediaConverterTypes = new Set(["100 Mbps", "1 Gbps", "JumboFrame"]);

function normalizeMediaConverterType(mc: boolean, value: unknown) {
  if (!mc) return "";
  const type = typeof value === "string" ? value.trim() : "";
  return mediaConverterTypes.has(type) ? type as ProjectRecord["mcType"] : "";
}

const orangeTopologies = new Set(["FO BB", "FO Local VHBB"]);
const orangeRouteTypes = new Set(["Aerian", "Subteran", "Mixt"]);
const orangeInterventionSlas: Record<string, Set<string>> = {
  IMO: new Set(["Y10", "Y8", "Y6"]),
  PBM: new Set(["minor", "Mediu", "Major"]),
  FITT: new Set(["Minor 12h", "Major 8h", "Critic 4h"]),
};

const orangeInterventionCauses = new Set(["Accident-Orice tip de accident (masina,etc.)","Clima-Alunecari de teren, viituri, furtuna, etc…","Defect-Defect cablu/cutie jonctiune, etc,…","Lucrari infrastructura-Lucrari efectuate de companiile nationale","Lucrari civile-Lucrari efectuate de persoane fizice","Primarie-Decizii primarie de a taia cablul","Vandalism-Furt"]);

function normalizeOrangeDetails(input: ProjectRecord, activityType: ProjectActivityType) {
  if (activityType !== "Intervenție Orange") return { foSectionName: "", topology: "" as ProjectRecord["topology"], cableCapacity: 0, routeType: "" as ProjectRecord["routeType"], orangeInterventionType: "" as ProjectRecord["orangeInterventionType"], sla: "", departureLocality: "", county: "" };
  const foSectionName = typeof input.foSectionName === "string" ? input.foSectionName.trim().slice(0, 200) : "";
  const topology = orangeTopologies.has(input.topology ?? "") ? input.topology! : "";
  const cableCapacity = Number(input.cableCapacity);
  const routeType = orangeRouteTypes.has(input.routeType ?? "") ? input.routeType! : "";
  const orangeInterventionType = typeof input.orangeInterventionType === "string" && orangeInterventionSlas[input.orangeInterventionType] ? input.orangeInterventionType as ProjectRecord["orangeInterventionType"] : "";
  const sla = typeof input.sla === "string" && orangeInterventionType && orangeInterventionSlas[orangeInterventionType]?.has(input.sla) ? input.sla : "";
  const departureLocality = typeof input.departureLocality === "string" ? input.departureLocality.trim().slice(0, 150) : "";
  const county = typeof input.county === "string" ? input.county.trim().slice(0, 100) : "";
  return { foSectionName, topology, cableCapacity, routeType, orangeInterventionType, sla, departureLocality, county };
}

function validWorkIdentifier(value: string, activityType: ProjectActivityType) {
  return activityType === "Intervenție" || activityType === "Intervenție Orange"
    ? /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(value)
    : /^RID\d{1,24}$/i.test(value);
}

export function hasValidPhotoCoordinates(value: string) {
  const coordinates = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s|$)/.exec(value.trim());
  if (!coordinates) return false;
  const latitude = Number(coordinates[1]);
  const longitude = Number(coordinates[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function validInterventionJunction(value: InterventionJunction | undefined) {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lon) || Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180) return false;
  if (value.documented) return value.kind === "documented" && typeof value.code === "string" && Boolean(value.code.trim());
  return (value.kind === "existing" || value.kind === "new") && (value.network === "mobile" || value.network === "fixed");
}

export function isManagementRole(account: AuthenticatedAccount) {
  return account.role === "Admin" || account.role === "Manager" || account.role === "Coordonator";
}

function projectRowToRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    activityType: row.activity_type,
    orderNumber: row.order_number,
    foSectionName: row.fo_section_name,
    topology: row.topology as ProjectRecord["topology"],
    cableCapacity: row.cable_capacity,
    routeType: row.route_type as ProjectRecord["routeType"],
    orangeInterventionType: row.orange_intervention_type as ProjectRecord["orangeInterventionType"],
    sla: row.sla,
    departureLocality: row.departure_locality,
    county: row.county,
    client: row.client,
    address: row.address,
    contact: row.contact,
    phone: row.phone,
    email: row.email,
    requirements: row.requirements,
    technician: row.technician,
    cpe: row.cpe,
    cpeRequiresGrounding: Boolean(row.cpe_requires_grounding),
    sfp: Boolean(row.sfp),
    mc: Boolean(row.mc),
    mcType: normalizeMediaConverterType(Boolean(row.mc), row.mc_type),
    terminalBox: Boolean(row.terminal_box),
    status: row.status,
    date: row.scheduled_label,
    ipwo: row.ipwo,
    splice: row.splice,
  };
}

function insertProjectStatement(project: ProjectRecord, technicianUsername: string, createdBy: string, createdAt = Date.now()) {
  return getRawDb()
    .prepare(
      "INSERT INTO projects (id, activity_type, order_number, fo_section_name, topology, cable_capacity, route_type, orange_intervention_type, sla, departure_locality, county, client, address, contact, phone, email, requirements, technician, technician_username, cpe, cpe_requires_grounding, sfp, mc, mc_type, terminal_box, status, scheduled_label, ipwo, splice, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      project.id,
      project.activityType,
      project.orderNumber ?? "",
      project.foSectionName ?? "",
      project.topology ?? "",
      project.cableCapacity ?? 0,
      project.routeType ?? "",
      project.orangeInterventionType ?? "",
      project.sla ?? "",
      project.departureLocality ?? "",
      project.county ?? "",
      project.client,
      project.address,
      project.contact,
      project.phone,
      project.email,
      project.requirements,
      project.technician,
      technicianUsername,
      project.cpe,
      project.cpeRequiresGrounding ? 1 : 0,
      project.sfp ? 1 : 0,
      project.mc ? 1 : 0,
      project.mcType,
      project.terminalBox ? 1 : 0,
      project.status,
      project.date,
      project.ipwo,
      project.splice,
      createdBy,
      createdAt,
      createdAt,
    );
}

export async function ensureProjectData() {
  const [existingProjects, existingEquipment] = await Promise.all([
    getRawDb().prepare("SELECT COUNT(*) AS count FROM projects").first<{ count: number }>(),
    getRawDb().prepare("SELECT COUNT(*) AS count FROM cpe_catalog").first<{ count: number }>(),
  ]);
  if ((existingProjects?.count ?? 0) > 0 || (existingEquipment?.count ?? 0) > 0) return;

  const now = Date.now();
  const statements = initialProjects.map((project, index) => insertProjectStatement(project, "vlad", "vladimir.carlan", now - index));
  for (const [projectId, documentation] of Object.entries(initialFieldDocumentation)) {
    statements.push(
      getRawDb()
        .prepare("INSERT INTO project_field_documentation (project_id, content_json, updated_by, updated_at) VALUES (?, ?, ?, ?)")
        .bind(projectId, JSON.stringify(documentation), "vladimir.carlan", now),
    );
  }
  for (const equipment of initialCpeCatalog) {
    statements.push(getRawDb().prepare("INSERT OR IGNORE INTO cpe_catalog (id, name, requires_grounding, created_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), equipment.name, equipment.requiresGrounding ? 1 : 0, now));
  }
  await getRawDb().batch(statements);
}

export async function listProjectData(account: AuthenticatedAccount) {
  const query = isManagementRole(account)
    ? getRawDb().prepare("SELECT * FROM projects WHERE activity_type = 'Intervenție Orange' ORDER BY created_at DESC")
    : getRawDb().prepare("SELECT * FROM projects WHERE activity_type = 'Intervenție Orange' AND technician_username = ? ORDER BY created_at DESC").bind(account.username);
  const result = await query.all<ProjectRow>();
  const projects = (result.results ?? []).map((row: ProjectRow) => projectRowToRecord(row));

  const safetyQuery = isManagementRole(account)
    ? getRawDb().prepare("SELECT project_id, category FROM project_files WHERE section = 'safety' AND category IN ('pretask', 'ppe')")
    : getRawDb()
        .prepare("SELECT project_files.project_id, project_files.category FROM project_files INNER JOIN projects ON projects.id = project_files.project_id WHERE project_files.section = 'safety' AND project_files.category IN ('pretask', 'ppe') AND project_files.uploaded_by = ? AND projects.technician_username = ?")
        .bind(account.username, account.username);
  const safetyRows = await safetyQuery.all<{ project_id: string; category: "pretask" | "ppe" }>();
  const safetyChecks: Record<string, { pretask: boolean; ppe: boolean; completed: boolean }> = {};
  for (const project of projects) safetyChecks[project.id] = { pretask: false, ppe: false, completed: false };
  for (const row of safetyRows.results ?? []) {
    const current = safetyChecks[row.project_id];
    if (!current) continue;
    current[row.category] = true;
    current.completed = current.pretask && current.ppe;
  }

  const documentationQuery = isManagementRole(account)
    ? getRawDb().prepare("SELECT project_field_documentation.project_id, project_field_documentation.content_json FROM project_field_documentation")
    : getRawDb()
        .prepare("SELECT project_field_documentation.project_id, project_field_documentation.content_json FROM project_field_documentation INNER JOIN projects ON projects.id = project_field_documentation.project_id WHERE projects.technician_username = ?")
        .bind(account.username);
  const documentationRows = await documentationQuery.all<{ project_id: string; content_json: string }>();
  const fieldDocumentation: Record<string, ProjectFieldDocumentation> = {};
  for (const row of documentationRows.results ?? []) {
    if (!isManagementRole(account) && !safetyChecks[row.project_id]?.completed) continue;
    try {
      const documentation = JSON.parse(row.content_json) as ProjectFieldDocumentation;
      if (!isManagementRole(account) && documentation.intervention?.documentation) {
        const { assessment, execution } = documentation.intervention;
        fieldDocumentation[row.project_id] = {
          ...documentation,
          intervention: {
            ...(assessment ? { assessment } : {}),
            ...(execution ? { execution } : {}),
          },
        };
      } else {
        fieldDocumentation[row.project_id] = documentation;
      }
    } catch {
      fieldDocumentation[row.project_id] = {};
    }
  }

  const cpeRows = await getRawDb().prepare("SELECT name, requires_grounding FROM cpe_catalog ORDER BY created_at ASC").all<{ name: string; requires_grounding: number }>();
  const cpe: CpeCatalogItem[] = (cpeRows.results ?? []).map((row) => ({ name: row.name, requiresGrounding: Boolean(row.requires_grounding) }));
  return { projects, fieldDocumentation, cpe, safetyChecks };
}

export async function getAuthorizedProject(projectId: string, account: AuthenticatedAccount) {
  const query = isManagementRole(account)
    ? getRawDb().prepare("SELECT * FROM projects WHERE id = ? AND activity_type = 'Intervenție Orange' LIMIT 1").bind(projectId)
    : getRawDb().prepare("SELECT * FROM projects WHERE id = ? AND activity_type = 'Intervenție Orange' AND technician_username = ? LIMIT 1").bind(projectId, account.username);
  return query.first<ProjectRow>();
}

export async function hasCompletedProjectSafety(projectId: string, account: AuthenticatedAccount) {
  if (isManagementRole(account)) return true;
  if (account.role !== "Tehnician") return false;
  const row = await getRawDb()
    .prepare("SELECT COUNT(DISTINCT project_files.category) AS count FROM project_files INNER JOIN projects ON projects.id = project_files.project_id WHERE project_files.project_id = ? AND projects.technician_username = ? AND project_files.uploaded_by = ? AND project_files.section = 'safety' AND project_files.category IN ('pretask', 'ppe')")
    .bind(projectId, account.username, account.username)
    .first<{ count: number }>();
  return (row?.count ?? 0) >= 2;
}

export async function createProject(input: ProjectRecord, createdBy: AuthenticatedAccount) {
  const activityType: ProjectActivityType = "Intervenție Orange";
  if (input.activityType !== activityType) return { error: "Această aplicație acceptă exclusiv intervenții Orange.", status: 400 as const };
  const workId = typeof input.id === "string" ? input.id.trim().toUpperCase() : "";
  if (!validWorkIdentifier(workId, activityType)) {
    return {
      error: activityType === "Intervenție" || activityType === "Intervenție Orange"
        ? "Numărul tichetului trebuie să conțină litere, cifre, punct, cratimă sau underscore."
        : "Request ID trebuie să conțină doar prefixul RID și cifre.",
      status: 400 as const,
    };
  }
  const orangeDetails = normalizeOrangeDetails(input, activityType);
  const required = activityType === "Intervenție Orange"
    ? [input.client, input.requirements, input.technician, orangeDetails.foSectionName, orangeDetails.topology, orangeDetails.routeType, orangeDetails.orangeInterventionType, orangeDetails.sla, orangeDetails.departureLocality, orangeDetails.county]
    : [input.client, input.address, input.contact, input.phone, input.requirements, input.technician, ...(activityType === "Instalare" ? [input.cpe] : [])];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    return { error: "Completează toate informațiile obligatorii ale proiectului.", status: 400 as const };
  }
  if (activityType === "Intervenție Orange" && (!Number.isInteger(orangeDetails.cableCapacity) || orangeDetails.cableCapacity < 1 || orangeDetails.cableCapacity > 10000)) {
    return { error: "Introdu o capacitate validă a cablului.", status: 400 as const };
  }
  const existing = await getRawDb().prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").bind(workId).first();
  if (existing) return { error: activityType === "Intervenție" || activityType === "Intervenție Orange" ? "Numărul tichetului există deja. Verifică valoarea introdusă." : "Request ID există deja. Verifică numărul introdus.", status: 409 as const };

  const technician = await getRawDb()
    .prepare("SELECT username, name FROM app_users WHERE name = ? AND role = 'Tehnician' AND active = 1 LIMIT 1")
    .bind(input.technician)
    .first<{ username: string; name: string }>();
  if (!technician) return { error: "Tehnicianul selectat nu este disponibil.", status: 400 as const };

  const normalizedCpe = typeof input.cpe === "string" ? input.cpe.trim() : "";
  const catalogItem = activityType === "Instalare"
    ? await getRawDb().prepare("SELECT name, requires_grounding FROM cpe_catalog WHERE name = ? LIMIT 1").bind(normalizedCpe).first<{ name: string; requires_grounding: number }>()
    : undefined;
  if (activityType === "Instalare" && !catalogItem) {
    return { error: "Selectează un echipament disponibil în catalogul CPE.", status: 400 as const };
  }
  const mcType = normalizeMediaConverterType(Boolean(input.mc), input.mcType);
  if (input.mc && !mcType) return { error: "Selectează tipul Media Converter: 100 Mbps, 1 Gbps sau JumboFrame.", status: 400 as const };

  const project: ProjectRecord = {
    ...input,
    id: workId,
    activityType,
    orderNumber: activityType === "Intervenție" && typeof input.orderNumber === "string" ? input.orderNumber.trim().slice(0, 100) : "",
    ...orangeDetails,
    client: input.client.trim(),
    address: input.address.trim(),
    contact: input.contact.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    requirements: input.requirements.trim(),
    technician: technician.name,
    cpe: catalogItem?.name ?? "",
    cpeRequiresGrounding: Boolean(catalogItem?.requires_grounding),
    mc: Boolean(input.mc),
    mcType,
    status: "Planificat",
    date: input.date || "Astăzi",
    ipwo: input.ipwo || "Fișier neîncărcat",
    splice: input.splice || "Fișier neîncărcat",
  };
  await getRawDb().batch([
    insertProjectStatement(project, technician.username, createdBy.username),
    getRawDb().prepare("UPDATE app_users SET jobs = jobs + 1, updated_at = ? WHERE username = ?").bind(Date.now(), technician.username),
  ]);
  return { project };
}

export async function updateProject(input: ProjectRecord) {
  const activityType: ProjectActivityType = "Intervenție Orange";
  if (input.activityType !== activityType) return { error: "Această aplicație acceptă exclusiv intervenții Orange.", status: 400 as const };
  if (!validWorkIdentifier(input.id, activityType)) {
    return { error: activityType === "Intervenție" || activityType === "Intervenție Orange" ? "Numărul tichetului nu este valid." : "Request ID-ul proiectului nu este valid.", status: 400 as const };
  }
  const orangeDetails = normalizeOrangeDetails(input, activityType);
  const required = activityType === "Intervenție Orange"
    ? [input.client, input.requirements, input.technician, orangeDetails.foSectionName, orangeDetails.topology, orangeDetails.routeType, orangeDetails.orangeInterventionType, orangeDetails.sla, orangeDetails.departureLocality, orangeDetails.county]
    : [input.client, input.address, input.contact, input.phone, input.requirements, input.technician, ...(activityType === "Instalare" ? [input.cpe] : [])];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    return { error: "Completează toate informațiile obligatorii ale proiectului.", status: 400 as const };
  }
  if (activityType === "Intervenție Orange" && (!Number.isInteger(orangeDetails.cableCapacity) || orangeDetails.cableCapacity < 1 || orangeDetails.cableCapacity > 10000)) {
    return { error: "Introdu o capacitate validă a cablului.", status: 400 as const };
  }
  if (!["Planificat", "În desfășurare", "De verificat", "Finalizat"].includes(input.status)) {
    return { error: "Statusul proiectului nu este valid.", status: 400 as const };
  }

  const existing = await getRawDb().prepare("SELECT * FROM projects WHERE id = ? LIMIT 1").bind(input.id.toUpperCase()).first<ProjectRow>();
  if (!existing) return { error: "Proiectul selectat nu există.", status: 404 as const };

  const technician = await getRawDb()
    .prepare("SELECT username, name FROM app_users WHERE name = ? AND role = 'Tehnician' AND active = 1 LIMIT 1")
    .bind(input.technician.trim())
    .first<{ username: string; name: string }>();
  if (!technician) return { error: "Tehnicianul selectat nu este disponibil.", status: 400 as const };

  const normalizedCpe = typeof input.cpe === "string" ? input.cpe.trim() : "";
  const catalogItem = activityType === "Instalare" && normalizedCpe !== existing.cpe
    ? await getRawDb().prepare("SELECT name, requires_grounding FROM cpe_catalog WHERE name = ? LIMIT 1").bind(normalizedCpe).first<{ name: string; requires_grounding: number }>()
    : undefined;
  if (activityType === "Instalare" && normalizedCpe !== existing.cpe && !catalogItem) {
    return { error: "Selectează un echipament disponibil în catalogul CPE.", status: 400 as const };
  }
  const mcType = normalizeMediaConverterType(Boolean(input.mc), input.mcType);
  if (input.mc && !mcType) return { error: "Selectează tipul Media Converter: 100 Mbps, 1 Gbps sau JumboFrame.", status: 400 as const };

  const project: ProjectRecord = {
    ...input,
    id: existing.id,
    activityType,
    orderNumber: activityType === "Intervenție" && typeof input.orderNumber === "string" ? input.orderNumber.trim().slice(0, 100) : "",
    ...orangeDetails,
    client: input.client.trim(),
    address: input.address.trim(),
    contact: input.contact.trim(),
    phone: input.phone.trim(),
    email: typeof input.email === "string" ? input.email.trim() : "",
    requirements: input.requirements.trim(),
    technician: technician.name,
    cpe: activityType === "Instalare" ? (catalogItem?.name ?? existing.cpe) : "",
    cpeRequiresGrounding: activityType === "Instalare" ? Boolean(catalogItem ? catalogItem.requires_grounding : existing.cpe_requires_grounding) : false,
    sfp: Boolean(input.sfp),
    mc: Boolean(input.mc),
    mcType,
    terminalBox: Boolean(input.terminalBox),
    date: typeof input.date === "string" && input.date.trim() ? input.date.trim() : existing.scheduled_label,
    ipwo: typeof input.ipwo === "string" && input.ipwo.trim() ? input.ipwo.trim() : existing.ipwo,
    splice: typeof input.splice === "string" && input.splice.trim() ? input.splice.trim() : existing.splice,
  };
  const now = Date.now();
  const statements = [
    getRawDb().prepare(
      "UPDATE projects SET activity_type = ?, order_number = ?, fo_section_name = ?, topology = ?, cable_capacity = ?, route_type = ?, orange_intervention_type = ?, sla = ?, departure_locality = ?, county = ?, client = ?, address = ?, contact = ?, phone = ?, email = ?, requirements = ?, technician = ?, technician_username = ?, cpe = ?, cpe_requires_grounding = ?, sfp = ?, mc = ?, mc_type = ?, terminal_box = ?, status = ?, scheduled_label = ?, ipwo = ?, splice = ?, updated_at = ? WHERE id = ?",
    ).bind(
      project.activityType,
      project.orderNumber ?? "",
      project.foSectionName ?? "",
      project.topology ?? "",
      project.cableCapacity ?? 0,
      project.routeType ?? "",
      project.orangeInterventionType ?? "",
      project.sla ?? "",
      project.departureLocality ?? "",
      project.county ?? "",
      project.client,
      project.address,
      project.contact,
      project.phone,
      project.email,
      project.requirements,
      project.technician,
      technician.username,
      project.cpe,
      project.cpeRequiresGrounding ? 1 : 0,
      project.sfp ? 1 : 0,
      project.mc ? 1 : 0,
      project.mcType,
      project.terminalBox ? 1 : 0,
      project.status,
      project.date,
      project.ipwo,
      project.splice,
      now,
      project.id,
    ),
  ];

  if (existing.technician_username !== technician.username) {
    statements.push(
      getRawDb().prepare("UPDATE app_users SET jobs = CASE WHEN jobs > 0 THEN jobs - 1 ELSE 0 END, updated_at = ? WHERE username = ?").bind(now, existing.technician_username),
      getRawDb().prepare("UPDATE app_users SET jobs = jobs + 1, updated_at = ? WHERE username = ?").bind(now, technician.username),
    );
  }

  await getRawDb().batch(statements);
  return { project };
}

export async function deleteProject(projectId: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(projectId)) {
    return { error: "Identificatorul lucrării sau numărul tichetului nu este valid.", status: 400 as const };
  }

  const project = await getRawDb()
    .prepare("SELECT id, technician_username FROM projects WHERE id = ? LIMIT 1")
    .bind(projectId.toUpperCase())
    .first<{ id: string; technician_username: string }>();
  if (!project) return { error: "Proiectul selectat nu există sau a fost deja șters.", status: 404 as const };

  const files = await getRawDb()
    .prepare("SELECT storage_key FROM project_files WHERE project_id = ?")
    .bind(project.id)
    .all<{ storage_key: string }>();
  const storageKeys = (files.results ?? []).map((file) => file.storage_key);

  await getRawDb().batch([
    getRawDb().prepare("DELETE FROM projects WHERE id = ?").bind(project.id),
    getRawDb()
      .prepare("UPDATE app_users SET jobs = CASE WHEN jobs > 0 THEN jobs - 1 ELSE 0 END, updated_at = ? WHERE username = ?")
      .bind(Date.now(), project.technician_username),
  ]);

  let cleanupFailures = 0;
  if (storageKeys.length) {
    try {
      const cleanup = await Promise.allSettled(storageKeys.map((key) => bucket().delete(key)));
      cleanupFailures = cleanup.filter((result) => result.status === "rejected").length;
    } catch {
      cleanupFailures = storageKeys.length;
    }
    if (cleanupFailures) console.error(`Proconect project cleanup: ${cleanupFailures} fișiere necesită curățare pentru ${project.id}.`);
  }

  return { projectId: project.id, cleanupFailures };
}

function reportBullets(lines: string[]) {
  return lines.map((line) => `–  ${line}`).join("\n");
}

async function refreshGeneratedReport(projectId: string, documentation: ProjectFieldDocumentation, project: ProjectRow, account: AuthenticatedAccount) {
  const saved = await readReport(projectId);
  const report: Record<string, string> = { ...(saved?.report ?? {}) };
  report.title ||= "Raport acceptanță";

  if (documentation.site) {
    const site = documentation.site;
    report.site = reportBullets(site.noIntervention
      ? [`Nu s-a intervenit în secțiunea Site. Motiv: ${site.noInterventionReason}.`]
      : [
          `S-a cablat portul ${site.etnPort} din switch ${site.etn}.`,
          `Conexiunea a fost realizată în ODF ${site.odf}, portul ${site.odfPort}.`,
          ...(site.mediaConverterInstalled && site.mediaConverterType ? [`S-a instalat Media Converter ${site.mediaConverterType} în site.`] : []),
          ...(site.sfpInstalled && site.sfpType ? [`S-a instalat ${site.sfpType} în site.`] : []),
        ]);
  }

  const routeLines: string[] = [];
  if (documentation.route) {
    const route = documentation.route;
    if (route.noIntervention) {
      routeLines.push(`Nu s-a intervenit la traseul FO. Motiv: ${route.noInterventionReason}.`);
    } else if (route.segments.length) {
      const cableTypes = [...new Set(route.segments.map((segment) => segment.cableType.match(/(4|12|24|48|96)[ ]*F/i)?.[1]).filter((value): value is string => Boolean(value)).map((value) => `${value}F`))];
      const cableDescription = cableTypes.length === 1 ? `un cablu FO ${cableTypes[0]}` : `cabluri FO ${cableTypes.join(", ")}`;
      routeLines.push(`S-a instalat ${cableDescription} între ${route.junction.label} și locația clientului, în lungime de ${route.totalLengthMeters.toLocaleString("ro-RO")} m, din care ${route.segments.map((segment) => `${segment.lengthMeters.toLocaleString("ro-RO")} m ${segment.label.toLocaleLowerCase("ro-RO")}`).join(", ")}.`);
    } else if (route.totalLengthMeters > 0) {
      routeLines.push(`Lungimea traseului FO documentat pe hartă este de ${route.totalLengthMeters.toLocaleString("ro-RO")} m.`);
    }
  }
  if (documentation.route?.segments.some((segment) => segment.method === "aerial")) {
    const accessories = [
      ["Bărcuță", documentation.route.aerialMaterials.boat],
      ["Colier tablă inox", documentation.route.aerialMaterials.stainlessClamp],
      ["Cârlig", documentation.route.aerialMaterials.hook],
      ["Armorod", documentation.route.aerialMaterials.armorod],
    ].filter((item): item is [string, number] => Number(item[1]) > 0);
    if (accessories.length) routeLines.push(`Accesorii instalare aeriană: ${accessories.map(([name, quantity]) => `${name}: ${quantity.toLocaleString("ro-RO")} buc.`).join(", ")}`);
  }

  if (documentation.splices?.noIntervention) {
    routeLines.push(`Nu s-a intervenit la sudurile FO. Motiv: ${documentation.splices.noInterventionReason}.`);
  } else if (documentation.splices?.count) {
    routeLines.push(`Total suduri FO: ${documentation.splices.count}.`);
  }
  if (routeLines.length) report.route = reportBullets(routeLines);

  if (documentation.client) {
    const client = documentation.client;
    if (client.noIntervention) {
      report.client = reportBullets([`Nu s-a intervenit la client. Motiv: ${client.noInterventionReason}.`]);
    } else {
      const equipment = client.equipment?.length ? client.equipment : [
        project.cpe,
        ...(project.sfp ? ["SFP optic"] : []),
        ...(project.mc ? [`Media Converter${project.mc_type ? ` ${project.mc_type}` : ""}`] : []),
        ...(project.terminal_box ? ["Terminal Box"] : []),
      ];
      const clientLines = [
        `S-a instalat și configurat echipamentul ${equipment[0] || project.cpe}.`,
        ...equipment.slice(1).map((item) => `S-a instalat ${item}.`),
      ];
      if (client.service) clientLines.push(`Serviciul documentat: ${client.service}.`);
      if (client.clientHasNoGroundingSystem) clientLines.push("Clientul declară că locația nu dispune de sistem de împământare, iar echipamentul nu a putut fi conectat la împământare.");
      report.client = reportBullets(clientLines);
    }
  }

  await writeReport(projectId, report, account);
}

export async function saveFieldDocumentation(projectId: string, section: string, content: unknown, account: AuthenticatedAccount) {
  if (!["client", "route", "splices", "site", "intervention"].includes(section)) {
    return { error: "Secțiunea de documentație nu este validă.", status: 400 as const };
  }
  const project = await getAuthorizedProject(projectId, account);
  if (!project) return { error: "Proiectul nu este disponibil pentru acest utilizator.", status: 404 as const };
  if (!(await hasCompletedProjectSafety(projectId, account))) {
    return { error: "Încarcă fotografiile Pretask și EIP înainte de accesarea lucrării.", status: 403 as const };
  }
  let finalizedProject: ProjectRecord | undefined;

  if (section !== "intervention") {
    const fieldContent = content as {
      noIntervention?: unknown;
      noInterventionReason?: unknown;
      clientHasNoGroundingSystem?: unknown;
      service?: unknown;
      sfpQuantity?: unknown;
      sfpType?: unknown;
      mediaConverterInstalled?: unknown;
      mediaConverterType?: unknown;
      sfpInstalled?: unknown;
    };
    if (fieldContent.noIntervention === true) {
      const reason = typeof fieldContent.noInterventionReason === "string" ? fieldContent.noInterventionReason.trim() : "";
      if (!reason || reason.length > 2_000) {
        return { error: "Completează motivul pentru care nu s-a intervenit în această secțiune.", status: 400 as const };
      }
    }

    if (section === "client") {
      const service = typeof fieldContent.service === "string" ? fieldContent.service : "";
      if (!["Internet", "VPN", "Internet+OL", "OL"].includes(service)) {
        return { error: "Selectează serviciul documentat la client.", status: 400 as const };
      }
      if (project.sfp && fieldContent.noIntervention !== true) {
        const quantity = Number(fieldContent.sfpQuantity);
        const validTypes = new Set(["SFP 1Gb A SC", "SFP 1Gb A LC", "SFP 10Gb A LC"]);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || typeof fieldContent.sfpType !== "string" || !validTypes.has(fieldContent.sfpType)) {
          return { error: "Selectează tipul SFP de la client și o cantitate între 1 și 100.", status: 400 as const };
        }
      }
      const noGroundingSystem = fieldContent.clientHasNoGroundingSystem === true;
      if (noGroundingSystem && (!project.cpe_requires_grounding || fieldContent.noIntervention === true)) {
        return { error: "Declarația privind lipsa împământării este disponibilă numai când echipamentul necesită împământare și a fost instalat.", status: 400 as const };
      }
      const requiredCategories = [
        "report",
        ...(service === "Internet" || service === "Internet+OL" ? ["speed"] : []),
        ...(service === "OL" || service === "Internet+OL" ? ["olTest"] : []),
        ...(fieldContent.noIntervention === true ? [] : ["overview", "detail", "labels"]),
        ...(project.cpe_requires_grounding && fieldContent.noIntervention !== true && !noGroundingSystem ? ["grounding"] : []),
      ];
      const photoRows = await getRawDb()
        .prepare("SELECT DISTINCT category FROM project_files WHERE project_id = ? AND section = 'client'")
        .bind(projectId)
        .all<{ category: string }>();
      const availableCategories = new Set((photoRows.results ?? []).map((photo) => photo.category));
      const missingCategories = requiredCategories.filter((category) => !availableCategories.has(category));
      if (missingCategories.length) {
        return { error: `Lipsesc ${missingCategories.length} fotografii obligatorii: procesul-verbal, testele aplicabile, împământarea sau documentarea execuției.`, status: 400 as const };
      }
    }

    if (section === "site" && fieldContent.noIntervention !== true) {
      if (fieldContent.mediaConverterInstalled === true && !["100 Mbps", "1 Gbps", "JumboFrame"].includes(String(fieldContent.mediaConverterType))) {
        return { error: "Selectează tipul Media Converter instalat în site.", status: 400 as const };
      }
      if (fieldContent.sfpInstalled === true && !["SFP 1Gb B SC", "SFP 1Gb B LC", "SFP 10Gb B LC"].includes(String(fieldContent.sfpType))) {
        return { error: "Selectează tipul SFP instalat în site.", status: 400 as const };
      }
    }
  }

  if (section === "intervention") {
    if (project.activity_type !== "Intervenție Orange") {
      return { error: "Această aplicație acceptă exclusiv intervenții Orange.", status: 400 as const };
    }

    if (project.status === "Finalizat") {
      return { error: "Intervenția a fost deja validată și închisă.", status: 409 as const };
    }

    const intervention = content as {
      assessment?: { damageType?: unknown; cause?: unknown; damageLocation?: { lat?: unknown; lon?: unknown } };
      execution?: Partial<InterventionExecutionSummary>;
      documentation?: Partial<InterventionDocumentationSummary>;
    };
    if (intervention.documentation && !isManagementRole(account)) {
      return { error: "Documentarea și închiderea intervenției sunt rezervate administratorului, managerului sau coordonatorului.", status: 403 as const };
    }
    const assessment = intervention?.assessment;
    if (!assessment || !["FO cut", "Atenuare", "Echipament"].includes(String(assessment.damageType))) {
      return { error: "Selectează tipul avariei înainte de salvarea constatării.", status: 400 as const };
    }
    if (project.activity_type === "Intervenție Orange" && (typeof assessment.cause !== "string" || !orangeInterventionCauses.has(assessment.cause))) {
      return { error: "Selectează cauza avariei Orange.", status: 400 as const };
    }
    if (project.activity_type === "Intervenție Orange" && (!assessment.damageLocation || typeof assessment.damageLocation.lat !== "number" || typeof assessment.damageLocation.lon !== "number" || !Number.isFinite(assessment.damageLocation.lat) || !Number.isFinite(assessment.damageLocation.lon))) {
      return { error: "Amplasează locația avariei Orange pe hartă.", status: 400 as const };
    }

    const photos = await getRawDb()
      .prepare("SELECT geolocation FROM project_files WHERE project_id = ? AND section = ?")
      .bind(projectId, "intervention-assessment")
      .all<{ geolocation: string }>();

    if (!(photos.results ?? []).some((photo) => hasValidPhotoCoordinates(photo.geolocation))) {
      return { error: "Încarcă cel puțin o fotografie a avariei cu coordonate GPS valide.", status: 400 as const };
    }

    if (intervention.execution) {
      const execution = intervention.execution;
      if (!Array.isArray(execution.activities) || (project.activity_type !== "Intervenție Orange" && execution.activities.length < 1) || execution.activities.length > 100) {
        return { error: "Adaugă cel puțin o activitate validă pentru execuția intervenției.", status: 400 as const };
      }

      const executionPhotos = await getRawDb()
        .prepare("SELECT category, geolocation FROM project_files WHERE project_id = ? AND section = ?")
        .bind(projectId, "intervention-execution")
        .all<{ category: string; geolocation: string }>();
      const geotaggedExecutionPhotos = (executionPhotos.results ?? []).filter((photo) => hasValidPhotoCoordinates(photo.geolocation));
      const identifiers = new Set<string>();

      for (const item of execution.activities as InterventionExecutionActivity[]) {
        if (!item || typeof item.id !== "string" || !/^[a-f0-9-]{36}$/i.test(item.id) || identifiers.has(item.id)) {
          return { error: "Activitățile intervenției nu sunt identificate corect.", status: 400 as const };
        }
        identifiers.add(item.id);
        if (!["fo-installation", "junction-installation", "chamber-installation", "diagnostics", "splice-repair"].includes(item.type)) {
          return { error: "Tipul activității intervenției nu este valid.", status: 400 as const };
        }

        let requiredPhotos = 1;
        if (item.type === "fo-installation") {
          if (!validInterventionJunction(item.endpointA) || !validInterventionJunction(item.endpointB)) {
            return { error: "Completează ambele joncțiuni ale traseului FO și rețeaua punctelor nedocumentate.", status: 400 as const };
          }
          if (!Array.isArray(item.routePoints) || item.routePoints.length < 2 || item.routePoints.length > 500 || item.routePoints.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lon))) {
            return { error: "Trasează cablul FO între cele două joncțiuni pe hartă.", status: 400 as const };
          }
          const cableType = typeof item.cableType === "string" ? item.cableType.trim() : "";
          const cableLength = typeof item.cableLengthMeters === "number" ? item.cableLengthMeters : 0;
          if (cableType.length < 2 || cableType.length > 120) {
            return { error: "Completează tipul cablului FO instalat.", status: 400 as const };
          }
          if (!Number.isFinite(cableLength) || cableLength <= 0 || cableLength > 1_000_000) {
            return { error: "Introdu o lungime validă pentru cablul FO instalat.", status: 400 as const };
          }
          requiredPhotos = requiredInterventionCablePhotos(cableLength);
        } else {
          if (project.activity_type === "Intervenție Orange" ? !item.junction || !Number.isFinite(item.junction.lat) || !Number.isFinite(item.junction.lon) || !item.junction.kind : !validInterventionJunction(item.junction)) {
            return { error: project.activity_type === "Intervenție Orange" ? "Selectează sau plasează punctul activității pe hartă." : "Selectează sau plasează joncțiunea și completează rețeaua Orange.", status: 400 as const };
          }
          if ((item.type === "junction-installation" || item.type === "chamber-installation") && (item.junction?.documented || item.junction?.kind !== "new")) {
            return { error: project.activity_type === "Intervenție Orange" ? (item.type === "chamber-installation" ? "Cămereta nouă trebuie plasată pe hartă." : "Joncțiunea nouă trebuie plasată pe hartă.") : item.type === "chamber-installation" ? "Cămereta nouă trebuie plasată pe hartă și asociată unei rețele Orange." : "Joncțiunea nouă trebuie plasată pe hartă și asociată unei rețele Orange.", status: 400 as const };
          }
        }

        if (item.type === "chamber-installation") requiredPhotos = 2;

        const activityPhotos = geotaggedExecutionPhotos.filter((photo) => photo.category === `${item.id}:photo`).length;
        if (activityPhotos < requiredPhotos) {
          return { error: item.type === "fo-installation"
            ? `Pentru ${item.cableLengthMeters} m sunt obligatorii ${requiredPhotos} fotografii GPS ale instalării FO.`
            : item.type === "chamber-installation"
              ? "Pentru instalarea cămeretei sunt obligatorii două fotografii cu GPS."
              : "Încarcă cel puțin o fotografie cu GPS din care să reiasă remedierea.", status: 400 as const };
        }
      }
      if (execution.materials !== undefined) {
        if (!Array.isArray(execution.materials) || execution.materials.length > 300 || execution.materials.some((material) =>
          !material || !["orange", "proconect"].includes(String(material.source)) ||
          typeof material.code !== "string" || !material.code.trim() ||
          typeof material.description !== "string" || !material.description.trim() ||
          typeof material.unit !== "string" || !material.unit.trim() ||
          typeof material.quantity !== "number" || !Number.isFinite(material.quantity) || material.quantity <= 0 || material.quantity > 1_000_000
        )) {
          return { error: "Lista materialelor utilizate nu este validă.", status: 400 as const };
        }
      }
    }

    if (intervention.documentation) {
      if (!intervention.execution?.activities?.length) {
        return { error: "Înregistrează cel puțin o activitate de execuție înainte de închiderea intervenției.", status: 400 as const };
      }
      const report = typeof intervention.documentation.report === "string" ? intervention.documentation.report.trim() : "";
      if (report.length < 20 || report.length > 5_000) {
        return { error: "Raportul intervenției trebuie să conțină între 20 și 5.000 de caractere.", status: 400 as const };
      }
      content = {
        ...intervention,
        documentation: {
          report,
          validatedAt: Date.now(),
          validatedBy: account.name,
        } satisfies InterventionDocumentationSummary,
      };
      finalizedProject = { ...projectRowToRecord(project), status: "Finalizat" };
    }
  }

  const serialized = JSON.stringify(content);
  if (!serialized || serialized.length > 600_000) return { error: "Documentația depășește dimensiunea permisă.", status: 400 as const };

  const existing = await getRawDb()
    .prepare("SELECT content_json FROM project_field_documentation WHERE project_id = ? LIMIT 1")
    .bind(projectId)
    .first<{ content_json: string }>();
  let current: ProjectFieldDocumentation = {};
  if (existing) {
    try {
      current = JSON.parse(existing.content_json) as ProjectFieldDocumentation;
    } catch {
      current = {};
    }
  }

  const next = { ...current, [section]: content };
  const now = Date.now();
  const saveDocumentation = getRawDb()
    .prepare(
      "INSERT INTO project_field_documentation (project_id, content_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET content_json = excluded.content_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    )
    .bind(projectId, JSON.stringify(next), account.username, now);

  if (finalizedProject) {
    await getRawDb().batch([
      saveDocumentation,
      getRawDb().prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").bind("Finalizat", now, projectId),
    ]);
    await refreshGeneratedReport(projectId, next, project, account);
    return { documentation: next, project: finalizedProject };
  }

  await saveDocumentation.run();
  await refreshGeneratedReport(projectId, next, project, account);
  return { documentation: next };
}

export async function addCpe(name: string, requiresGrounding: boolean) {
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 120) return { error: "Denumirea echipamentului nu este validă.", status: 400 as const };
  const existing = await getRawDb().prepare("SELECT id FROM cpe_catalog WHERE name = ? LIMIT 1").bind(normalized).first();
  if (existing) return { error: "Echipamentul există deja în catalog.", status: 409 as const };
  await getRawDb().prepare("INSERT INTO cpe_catalog (id, name, requires_grounding, created_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), normalized, requiresGrounding ? 1 : 0, Date.now()).run();
  return { name: normalized, requiresGrounding };
}

export async function updateCpe(previousName: string, name: string, requiresGrounding: boolean) {
  const originalName = previousName.trim();
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 120) return { error: "Denumirea echipamentului nu este validă.", status: 400 as const };

  const existing = await getRawDb().prepare("SELECT id, name FROM cpe_catalog WHERE name = ? LIMIT 1").bind(originalName).first<{ id: string; name: string }>();
  if (!existing) return { error: "Echipamentul selectat nu există în catalog.", status: 404 as const };

  if (existing.name !== normalized) {
    const duplicate = await getRawDb().prepare("SELECT id FROM cpe_catalog WHERE name = ? AND id != ? LIMIT 1").bind(normalized, existing.id).first();
    if (duplicate) return { error: "Echipamentul există deja în catalog.", status: 409 as const };
  }

  await getRawDb().batch([
    getRawDb().prepare("UPDATE cpe_catalog SET name = ?, requires_grounding = ? WHERE id = ?").bind(normalized, requiresGrounding ? 1 : 0, existing.id),
    getRawDb().prepare("UPDATE projects SET cpe = ?, cpe_requires_grounding = ?, updated_at = ? WHERE cpe = ?").bind(normalized, requiresGrounding ? 1 : 0, Date.now(), existing.name),
  ]);
  return { previousName: existing.name, name: normalized, requiresGrounding };
}

export function bucket() {
  if (!storageEnvironment.BUCKET) throw new Error("Stocarea securizată a fișierelor nu este disponibilă.");
  return storageEnvironment.BUCKET;
}

export function validateUpload(section: string, category: string, file: File) {
  if (!fileSections.has(section)) return "Secțiunea fișierului nu este validă.";
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(category)) return "Categoria fișierului nu este validă.";
  if (file.size <= 0 || file.size > maximumUploadBytes) return "Fișierul trebuie să aibă maximum 20 MB.";
  if (section !== "project" && section !== "documents" && !file.type.startsWith("image/")) {
    return "Această secțiune acceptă numai fotografii.";
  }
  return null;
}

function fileMetadata(row: StoredFileRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    section: row.section,
    category: row.category,
    name: row.original_name,
    contentType: row.content_type,
    size: row.byte_size,
    geo: row.geolocation,
    capturedAt: row.captured_at,
    uploadedBy: row.uploaded_by,
    url: `/api/files/${row.id}`,
  };
}

export async function storeFile(input: { projectId: string; section: string; category: string; file: File; geo: string; uploadedBy: string }) {
  const id = crypto.randomUUID();
  const safeName = input.file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  const key = `${input.projectId}/${input.section}/${input.category}/${id}-${safeName || "fisier"}`;
  const contentType = input.file.type || "application/octet-stream";
  await bucket().put(key, input.file.stream(), {
    httpMetadata: { contentType },
    customMetadata: { projectId: input.projectId, section: input.section, category: input.category },
  });
  const now = Date.now();
  try {
    await getRawDb()
      .prepare(
        "INSERT INTO project_files (id, project_id, section, category, original_name, content_type, byte_size, storage_key, geolocation, captured_at, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, input.projectId, input.section, input.category, input.file.name, contentType, input.file.size, key, input.geo, now, input.uploadedBy, now)
      .run();
  } catch (error) {
    await bucket().delete(key);
    throw error;
  }

  return fileMetadata({
    id,
    project_id: input.projectId,
    section: input.section,
    category: input.category,
    original_name: input.file.name,
    content_type: contentType,
    byte_size: input.file.size,
    storage_key: key,
    geolocation: input.geo,
    captured_at: now,
    uploaded_by: input.uploadedBy,
    created_at: now,
  });
}

export async function listProjectFiles(projectId: string, section?: string) {
  const query = section
    ? getRawDb().prepare("SELECT * FROM project_files WHERE project_id = ? AND section = ? ORDER BY created_at ASC").bind(projectId, section)
    : getRawDb().prepare("SELECT * FROM project_files WHERE project_id = ? ORDER BY created_at ASC").bind(projectId);
  const rows = await query.all<StoredFileRow>();
  return (rows.results ?? []).map((row: StoredFileRow) => fileMetadata(row));
}

export async function getFileRow(fileId: string) {
  return getRawDb().prepare("SELECT * FROM project_files WHERE id = ? LIMIT 1").bind(fileId).first<StoredFileRow>();
}

export async function removeFile(fileId: string) {
  const file = await getFileRow(fileId);
  if (!file) return false;
  await bucket().delete(file.storage_key);
  await getRawDb().prepare("DELETE FROM project_files WHERE id = ?").bind(fileId).run();
  return true;
}

export async function readReport(projectId: string) {
  const row = await getRawDb().prepare("SELECT content_json, updated_at FROM project_reports WHERE project_id = ? LIMIT 1").bind(projectId).first<{ content_json: string; updated_at: number }>();
  if (!row) return null;
  return { report: JSON.parse(row.content_json) as Record<string, string>, updatedAt: row.updated_at };
}

export async function writeReport(projectId: string, content: Record<string, string>, account: AuthenticatedAccount) {
  const serialized = JSON.stringify(content);
  if (serialized.length > 300_000) return { error: "Raportul depășește dimensiunea permisă.", status: 400 as const };
  const now = Date.now();
  await getRawDb()
    .prepare("INSERT INTO project_reports (project_id, content_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET content_json = excluded.content_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
    .bind(projectId, serialized, account.username, now)
    .run();
  return { report: content, updatedAt: now };
}
