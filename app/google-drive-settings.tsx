"use client";

import { useEffect, useState, type FormEvent } from "react";

export type GoogleDriveStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail: string;
  clientId: string;
  rootFolderName: string;
  rootFolderUrl: string;
  redirectUri: string;
  projectsTotal: number;
  projectsSynced: number;
  filesTotal: number;
  filesSynced: number;
  folders: Record<string, string>;
  sections: Record<string, string>;
  activityFolders?: Record<string, string>;
  activitySections?: Record<string, Record<string, string>>;
};

type GoogleDriveSettingsProps = {
  initialStatus: GoogleDriveStatus | null;
  onStatusChange: (status: GoogleDriveStatus) => void;
  onNotify: (message: string) => void;
};

const sectionLabels: Record<string, string> = {
  project: "IPWO și diagrama de suduri",
  client: "Proces-verbal, teste și echipamente",
  route: "Fotografii GPS ale traseului",
  splices: "Fotografii joncțiuni și suduri",
  site: "ODF, eTN și ansamblu site",
  documents: "Rapoarte și documente de acceptanță",
  "intervention-assessment": "Tipul avariei și fotografii GPS",
  "intervention-execution": "Operațiunile de remediere",
  "intervention-documentation": "Documentația finală a intervenției",
};

export function GoogleDriveSettings({ initialStatus, onStatusChange, onNotify }: GoogleDriveSettingsProps) {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(initialStatus);
  const [loading, setLoading] = useState(!initialStatus);
  const [saving, setSaving] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editingConfiguration, setEditingConfiguration] = useState(false);
  const [error, setError] = useState("");

  async function refreshStatus() {
    const response = await fetch("/api/google-drive", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json() as GoogleDriveStatus & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Starea Google Drive nu a putut fi încărcată.");
    setStatus(payload);
    onStatusChange(payload);
    return payload;
  }

  useEffect(() => {
    let mounted = true;
    fetch("/api/google-drive", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as GoogleDriveStatus & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Google Drive nu este disponibil momentan.");
        if (mounted) {
          setStatus(payload);
          onStatusChange(payload);
        }
      })
      .catch((failure) => {
        if (mounted) setError(failure instanceof Error ? failure.message : "Google Drive nu este disponibil momentan.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [onStatusChange]);

  async function saveConfiguration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/google-drive", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "configure", clientId: String(values.get("clientId") ?? ""), clientSecret: String(values.get("clientSecret") ?? "") }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Configurarea Google nu a putut fi salvată.");
      formElement.reset();
      await refreshStatus();
      setEditingConfiguration(false);
      onNotify("Configurarea OAuth Google a fost salvată securizat. Autorizează acum contul Google Drive.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Configurarea Google nu a putut fi salvată.");
    } finally {
      setSaving(false);
    }
  }

  async function authorizeGoogle() {
    setAuthorizing(true);
    setError("");
    try {
      const response = await fetch("/api/google-drive", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "authorize" }),
      });
      const payload = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error ?? "Autorizarea Google nu a putut fi pornită.");
      window.location.assign(payload.authorizationUrl);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Autorizarea Google nu a putut fi pornită.");
      setAuthorizing(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/google-drive", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const payload = await response.json() as { projectsSynced?: number; filesSynced?: number; failures?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Sincronizarea nu a putut fi finalizată.");
      await refreshStatus();
      onNotify(payload.failures
        ? `${payload.projectsSynced ?? 0} proiecte sincronizate; ${payload.failures} elemente necesită reîncercare.`
        : `${payload.projectsSynced ?? 0} proiecte și ${payload.filesSynced ?? 0} fișiere sunt disponibile în Google Drive.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sincronizarea nu a putut fi finalizată.");
    } finally {
      setSyncing(false);
    }
  }

  async function copyRedirectUri() {
    if (!status?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(status.redirectUri);
      onNotify("Adresa de redirecționare Google a fost copiată.");
    } catch {
      onNotify("Selectează și copiază manual adresa de redirecționare.");
    }
  }

  const connectionLabel = status?.connected ? "Conectat" : status?.configured ? "Autorizare necesară" : "Configurare necesară";
  const sections = status?.sections ?? {
    project: "01_Documente proiect",
    client: "02_Client",
    route: "03_Traseu FO",
    splices: "04_Suduri FO",
    site: "05_Operatiuni site",
    documents: "06_Documente administrative",
  };
  const activityFolders = status?.activityFolders ?? {
    Instalare: "Instalari",
    "Intervenție": "Interventii",
    "Intervenție Orange": "Interventii Orange",
    Survey: "Survey",
  };
  const activitySections = status?.activitySections ?? {
    Instalare: sections,
    "Intervenție": {
      "intervention-assessment": "01_Constatare",
      "intervention-execution": "02_Executie",
      "intervention-documentation": "03_Documentare",
      project: "04_Documente interventie",
      documents: "05_Documente administrative",
    },
    "Intervenție Orange": {},
  };

  return (
    <div className="page-wrap inner-page drive-settings-page">
      <section className="page-heading compact drive-page-heading">
        <div>
          <p className="eyebrow">INTEGRĂRI ȘI STOCARE</p>
          <h1>Google Drive</h1>
          <p>Organizează separat instalările, intervențiile și activitățile survey.</p>
        </div>
        {status?.connected && (
          <button className="primary-button" onClick={() => void syncNow()} disabled={syncing}>
            <span>{syncing ? "◌" : "↻"}</span> {syncing ? "Se sincronizează..." : "Sincronizează acum"}
          </button>
        )}
      </section>

      <section className="project-card drive-connection-card">
        <div className="drive-connection-overview">
          <span className="drive-provider-icon drive-mark"><i /><i /><i /></span>
          <div className="drive-provider-copy">
            <strong>Google Drive</strong>
            <p>{status?.connected ? status.accountEmail : "Contul Google al companiei"}</p>
          </div>
          <span className={`drive-connection-state ${status?.connected ? "is-connected" : "is-pending"}`}><i />{loading ? "Se verifică..." : connectionLabel}</span>
        </div>

        <div className="drive-connection-details">
          {status?.connected ? (
            <>
              <p>Documentele și fotografiile noi sunt copiate automat dacă Google Drive este selectat ca destinație. Conexiunea poate rămâne activă și când copiile automate sunt oprite.</p>
              <div className="drive-connected-actions">
                <a className="secondary-button drive-root-link" href={status.rootFolderUrl} target="_blank" rel="noreferrer">Deschide dosarul {status.rootFolderName} ↗</a>
                <button className="drive-text-button" onClick={() => void authorizeGoogle()} disabled={authorizing}>{authorizing ? "Se redirecționează..." : "Reconectează contul Google"}</button>
              </div>
            </>
          ) : (
            <>
              <p>{status?.configured ? "Datele OAuth sunt configurate. Alege contul Google al companiei și aprobă accesul la dosarele create de Proconect B2B." : "Adaugă o singură dată datele OAuth Google Cloud, apoi autorizează contul Google Drive al companiei."}</p>
              {status?.configured && <button className="primary-button drive-authorize-button" onClick={() => void authorizeGoogle()} disabled={authorizing}>{authorizing ? "Se deschide Google..." : "Conectează contul Google"} <span>→</span></button>}
            </>
          )}
        </div>
      </section>

      {error && <div className="drive-inline-error" role="alert"><strong>Conectarea necesită atenție</strong><span>{error}</span></div>}

      <section className="drive-sync-metrics" aria-label="Starea sincronizării Google Drive">
        <article><small>LUCRĂRI CU DOSAR DRIVE</small><strong>{status?.projectsSynced ?? 0}<span> / {status?.projectsTotal ?? 0}</span></strong><p>Dosare RID și tichete create</p></article>
        <article><small>FIȘIERE SINCRONIZATE</small><strong>{status?.filesSynced ?? 0}<span> / {status?.filesTotal ?? 0}</span></strong><p>Documente și fotografii</p></article>
        <article><small>ACCES ȘI SECURITATE</small><strong>{status?.connected ? "Activ" : "Protejat"}</strong><p>Date criptate, acces administrativ</p></article>
      </section>

      <div className="drive-settings-layout">
        <section className="project-card drive-config-card">
          <div className="card-heading"><div><h2>Configurare Google Cloud</h2><p>{status?.configured ? "Datele OAuth sunt salvate criptat." : "Configurare inițială, o singură dată."}</p></div>{status?.configured && !editingConfiguration && <button className="drive-text-button" onClick={() => setEditingConfiguration(true)}>Modifică</button>}</div>

          {(!status?.configured || editingConfiguration) ? (
            <form className="drive-config-form" onSubmit={saveConfiguration}>
              <div className="drive-setup-steps">
                <p><b>1</b><span>Activează <strong>Google Drive API</strong> în proiectul Google Cloud al companiei.</span></p>
                <p><b>2</b><span>Creează un client OAuth de tip <strong>Web application</strong>.</span></p>
                <p><b>3</b><span>Adaugă exact această adresă la <strong>Authorized redirect URIs</strong>:</span></p>
              </div>
              <div className="drive-redirect-box"><code>{status?.redirectUri || "Se încarcă adresa..."}</code><button type="button" onClick={() => void copyRedirectUri()}>Copiază</button></div>
              <label><span>OAuth Client ID</span><input name="clientId" required autoComplete="off" spellCheck={false} defaultValue={status?.clientId || ""} placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com" /></label>
              <label><span>OAuth Client Secret</span><input name="clientSecret" type="password" required minLength={8} autoComplete="new-password" placeholder="Introdu secretul Google Cloud" /><small>Secretul este criptat înainte de salvare și nu va mai fi afișat.</small></label>
              {status?.connected && editingConfiguration && <p className="drive-config-warning">Modificarea configurării va necesita reconectarea contului Google.</p>}
              <div className="drive-config-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? "Se salvează securizat..." : "Salvează configurarea"} <span>→</span></button>{editingConfiguration && <button type="button" className="drive-text-button" onClick={() => setEditingConfiguration(false)}>Anulează</button>}</div>
            </form>
          ) : (
            <div className="drive-config-summary"><span>✓</span><div><strong>Client OAuth configurat</strong><p>{status.clientId}</p><small>Client Secret este criptat și nu este disponibil în interfață.</small></div></div>
          )}
        </section>

        <section className="project-card drive-structure-card">
          <div className="card-heading"><div><h2>Structura dosarelor</h2><p>Patru categorii independente, fiecare cu propriile lucrări.</p></div></div>
          <div className="drive-folder-tree">
            <div className="drive-tree-root"><span>▰</span><strong>Proconect B2B</strong></div>
            {Object.entries(activityFolders).map(([activity, folder]) => <div className="drive-activity-tree" key={activity}>
              <div className="drive-tree-project"><span>▰</span><strong>{folder}</strong><small>{activity === "Instalare" ? "Instalări B2B" : activity === "Intervenție" ? "Intervenții tehnice" : activity === "Intervenție Orange" ? "Intervenții Orange" : "Vizite și evaluări"}</small></div>
              <div className="drive-tree-section"><span>▰</span><div><strong>{activity === "Instalare" ? "RID10482" : activity === "Intervenție" ? "INC-10483 · Număr tichet" : activity === "Intervenție Orange" ? "Număr tichet Orange" : "RID + Request ID"}</strong><small>{(activity === "Intervenție" || activity === "Intervenție Orange") ? "Dosarul tichetului" : "Dosarul lucrării"}</small></div></div>
              {Object.entries(activitySections[activity] ?? {}).map(([section, name]) => <div className="drive-tree-section drive-tree-nested" key={section}><span>▰</span><div><strong>{name}</strong><small>{sectionLabels[section] ?? "Documentele lucrării"}</small></div></div>)}
            </div>)}
          </div>
        </section>
      </div>
    </div>
  );
}

