import * as google from "./google-drive-server";
import { backupMode, deleteOneDriveFileCopy, queueOneDrive, syncOrangeTicketWorkbook } from "./onedrive-server";
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
  // A newly generated Orange ticket must appear in the Excel centralizer
  // immediately. The queued project job remains the retry path and also
  // generates the OneDrive folder, QAF and KMZ when field data is available.
  const outcomes = await Promise.allSettled([
    queueOneDrive("project", id),
    usesOneDrive(mode) ? syncOrangeTicketWorkbook(id) : Promise.resolve(),
    usesGoogle(mode) ? google.syncProjectIfConnected(id) : Promise.resolve(),
  ]);
  for (const result of outcomes) if (result.status === "rejected") console.error("Project synchronization requires retry");
}
export async function syncReportIfConnected(id: string) {
  const mode = await backupMode();
  // Field actions update Excel Online immediately. The queued project export
  // still regenerates QAF/KMZ and provides an automatic retry path.
  const outcomes = await Promise.allSettled([
    queueOneDrive("project", id),
    usesOneDrive(mode) ? syncOrangeTicketWorkbook(id) : Promise.resolve(),
    usesGoogle(mode) ? google.syncReportIfConnected(id) : Promise.resolve(),
  ]);
  for (const result of outcomes) if (result.status === "rejected") console.error("Drive report refresh requires retry");
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
