"use client";
import { useEffect, useState } from "react";
type Status = { configured: boolean; connected: boolean; mode: string; account: string; rootUrl: string; synced: number; pending: number; errors: { kind: string; item_id: string; last_error: string }[] };
type Payload = Status & { error?: string; authorizationUrl?: string };
export function OneDriveSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  useEffect(() => {
    let mounted = true;
    fetch("/api/onedrive", { cache: "no-store" }).then(async response => {
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error);
      if (mounted) setStatus(data);
    }).catch(e => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, []);
  async function action(actionName: string, mode?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/onedrive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: actionName, mode }) });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error);
      if (data.authorizationUrl) { window.location.assign(data.authorizationUrl); return; }
      setStatus(data as Status);
      if (actionName === "retry") setProcessing(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Operațiunea a eșuat."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!processing || !status?.connected || status.mode === "google") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function next() {
      try {
        const response = await fetch("/api/onedrive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "process" }) });
        const data = await response.json() as Payload;
        if (!response.ok) throw new Error(data.error);
        if (cancelled) return;
        setStatus(data);
        if (!data.pending) { setProcessing(false); return; }
        timer = setTimeout(next, 5000);
      } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : "Sincronizarea a eșuat."); setProcessing(false); } }
    }
    void next();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [processing, status?.connected, status?.mode]);
  return <div className="page-wrap inner-page drive-settings-page">
    <section className="project-card drive-config-card">
      <div className="card-heading"><div><h2>OneDrive și destinații de salvare</h2><p>Contul Microsoft este conectat doar de administrator. Conturile tehnicienilor nu se schimbă.</p></div></div>
      {error && <p className="drive-inline-error" role="alert">{error}</p>}
      {!status ? <p>Se verifică integrarea…</p> : <div className="drive-config-form">
        <p><strong>{status.connected ? `Conectat: ${status.account}` : status.configured ? "OneDrive necesită conectare" : "OneDrive necesită configurarea variabilelor și secretelor în Cloudflare"}</strong></p>
        <p>Cloudflare păstrează datele originale. Alegerea de mai jos controlează copiile automate; nu șterge arhivele existente.</p>
        <label><span>Destinație pentru copiile automate</span><select value={status.mode} disabled={busy || !status.connected || processing} onChange={e => void action("mode", e.target.value)}>
          <option value="google">Google Drive</option><option value="onedrive">OneDrive</option><option value="both">Google Drive + OneDrive</option>
        </select></label>
        <small>Google Drive trebuie conectat separat, în panoul de mai jos. Conectarea OneDrive nu schimbă automat destinația.</small>
        <div className="drive-config-actions">
          <button className="primary-button" disabled={busy || processing || !status.configured} onClick={() => void action("authorize")}>{status.connected ? "Reconectează Microsoft" : "Conectează Microsoft 365"}</button>
          {status.connected && <button className="secondary-button" disabled={busy || processing} onClick={() => { if (window.confirm("Deconectezi OneDrive? Copiile existente rămân acolo. Destinația revine la Google Drive.")) void action("disconnect"); }}>Deconectează</button>}
        </div>
        {status.connected && <>
          {status.rootUrl && <a href={status.rootUrl} target="_blank" rel="noreferrer">Deschide dosarul OneDrive ↗</a>}
          <p>{status.synced} elemente sincronizate · {status.pending} în așteptare</p>
          <div className="drive-config-actions"><button className="primary-button" disabled={busy || processing || status.mode === "google"} onClick={() => void action("retry")}>Resincronizează proiectele și fișierele</button>{processing && <button className="secondary-button" onClick={() => setProcessing(false)}>Oprește procesarea din acest ecran</button>}</div>
          <p>{processing ? "Se procesează pe rând. Păstrează acest ecran deschis pentru copierea întregii arhive." : "Proiectele noi creează automat structura de foldere. Resincronizarea recreează folderele lipsă și retrimite toate fotografiile și documentele active."}</p>
          {status.errors.map(item => <p role="status" key={`${item.kind}:${item.item_id}`}>{item.item_id}: {item.last_error}</p>)}
        </>}
        <small>OneDrive creează folderele proiectelor și primește exclusiv fotografiile și documentele încărcate de utilizatori, organizate pe activitate, lucrare și secțiune. Datele interne ale aplicației nu sunt exportate. Ștergerile din aplicație nu șterg copiile OneDrive.</small>
      </div>}
    </section>
  </div>;
}
