"use client";

import { useEffect, useState } from "react";

export type OroLookupResult = { kind: "site" | "junction"; id: string; code: string; name: string; owner: string; lat: number; lon: number };

type Props = {
  name?: string;
  defaultValue?: string;
  label?: string;
  kinds?: Array<"site" | "junction">;
  placeholder?: string;
  onSelect?: (result: OroLookupResult) => void;
};

export function OroLookup({ name, defaultValue = "", label, kinds = ["site"], placeholder = "Caută în registrul ORO", onSelect }: Props) {
  const [value, setValue] = useState(defaultValue);
  const [kind, setKind] = useState<"site" | "junction">(kinds[0] ?? "site");
  const [results, setResults] = useState<OroLookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) { setResults([]); setError(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/oro?type=${encodeURIComponent(kind)}&q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json() as { results?: OroLookupResult[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Căutarea ORO nu a reușit.");
        setResults(payload.results ?? []);
      } catch (lookupError) {
        if (!controller.signal.aborted) { setResults([]); setError(lookupError instanceof Error ? lookupError.message : "Căutarea ORO nu a reușit."); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [kind, value]);

  function choose(result: OroLookupResult) {
    setValue(result.code);
    setResults([]);
    setError("");
    onSelect?.(result);
  }

  return <div className="oro-lookup">
    {label && <span>{label}</span>}
    {kinds.length > 1 && <div className="oro-lookup-types">{kinds.map((item) => <button type="button" className={kind === item ? "active" : ""} key={item} onClick={() => { setKind(item); setResults([]); }}>{item === "site" ? "Site" : "Joncțiune"}</button>)}</div>}
    <input name={name} value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} autoComplete="off" />
    {loading && <small>Se caută în ORO…</small>}
    {error && <small className="oro-lookup-error">{error}</small>}
    {results.length > 0 && <div className="oro-lookup-results">{results.map((result) => <button type="button" key={`${result.kind}:${result.id}`} onClick={() => choose(result)}>
      <strong>{result.code}</strong><span>{result.name}</span>{result.owner && <small>{result.owner}</small>}<em>{result.lat.toFixed(6)}, {result.lon.toFixed(6)}</em>
    </button>)}</div>}
  </div>;
}

export function OroSiteMapLink({ siteCode }: { siteCode?: string }) {
  const [site, setSite] = useState<OroLookupResult | null>(null);

  useEffect(() => {
    const query = siteCode?.trim() ?? "";
    setSite(null);
    if (!query) return;
    const controller = new AbortController();
    void fetch(`/api/oro?type=site&q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ results?: OroLookupResult[] }> : { results: [] })
      .then((payload) => {
        const exactSite = payload.results?.find((result) => result.kind === "site" && result.code.trim().toLocaleLowerCase("ro") === query.toLocaleLowerCase("ro"));
        if (!controller.signal.aborted) setSite(exactSite ?? null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [siteCode]);

  if (!site) return null;
  const coordinates = `${site.lat.toFixed(6)},${site.lon.toFixed(6)}`;
  return <a className="oro-site-map-link" href={`https://www.google.com/maps/search/?api=1&query=${coordinates}`} target="_blank" rel="noreferrer">Deschide în Google Maps ↗</a>;
}
