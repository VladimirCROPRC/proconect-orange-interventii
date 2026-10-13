import * as google from "./google-drive-server";
import { backupMode, deleteOneDriveFileCopy, queueOneDrive } from "./onedrive-server";
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
  // The operational centralizer is maintained outside this synchronization.
  // Queue only the OneDrive project export (folders, QAF and KMZ).
  const outcomes = await Promise.allSettled([
    queueOneDrive("project", id),
    usesGoogle(mode) ? google.syncProjectIfConnected(id) : Promise.resolve(),
  ]);
  for (const result of outcomes) if (result.status === "rejected") console.error("Project synchronization requires retry");
}
export async function syncReportIfConnected(id: string) {
  const mode = await backupMode();
  // Field actions queue only document regeneration. The operational
  // centralizer is never read or written by this application.
  const outcomes = await Promise.allSettled([
    queueOneDrive("project", id),
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
