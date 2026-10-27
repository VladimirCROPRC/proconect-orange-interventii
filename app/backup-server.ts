import * as google from "./google-drive-server";
import { backupMode, deleteOneDriveFileCopy, queueOneDrive, syncOneDriveProject, syncOrangeTicketWorkbook } from "./onedrive-server";
import { usesGoogle, usesOneDrive } from "./onedrive-core";
import { getFileRow } from "./project-server";

async function both(kind: "file" | "project", id: string, googleSync: () => Promise<unknown>) {
  const mode = await backupMode();
  // Independent outcomes: a failed provider never skips the other provider.
  const outcomes = await Promise.allSettled([
    queueOneDrive(kind, id),
    usesGoogle(mode) ? googleSync() : Promise.resolve(),
  ]);
  for (const result of outcomes) if (result.status === "rejected") console.error("Backup destination requires retry");
}
export async function syncProjectIfConnected(id: string) {
  const mode = await backupMode();
  // Update the centralizer immediately and keep the project export queued for
  // folders, QAF and KMZ. The optimized workbook lookup reads only Ticket ID.
  const outcomes = await Promise.allSettled([
    queueOneDrive("project", id),
    syncOrangeTicketWorkbook(id),
    usesGoogle(mode) ? google.syncProjectIfConnected(id) : Promise.resolve(),
  ]);
  for (const result of outcomes) if (result.status === "rejected") console.error("Project synchronization requires retry");
}
export async function syncReportIfConnected(id: string) {
  const mode = await backupMode();
  // Field actions update the centralizer immediately and queue QAF/KMZ
  // regeneration as a separate, retryable export.
  const outcomes = await Promise.allSettled([
    queueOneDrive("project", id),
    syncOrangeTicketWorkbook(id),
    usesGoogle(mode) ? google.syncReportIfConnected(id) : Promise.resolve(),
  ]);
  for (const result of outcomes) if (result.status === "rejected") console.error("Drive report refresh requires retry");
}
export async function syncFinalizedReportIfConnected(id: string) {
  const mode = await backupMode();
  // Closing a ticket must publish the QAF generated from the final saved state,
  // including validation date, closing date/time and selected services.
  const outcomes = await Promise.allSettled([
    usesOneDrive(mode) ? syncOneDriveProject(id, true) : Promise.resolve(),
    usesGoogle(mode) ? google.syncReportIfConnected(id) : Promise.resolve(),
  ]);
  for (const result of outcomes) if (result.status === "rejected") console.error("Final QAF synchronization requires retry");
}

export async function syncFileIfConnected(id: string) {
  await both("file", id, () => google.syncFileIfConnected(id));
  const file = await getFileRow(id);
  if (file) await queueOneDrive("project", file.project_id);
}

export async function deleteFileBackups(fileId: string) {
  const outcomes = await Promise.allSettled([
    google.deleteDriveFileCopy(fileId),
    deleteOneDriveFileCopy(fileId),
  ]);
  const failures = outcomes.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
  if (failures.length) {
    const messages = failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : "Destinația externă a refuzat ștergerea.");
    throw new Error(messages.join(" "));
  }
}
