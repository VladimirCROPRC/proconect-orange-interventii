"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import type { MapSiteRow } from "./map-sites-client";

type ImportPreview = { source: string; sites: MapSiteRow[]; rejected: number };
type Status = { configured?: boolean; source?: string; valid?: number; rejected?: Record<string, number>; updatedAt?: number; error?: string };

const aliases = {
  code: ["cod", "code", "sitecode", "siteid", "idsite"],
  description: ["nume", "name", "descriere", "description", "denumire", "sitename", "numedescriere"],
  region: ["regiune", "region", "localitate", "oras", "city", "judet", "county", "regiunelocalitate"],
  lat: ["lat", "latitude", "latitudine", "gpslat"],
  lon: ["lon", "lng", "longitude", "longitudine", "gpslon", "gpslng"],
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function columnIndex(headers: string[], names: string[]) {
  return headers.findIndex((header) => names.includes(normalized(header)));
}

function rowsToSites(rows: string[][], source: string): ImportPreview {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim()));
  if (headerIndex < 0) throw new Error("Fișierul este gol.");
  const headers = rows[headerIndex];
  const indexes = {
    code: columnIndex(headers, aliases.code),
    description: columnIndex(headers, aliases.description),
    region: columnIndex(headers, aliases.region),
    lat: columnIndex(headers, aliases.lat),
    lon: columnIndex(headers, aliases.lon),
  };
  if (Object.values(indexes).some((index) => index < 0)) {
    throw new Error("Lipsesc coloanele Cod, Nume/Descriere, Regiune/Localitate, Latitudine sau Longitudine.");
  }
  const sites: MapSiteRow[] = [];
  let rejected = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some((cell) => cell.trim())) continue;
    const code = row[indexes.code]?.trim() ?? "";
    const description = row[indexes.description]?.trim() ?? "";
    const region = row[indexes.region]?.trim() ?? "";
    const latitudeText = (row[indexes.lat] ?? "").trim();
    const longitudeText = (row[indexes.lon] ?? "").trim();
    const lat = latitudeText ? Number(latitudeText.replace(",", ".")) : Number.NaN;
    const lon = longitudeText ? Number(longitudeText.replace(",", ".")) : Number.NaN;
    if (!code || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      rejected += 1;
      continue;
    }
    sites.push([code, description, region, lat, lon]);
  }
  if (!sites.length) throw new Error("Nu a fost găsit niciun site cu coordonate valide.");
  sites.sort((left, right) => left[3] - right[3]);
  return { source, sites, rejected };
}

function parseCsv(text: string) {
  const delimiter = (text.split("\n", 1)[0].match(/;/g)?.length ?? 0) > (text.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value); value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += char;
  }
  row.push(value); rows.push(row);
  return rows;
}

function u16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function u32(view: DataView, offset: number) { return view.getUint32(offset, true); }

async function unzipEntry(buffer: ArrayBuffer, wanted: string) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = bytes.length - 22;
  while (eocd >= Math.max(0, bytes.length - 65_557) && u32(view, eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error("Structura fișierului XLSX nu este validă.");
  const entries = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index += 1) {
    if (u32(view, offset) !== 0x02014b50) break;
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name === wanted) {
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method !== 8) throw new Error("Metoda de compresie XLSX nu este acceptată.");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function xmlDocument(bytes: Uint8Array) {
  const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Conținutul XML din Excel este invalid.");
  return document;
}

function columnNumber(reference: string) {
  const letters = /^[A-Z]+/i.exec(reference)?.[0].toUpperCase() ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

async function parseXlsx(buffer: ArrayBuffer) {
  const sheetBytes = await unzipEntry(buffer, "xl/worksheets/sheet1.xml");
  if (!sheetBytes) throw new Error("Prima foaie Excel nu a putut fi citită.");
  const sharedBytes = await unzipEntry(buffer, "xl/sharedStrings.xml");
  const shared = sharedBytes ? Array.from(xmlDocument(sharedBytes).querySelectorAll("si")).map((item) =>
    Array.from(item.querySelectorAll("t")).map((text) => text.textContent ?? "").join("")
  ) : [];
  const sheet = xmlDocument(sheetBytes);
  return Array.from(sheet.querySelectorAll("sheetData > row")).map((row) => {
    const result: string[] = [];
    for (const cell of Array.from(row.querySelectorAll("c"))) {
      const index = columnNumber(cell.getAttribute("r") ?? "A");
      const type = cell.getAttribute("t");
      const raw = cell.querySelector("v")?.textContent ?? "";
      const inline = Array.from(cell.querySelectorAll("is t")).map((text) => text.textContent ?? "").join("");
      result[index] = type === "s" ? (shared[Number(raw)] ?? "") : type === "inlineStr" ? inline : raw;
    }
    return result.map((value) => value ?? "");
  });
}

async function readImport(file: File) {
  if (file.size > 35 * 1024 * 1024) throw new Error("Fișierul depășește limita de 35 MB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const rows = extension === "csv" ? parseCsv(await file.text()) : extension === "xlsx" ? await parseXlsx(await file.arrayBuffer()) : null;
  if (!rows) throw new Error("Selectează un fișier .xlsx sau .csv.");
  return rowsToSites(rows, file.name);
}

export function MapSitesSettings({ onNotify }: { onNotify: (message: string) => void }) {
  const [status, setStatus] = useState<Status>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/map-sites", { cache: "no-store" })
      .then(async (response) => response.status === 404 ? { configured: false } : response.json())
      .then(setStatus)
      .catch(() => setStatus({ error: "Starea listei nu poate fi citită." }));
  }, []);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true); setError(""); setPreview(null);
    try { setPreview(await readImport(file)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Fișierul nu a putut fi citit."); }
    finally { setReading(false); }
  }

  async function save() {
    if (!preview) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/map-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: preview.source, sites: preview.sites, rejected: preview.rejected }),
      });
      const responseText = await response.text();
      let result: Status = {};
      try { result = responseText ? JSON.parse(responseText) as Status : {}; }
      catch { result = {}; }
      if (!response.ok) throw new Error(result.error || `Importul nu a reușit (HTTP ${response.status}).`);
      setStatus({ configured: true, ...result }); setPreview(null);
      onNotify(`${result.valid?.toLocaleString("ro-RO")} site-uri au fost publicate pe toate hărțile.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Importul nu a reușit."); }
    finally { setSaving(false); }
  }

  const rejected = status.rejected ? Object.values(status.rejected).reduce((sum, count) => sum + count, 0) : 0;
  return <section className="project-card map-sites-settings">
    <div className="card-heading"><div><h2>Site-uri hartă</h2><p>Actualizează registrul OrangeNetwork folosit în Instalări, Intervenții și Survey.</p></div></div>
    <div className="map-sites-content">
      <div className="map-sites-status">
        <span>{status.configured ? "✓" : "i"}</span>
        <div><strong>{status.configured ? `${status.valid?.toLocaleString("ro-RO")} site-uri active` : "Este folosită lista inclusă în aplicație"}</strong>
          <small>{status.source ? `${status.source} · ${rejected} respinse · ${status.updatedAt ? new Date(status.updatedAt).toLocaleString("ro-RO") : ""}` : "Încarcă primul fișier pentru actualizare."}</small></div>
      </div>
      <div className="map-sites-format"><strong>Coloane obligatorii</strong><code>Cod · Nume/Descriere · Regiune/Localitate · Latitudine · Longitudine</code><small>Prima foaie din XLSX este importată. Lista actuală este păstrată până confirmi publicarea.</small></div>
      <label className="map-sites-upload"><input type="file" accept=".xlsx,.csv" onChange={chooseFile} disabled={reading || saving} /><span>↑</span><div><strong>{reading ? "Se verifică fișierul…" : "Selectează Excel sau CSV"}</strong><small>Maximum 35 MB · maximum 250.000 de rânduri valide</small></div></label>
      {preview && <div className="map-sites-preview"><div><strong>{preview.sites.length.toLocaleString("ro-RO")} valide</strong><small>{preview.rejected.toLocaleString("ro-RO")} rânduri respinse · {preview.source}</small></div><button className="primary-button" onClick={save} disabled={saving}>{saving ? "Se publică…" : "Publică lista"}</button><button className="secondary-button" onClick={() => setPreview(null)} disabled={saving}>Renunță</button></div>}
      {error && <p className="form-error">{error}</p>}
    </div>
  </section>;
}
