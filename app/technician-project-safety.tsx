"use client";

import { ChangeEvent, useState } from "react";
import { uploadProjectFile } from "./client-storage";
import type { ProjectRecord } from "./project-data";

export type ProjectSafetyStatus = {
  pretask: boolean;
  ppe: boolean;
  completed: boolean;
};

type SafetyCategory = "pretask" | "ppe";

const safetyItems: Record<SafetyCategory, { title: string; description: string; badge: string }> = {
  pretask: {
    title: "Fotografie Pretask",
    description: "Încarcă fotografia formularului Pretask completat pentru această lucrare.",
    badge: "PT",
  },
  ppe: {
    title: "Echipament individual de protecție",
    description: "Fotografia trebuie să arate clar echipamentul individual de protecție folosit.",
    badge: "EIP",
  },
};

export function TechnicianProjectSafety({
  project,
  initialStatus,
  onCancel,
  onComplete,
  onStatusChange,
}: {
  project: ProjectRecord;
  initialStatus: ProjectSafetyStatus;
  onCancel: () => void;
  onComplete: (status: ProjectSafetyStatus) => void;
  onStatusChange: (status: ProjectSafetyStatus) => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [uploading, setUploading] = useState<SafetyCategory | null>(null);
  const [error, setError] = useState("");
  const completedCount = Number(status.pretask) + Number(status.ppe);

  async function upload(category: SafetyCategory, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploading(category);
    setError("");
    try {
      await uploadProjectFile({ projectId: project.id, section: "safety", category, file });
      const next = {
        ...status,
        [category]: true,
        completed: category === "pretask" ? status.ppe : status.pretask,
      };
      setStatus(next);
      onStatusChange(next);
      if (next.completed) onComplete(next);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Fotografia nu a putut fi încărcată.");
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="safety-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="safety-gate-title">
      <section className="safety-gate-card">
        <header className="safety-gate-header">
          <div className="safety-shield" aria-hidden="true">✓</div>
          <div>
            <p className="eyebrow">ACCES ÎN LUCRARE</p>
            <h1 id="safety-gate-title">Verificare Pretask și EIP</h1>
            <p>{project.id} · {project.client}</p>
          </div>
        </header>

        <div className="safety-gate-notice">
          <strong>Lucrarea este momentan blocată</strong>
          <p>Încarcă ambele fotografii înainte de a accesa cerințele și operațiunile din teren. Fiecare fotografie va fi marcată automat cu data, ora și locația GPS.</p>
        </div>

        <div className="safety-gate-progress" aria-live="polite">
          <div><strong>{completedCount}/2 fotografii</strong><span>{status.completed ? "Verificare completă" : "Obligatorii pentru acces"}</span></div>
          <div className="safety-progress-track"><i style={{ width: `${completedCount * 50}%` }} /></div>
        </div>

        <div className="safety-upload-grid">
          {(Object.keys(safetyItems) as SafetyCategory[]).map((category) => {
            const item = safetyItems[category];
            const complete = status[category];
            return (
              <article className={complete ? "safety-upload-card complete" : "safety-upload-card"} key={category}>
                <div className="safety-upload-icon">{complete ? "✓" : item.badge}</div>
                <div><strong>{item.title}</strong><p>{item.description}</p></div>
                <label className={uploading ? "safety-upload-action disabled" : "safety-upload-action"}>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={Boolean(uploading) || complete}
                    onChange={(event) => void upload(category, event)}
                  />
                  {complete ? "Încărcată" : uploading === category ? "Se încarcă..." : "Fă fotografia"}
                </label>
              </article>
            );
          })}
        </div>

        {error && <div className="safety-gate-error" role="alert">{error}</div>}

        <footer className="safety-gate-footer">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={Boolean(uploading)}>Revino la lista lucrărilor</button>
          <small>Nu există opțiune de omitere. Accesul se activează automat după încărcarea ambelor fotografii.</small>
        </footer>
      </section>
    </div>
  );
}
