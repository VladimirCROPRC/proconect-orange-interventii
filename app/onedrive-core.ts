export type BackupMode = "google" | "onedrive" | "both";
export function validMode(value: unknown): value is BackupMode {
  return value === "google" || value === "onedrive" || value === "both";
}
export function usesOneDrive(mode: BackupMode) { return mode !== "google"; }
export function usesGoogle(mode: BackupMode) { return mode !== "onedrive"; }
export function base64url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode64(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
}
export async function safeName(label: string, id: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
  const suffix = Array.from(digest.slice(0, 16), n => n.toString(16).padStart(2, "0")).join("");
  const printable = Array.from(label.normalize("NFC"), c => c.charCodeAt(0) < 32 ? "_" : c).join("");
  const clean = printable.replace(/["*:<>?\/\\|#%]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 110) || "document";
  const dot = clean.lastIndexOf(".");
  return dot > 0 ? `${clean.slice(0, dot)}--${suffix}${clean.slice(dot)}` : `${clean}--${suffix}`;
}
export function retryDelay(attempt: number, retryAfter: string | null = null, now = Date.now()) {
  const seconds = Number(retryAfter);
  const requested = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now) : 0;
  return Math.max(30_000, Math.min(86_400_000, Math.max(Number.isFinite(requested) ? requested : 0, 30_000 * 2 ** Math.min(attempt, 10))));
}
export function fixedOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("PROCONECT_APP_URL trebuie să fie originea HTTPS a aplicației.");
  return url.origin;
}

export function workbookTicketRow(ticketRows: unknown[][], ticketId: string, fullRows: unknown[][] = ticketRows) {
  const normalizedTicket = ticketId.trim().toUpperCase();
  const existingIndex = ticketRows.findIndex((row) => String(row[0] ?? "").trim().toUpperCase() === normalizedTicket);
  if (existingIndex >= 0) return { existingIndex, targetIndex: existingIndex };
  // A blank Ticket ID does not mean that the row is unused. Some historical
  // entries have a missing ID but valid data in other columns.
  const emptyIndex = fullRows.findIndex((row) => row.every((value) => !String(value ?? "").trim()));
  return { existingIndex: -1, targetIndex: emptyIndex };
}

export type WorkbookCell = string | number;

function blankWorkbookCell(value: unknown) {
  return String(value ?? "").trim() === "";
}

function sameWorkbookCell(first: unknown, second: unknown) {
  return String(first ?? "") === String(second ?? "");
}

export function preserveManualWorkbookCells(
  current: WorkbookCell[],
  desired: WorkbookCell[],
  previousAppValues: Array<WorkbookCell | null> | null,
  managedIndexes: number[],
  newRow: boolean,
) {
  const values = [...current];
  const appValues: Array<WorkbookCell | null> = previousAppValues
    ? Array.from({ length: desired.length }, (_, index) => previousAppValues[index] ?? null)
    : Array.from({ length: desired.length }, () => null);
  const protectedIndexes: number[] = [];

  for (const index of managedIndexes) {
    const currentValue = current[index] ?? "";
    const desiredValue = desired[index] ?? "";
    const previousValue = previousAppValues?.[index] ?? null;
    // Missing application data must never erase an existing workbook value,
    // regardless of whether that value was written manually or by a previous
    // synchronization.
    const wouldClearExistingValue = blankWorkbookCell(desiredValue) && !blankWorkbookCell(currentValue);
    const mayWrite = !wouldClearExistingValue && (newRow
      || blankWorkbookCell(currentValue)
      || (previousValue !== null && sameWorkbookCell(currentValue, previousValue)));
    if (mayWrite) {
      values[index] = desiredValue;
      appValues[index] = desiredValue;
    } else {
      protectedIndexes.push(index);
    }
  }
  return { values, appValues, protectedIndexes };
}
