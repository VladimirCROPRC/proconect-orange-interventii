import { getRawDb } from "../db";
import { syncProjectIfConnected } from "./backup-server";
import { readOrangeMail } from "./onedrive-server";
import { createProject } from "./project-server";
import type { ProjectRecord } from "./project-data";
import type { AuthenticatedAccount } from "./server-auth";

const importAccount: AuthenticatedAccount = {
  username: "microsoft-mail-import",
  name: "Import e-mail Microsoft 365",
  role: "Admin",
  contractor: "",
  active: true,
  jobs: 0,
  passwordResetRequired: false,
};

function bucharestInputDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function fittSla(value: string) {
  const severity = value.trim().toLowerCase();
  if (severity === "minor") return "Minor 12h";
  if (severity === "major") return "Major 8h";
  if (severity === "critic" || severity === "critical") return "Critic 4h";
  return "";
}

export async function orangeMailImportStatus() {
  const row = await getRawDb().prepare("SELECT enabled, activated_at, last_run_at, last_error FROM orange_mail_import WHERE id = 'orange'")
    .first<{ enabled?: number; activated_at?: number; last_run_at?: number; last_error?: string }>();
  const counts = await getRawDb().prepare("SELECT COUNT(*) AS processed, SUM(CASE WHEN status = 'created' THEN 1 ELSE 0 END) AS created FROM orange_mail_messages")
    .first<{ processed?: number; created?: number }>();
  return { enabled: Boolean(row?.enabled), activatedAt: row?.activated_at ?? 0, lastRunAt: row?.last_run_at ?? 0, lastError: row?.last_error ?? "", processed: counts?.processed ?? 0, created: counts?.created ?? 0 };
}

export async function setOrangeMailImportEnabled(enabled: boolean) {
  const now = Date.now();
  await getRawDb().prepare("INSERT INTO orange_mail_import (id, enabled, activated_at, last_run_at, last_error) VALUES ('orange', ?, ?, 0, '') ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, activated_at = CASE WHEN excluded.enabled = 1 AND orange_mail_import.enabled = 0 THEN excluded.activated_at ELSE orange_mail_import.activated_at END, last_error = ''")
    .bind(enabled ? 1 : 0, now).run();
  return orangeMailImportStatus();
}

export async function importOrangeMailTickets() {
  const state = await orangeMailImportStatus();
  if (!state.enabled) return { ...state, scanned: 0, createdNow: 0 };
  let createdNow = 0;
  try {
    const preview = await readOrangeMail(state.activatedAt, 50);
    const messages = [...preview.messages].sort((first, second) => first.receivedAt.localeCompare(second.receivedAt));
    for (const message of messages) {
      const handled = await getRawDb().prepare("SELECT message_id FROM orange_mail_messages WHERE message_id = ? LIMIT 1").bind(message.messageId).first();
      if (handled) continue;
      const duplicate = await getRawDb().prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").bind(message.ticketId).first();
      if (duplicate) {
        await getRawDb().prepare("INSERT OR IGNORE INTO orange_mail_messages (message_id, ticket_id, received_at, status, error, processed_at) VALUES (?, ?, ?, 'duplicate', '', ?)")
          .bind(message.messageId, message.ticketId, message.receivedAt, Date.now()).run();
        continue;
      }
      const project: ProjectRecord = {
        id: message.ticketId, activityType: "Intervenție Orange", orderNumber: "",
        foSectionName: message.foSection, topology: "", cableCapacity: 0, routeType: "",
        orangeInterventionType: message.flow, sla: message.flow === "FITT" ? fittSla(message.severity) : "",
        departureLocality: message.locality, county: message.county,
        client: message.siteA, address: message.siteB, contact: "", phone: "", email: "",
        requirements: message.incidentDescription, technician: "", technicians: [], cpe: "",
        cpeRequiresGrounding: false, sfp: false, mc: false, mcType: "", terminalBox: false,
        status: "Planificat", date: bucharestInputDate(message.receivedAt), ipwo: "Fișier neîncărcat", splice: "Fișier neîncărcat",
      };
      const result = await createProject(project, importAccount);
      if ("error" in result) {
        await getRawDb().prepare("INSERT OR REPLACE INTO orange_mail_messages (message_id, ticket_id, received_at, status, error, processed_at) VALUES (?, ?, ?, 'error', ?, ?)")
          .bind(message.messageId, message.ticketId, message.receivedAt, result.error.slice(0, 500), Date.now()).run();
        continue;
      }
      await getRawDb().prepare("INSERT INTO orange_mail_messages (message_id, ticket_id, received_at, status, error, processed_at) VALUES (?, ?, ?, 'created', '', ?)")
        .bind(message.messageId, message.ticketId, message.receivedAt, Date.now()).run();
      createdNow += 1;
      await syncProjectIfConnected(message.ticketId);
    }
    await getRawDb().prepare("UPDATE orange_mail_import SET last_run_at = ?, last_error = '' WHERE id = 'orange'").bind(Date.now()).run();
    return { ...(await orangeMailImportStatus()), scanned: preview.scanned, createdNow };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Importul automat nu a reușit.";
    await getRawDb().prepare("UPDATE orange_mail_import SET last_run_at = ?, last_error = ? WHERE id = 'orange'").bind(Date.now(), message).run();
    throw error;
  }
}
