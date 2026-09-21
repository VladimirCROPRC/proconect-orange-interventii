"use client";

import { useEffect, useMemo, useState } from "react";

type Subject = { name: string; tickets: number };
type MonthlyReportSummary = {
  technicians: Subject[];
  contractors: Subject[];
  unassignedTechnicians: string[];
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthlyReports({ onNotify }: { onNotify: (message: string) => void }) {
  const [month, setMonth] = useState(currentMonth);
  const [rate, setRate] = useState("4,977");
  const [rateDate, setRateDate] = useState("");
  const [summary, setSummary] = useState<MonthlyReportSummary>({ technicians: [], contractors: [], unassignedTechnicians: [] });
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/monthly-reports?month=${encodeURIComponent(month)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const payload = await response.json() as MonthlyReportSummary & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Rapoartele lunare nu sunt disponibile.");
        if (mounted) setSummary(payload);
      })
      .catch((error) => { if (mounted) onNotify(error instanceof Error ? error.message : "Rapoartele lunare nu sunt disponibile."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [month]);

  const totalReports = summary.technicians.length + summary.contractors.length;
  const querySuffix = useMemo(() => `&rate=${encodeURIComponent(rate)}&rateDate=${encodeURIComponent(rateDate)}`, [rate, rateDate]);

  async function download(url: string, key: string) {
    setDownloading(key);
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Raportul nu a putut fi generat.");
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `raport-${month}.xlsx`;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      onNotify(`${filename} a fost generat.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Raportul nu a putut fi generat.");
    } finally {
      setDownloading("");
    }
  }

  return <div className="page-wrap inner-page monthly-reports-page">
    <section className="page-heading compact">
      <div><p className="eyebrow">RAPORTARE LUNARĂ</p><h1>Rapoarte tehnicieni și contractori</h1><p>Generează Anexa 3 din intervențiile Orange închise în luna selectată.</p></div>
      <button className="primary-button" disabled={!totalReports || Boolean(downloading)} onClick={() => void download(`/api/monthly-reports?month=${encodeURIComponent(month)}&download=1&all=1${querySuffix}`, "all")}>
        {downloading === "all" ? "Se generează…" : `Descarcă toate (${totalReports})`}
      </button>
    </section>
    <section className="project-card monthly-report-controls">
      <label><span>Luna raportării</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      <label><span>Curs EUR/RON</span><input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
      <label><span>Data cursului BNR</span><input type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} /></label>
      <p>În raport intră numai tichetele finalizate, după data de închidere din Documentare. Cursul poate fi modificat înainte de descărcare.</p>
    </section>
    {summary.unassignedTechnicians.length > 0 && <section className="monthly-report-warning"><strong>Contractor necompletat</strong><p>{summary.unassignedTechnicians.join(" · ")}. Completează asocierea în Management → Echipă pentru a genera și rapoartele contractorilor.</p></section>}
    <section className="monthly-report-columns">
      {(["technician", "contractor"] as const).map((scope) => {
        const entries = scope === "technician" ? summary.technicians : summary.contractors;
        return <article className="project-card monthly-report-list" key={scope}>
          <div className="card-heading"><div><h2>{scope === "technician" ? "Tehnicieni" : "Contractori"}</h2><p>{entries.length} rapoarte disponibile pentru {month}</p></div></div>
          {loading ? <p className="monthly-report-empty">Se verifică intervențiile…</p> : entries.length ? entries.map((entry) => {
            const key = `${scope}:${entry.name}`;
            return <div className="monthly-report-row" key={key}>
              <span>{scope === "technician" ? "T" : "C"}</span>
              <div><strong>{entry.name}</strong><small>{entry.tickets} {entry.tickets === 1 ? "tichet închis" : "tichete închise"}</small></div>
              <button disabled={Boolean(downloading)} onClick={() => void download(`/api/monthly-reports?month=${encodeURIComponent(month)}&download=1&scope=${scope}&subject=${encodeURIComponent(entry.name)}${querySuffix}`, key)}>{downloading === key ? "Se generează…" : "Descarcă XLSX"}</button>
            </div>;
          }) : <p className="monthly-report-empty">Nu există intervenții finalizate în luna selectată.</p>}
        </article>;
      })}
    </section>
  </div>;
}
