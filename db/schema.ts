import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    passwordResetRequired: integer("password_reset_required", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    jobs: integer("jobs").notNull().default(0),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: integer("locked_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("app_users_username_idx").on(table.username)],
);

export const appSessions = sqliteTable(
  "app_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [uniqueIndex("app_sessions_token_hash_idx").on(table.tokenHash)],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  activityType: text("activity_type").notNull().default("Intervenție Orange"),
  orderNumber: text("order_number").notNull().default(""),
  foSectionName: text("fo_section_name").notNull().default(""),
  topology: text("topology").notNull().default(""),
  cableCapacity: integer("cable_capacity").notNull().default(0),
  routeType: text("route_type").notNull().default(""),
  orangeInterventionType: text("orange_intervention_type").notNull().default(""),
  sla: text("sla").notNull().default(""),
  departureLocality: text("departure_locality").notNull().default(""),
  county: text("county").notNull().default(""),
  client: text("client").notNull(),
  address: text("address").notNull(),
  contact: text("contact").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull().default(""),
  requirements: text("requirements").notNull(),
  technician: text("technician").notNull(),
  technicianUsername: text("technician_username").notNull(),
  cpe: text("cpe").notNull(),
  cpeRequiresGrounding: integer("cpe_requires_grounding", { mode: "boolean" }).notNull().default(false),
  sfp: integer("sfp", { mode: "boolean" }).notNull().default(false),
  mc: integer("mc", { mode: "boolean" }).notNull().default(false),
  mcType: text("mc_type").notNull().default(""),
  terminalBox: integer("terminal_box", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull(),
  scheduledLabel: text("scheduled_label").notNull(),
  ipwo: text("ipwo").notNull(),
  splice: text("splice").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("projects_technician_username_idx").on(table.technicianUsername)]);

export const projectFieldDocumentation = sqliteTable("project_field_documentation", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  contentJson: text("content_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projectFiles = sqliteTable("project_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  section: text("section").notNull(),
  category: text("category").notNull(),
  originalName: text("original_name").notNull(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  storageKey: text("storage_key").notNull(),
  geolocation: text("geolocation").notNull().default(""),
  capturedAt: integer("captured_at").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("project_files_project_section_idx").on(table.projectId, table.section),
  uniqueIndex("project_files_storage_key_idx").on(table.storageKey),
]);

export const projectReports = sqliteTable("project_reports", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  contentJson: text("content_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const cpeCatalog = sqliteTable("cpe_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  requiresGrounding: integer("requires_grounding", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("cpe_catalog_name_idx").on(table.name)]);

export const googleDriveSettings = sqliteTable("google_drive_settings", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  encryptedClientSecret: text("encrypted_client_secret").notNull(),
  accountEmail: text("account_email").notNull().default(""),
  encryptedAccessToken: text("encrypted_access_token").notNull().default(""),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull().default(""),
  accessTokenExpiresAt: integer("access_token_expires_at").notNull().default(0),
  rootFolderId: text("root_folder_id").notNull().default(""),
  rootFolderName: text("root_folder_name").notNull().default("Proconect B2B"),
  connectedBy: text("connected_by").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const googleDriveOauthStates = sqliteTable("google_drive_oauth_states", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  encryptedVerifier: text("encrypted_verifier").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const googleDriveProjectFolders = sqliteTable("google_drive_project_folders", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  folderId: text("folder_id").notNull(),
  folderUrl: text("folder_url").notNull(),
  sectionFoldersJson: text("section_folders_json").notNull(),
  reportFileId: text("report_file_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const googleDriveFileSync = sqliteTable("google_drive_file_sync", {
  fileId: text("file_id").primaryKey().references(() => projectFiles.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  driveFileId: text("drive_file_id").notNull().default(""),
  status: text("status").notNull(),
  lastError: text("last_error").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("google_drive_file_sync_project_idx").on(table.projectId)]);

export const onedriveConnection = sqliteTable("onedrive_connection", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull().default("google"),
  generation: text("generation").notNull().default(""),
  access_token: text("access_token").notNull().default(""),
  refresh_token: text("refresh_token").notNull().default(""),
  expires_at: integer("expires_at").notNull().default(0),
  drive_id: text("drive_id").notNull().default(""),
  root_id: text("root_id").notNull().default(""),
  root_url: text("root_url").notNull().default(""),
  account: text("account").notNull().default(""),
  owner_id: text("owner_id").notNull().default(""),
  lease: text("lease").notNull().default(""),
  lease_until: integer("lease_until").notNull().default(0),
});

export const onedriveOauthStates = sqliteTable("onedrive_oauth_states", {
  id: text("id").primaryKey(),
  session_id: text("session_id").notNull(),
  verifier: text("verifier").notNull(),
  expires_at: integer("expires_at").notNull(),
});

export const onedriveJobs = sqliteTable("onedrive_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  item_id: text("item_id").notNull(),
  revision: integer("revision").notNull().default(1),
  done_revision: integer("done_revision").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  next_at: integer("next_at").notNull().default(0),
  last_error: text("last_error").notNull().default(""),
}, (table) => [index("onedrive_jobs_pending_idx").on(table.next_at)]);
