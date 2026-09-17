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
