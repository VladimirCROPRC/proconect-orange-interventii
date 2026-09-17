"use client";

import { useEffect, useState, type FormEvent } from "react";
import { deleteProjectFile, fetchProjectFiles, formatCapturedAt, uploadProjectFile, type StoredProjectFile } from "./client-storage";
import { InterventionExecutionSection } from "./intervention-execution";
import { DamageLocationPicker } from "./damage-location-picker";
import { orangeMaterials, proconectMaterials } from "./orange-materials";
import { orangeServicePackages } from "./orange-services";
import type { InterventionCause, InterventionDamageType, InterventionExecutionActivity, InterventionFieldSummary, InterventionMaterialSelection } from "./field-documentation";
import type { ProjectRecord } from "./project-data";

type InterventionSection = "assessment" | "execution" | "documentation";

type InterventionOperationsProps = {
  project: ProjectRecord;
  section: InterventionSection;
  initialSummary?: InterventionFieldSummary;
  driveFolderUrl?: string;
  canEdit: boolean;
  onEdit: () => void;
  onSectionChange: (section: InterventionSection) => void;
  onNotify: (message: string) => void;
  onSaved: (summary: InterventionFieldSummary) => Promise<void>;
};

const sectionTitles: Record<InterventionSection, string> = {
  assessment: "Constatare",
  execution: "Execuție",
  documentation: "Documentare",
};

const interventionActivityLabels: Record<InterventionExecutionActivity["type"], string> = {
  "fo-installation": "Instalare cablu FO",
  "junction-installation": "Instalare joncțiune nouă",
  "chamber-installation": "Instalare cameretă",
  diagnostics: "Îndreptare cablu la cald",
  "splice-repair": "Refacere sudură",
};

function interventionJunctionReportLabel(
  junction: InterventionExecutionActivity["junction"],
  fallback: string,
) {
  if (!junction) return fallback;
  const label = junction.documented
    ? junction.code
    : junction.kind === "new"
      ? "joncțiune nouă"
      : junction.kind === "existing"
        ? "joncțiune existentă nedocumentată"
        : "joncțiune nedocumentată";
  const coordinates = !junction.documented && (junction.kind === "new" || junction.kind === "existing")
    ? ` · Coordonate: ${junction.lat.toFixed(6)}, ${junction.lon.toFixed(6)}`
    : "";
  return `${label}${coordinates}`;
}

function interventionActivityDescription(activity: InterventionExecutionActivity) {
  const label = interventionActivityLabels[activity.type];
  if (activity.type === "fo-installation") {
    const endpointA = interventionJunctionReportLabel(activity.endpointA, "joncțiunea A");
    const endpointB = interventionJunctionReportLabel(activity.endpointB, "joncțiunea B");
    return `${label}: ${activity.cableType ?? "cablu FO"}, ${activity.cableLengthMeters ?? 0} m, între ${endpointA} și ${endpointB}.`;
  }
  const junction = activity.type === "chamber-installation"
    ? interventionJunctionReportLabel(activity.junction, "cameretă nouă").replace(/^joncțiune nouă/, "cameretă nouă")
    : activity.type === "diagnostics"
      ? interventionJunctionReportLabel(activity.junction, "punct îndreptare cablu la cald").replace(/^joncțiune (nouă|existentă nedocumentată|nedocumentată)/, "punct îndreptare cablu la cald")
      : activity.type === "splice-repair"
        ? interventionJunctionReportLabel(activity.junction, "punct refacere sudură").replace(/^joncțiune (nouă|existentă nedocumentată|nedocumentată)/, "punct refacere sudură")
        : interventionJunctionReportLabel(activity.junction, "joncțiune nedocumentată");
  const network = activity.junction?.network === "mobile"
    ? " · Orange Mobil"
    : activity.junction?.network === "fixed"
      ? " · Orange Fixed"
      : "";
  return `${label}: ${junction}${network}.`;
}

function buildInterventionReport(project: ProjectRecord, summary?: InterventionFieldSummary) {
  const activities = summary?.execution?.activities ?? [];
  const activityLines = activities.length
    ? activities.map((activity, index) => `${index + 1}. ${interventionActivityDescription(activity)}`)
    : ["Activitățile de execuție nu au fost documentate încă."];
  const executionPhotos = activities.reduce((total, activity) => total + activity.photoCount, 0);
  const materials = summary?.execution?.materials ?? [];
  const materialLines = materials.map((material) => `${material.source === "orange" ? "Orange" : "Proconect"}: ${material.code} · ${material.description} · ${material.quantity} ${material.unit}`);

  return [
    `Tichet: ${project.id}`,
    `Client: ${project.client}`,
    `Locație: ${project.address}`,
    `Tehnician: ${project.technician}`,
    `Avarie constatată: ${summary?.assessment?.damageType ?? "Necompletată"}.`,
    ...(summary?.assessment?.cause ? [`Cauză: ${summary.assessment.cause}.`] : []),
    ...(summary?.assessment?.damageLocation ? [`Locația avariei: ${summary.assessment.damageLocation.lat.toFixed(6)}, ${summary.assessment.damageLocation.lon.toFixed(6)}.`] : []),
    ...(summary?.assessment?.siteMeasurement ? [`Măsurătoare site ${summary.assessment.siteMeasurement.siteCode}: OTDR ${summary.assessment.siteMeasurement.otdrLengthMeters} m, ${summary.assessment.siteMeasurement.photoCount} foto.`] : []),
    "Operațiuni efectuate:",
    ...activityLines,
    ...(materialLines.length ? ["Materiale utilizate:", ...materialLines] : []),
    `Documentare foto: ${summary?.assessment?.geotaggedPhotoCount ?? 0} fotografii constatare și ${executionPhotos} fotografii execuție.`,
  ].join("\n");
}

function validPhotoCoordinates(value: string) {
  const coordinates = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s|$)/.exec(value.trim());
  if (!coordinates) return false;
  const latitude = Number(coordinates[1]);
  const longitude = Number(coordinates[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

async function currentPhotoLocation() {
  if (!window.isSecureContext || !navigator.geolocation) {
    throw new Error("Fotografiile intervenției necesită un dispozitiv și o conexiune cu acces GPS.");
  }

  return new Promise<string>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve(`${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} · ±${Math.round(coords.accuracy)} m`);
      },
      (failure) => {
        reject(new Error(
          failure.code === failure.PERMISSION_DENIED
            ? "Permite accesul la locație pentru a încărca fotografiile intervenției."
            : failure.code === failure.TIMEOUT
              ? "Localizarea GPS a durat prea mult. Activează locația și încearcă din nou."
              : "Poziția GPS nu a putut fi determinată. Verifică localizarea dispozitivului.",
        ));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
    );
  });
}

export function InterventionOperationsSection({
  project,
  section,
  initialSummary,
  driveFolderUrl,
  canEdit,
  onEdit,
  onSectionChange,
  onNotify,
  onSaved,
}: InterventionOperationsProps) {
  const [damageType, setDamageType] = useState<InterventionDamageType | "">(initialSummary?.assessment?.damageType ?? "");
  const [cause, setCause] = useState<InterventionCause | "">(initialSummary?.assessment?.cause ?? "");
  const [arrivedAt, setArrivedAt] = useState(initialSummary?.assessment?.arrivedAt);
  const [incidentDescription, setIncidentDescription] = useState(initialSummary?.assessment?.incidentDescription ?? "");
  const [damageLocation, setDamageLocation] = useState(initialSummary?.assessment?.damageLocation);
  const [siteMeasurementEnabled, setSiteMeasurementEnabled] = useState(Boolean(initialSummary?.assessment?.siteMeasurement));
  const [siteMeasurementCode, setSiteMeasurementCode] = useState(initialSummary?.assessment?.siteMeasurement?.siteCode ?? "");
  const [siteMeasurementLength, setSiteMeasurementLength] = useState(initialSummary?.assessment?.siteMeasurement?.otdrLengthMeters?.toString() ?? "");
  const [photos, setPhotos] = useState<StoredProjectFile[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(() => initialSummary?.documentation?.report ?? buildInterventionReport(project, initialSummary));
  const [reviewIncident, setReviewIncident] = useState(initialSummary?.documentation?.incidentDescription ?? initialSummary?.assessment?.incidentDescription ?? "");
  const [reviewRemediation, setReviewRemediation] = useState(initialSummary?.documentation?.remediationDescription ?? initialSummary?.execution?.remediationDescription ?? "");
  const [reviewMaterials, setReviewMaterials] = useState<InterventionMaterialSelection[]>(initialSummary?.execution?.materials ?? []);
  const [reviewMaterialKey, setReviewMaterialKey] = useState("");
  const [reviewMaterialQuantity, setReviewMaterialQuantity] = useState("");
  const [reviewServices, setReviewServices] = useState(initialSummary?.documentation?.services ?? []);
  const [serviceCode, setServiceCode] = useState("");
  const [serviceQuantity, setServiceQuantity] = useState("1");

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setDamageType(initialSummary?.assessment?.damageType ?? "");
      setCause(initialSummary?.assessment?.cause ?? "");
      setArrivedAt(initialSummary?.assessment?.arrivedAt);
      setIncidentDescription(initialSummary?.assessment?.incidentDescription ?? "");
      setDamageLocation(initialSummary?.assessment?.damageLocation);
      setSiteMeasurementEnabled(Boolean(initialSummary?.assessment?.siteMeasurement));
      setSiteMeasurementCode(initialSummary?.assessment?.siteMeasurement?.siteCode ?? "");
      setSiteMeasurementLength(initialSummary?.assessment?.siteMeasurement?.otdrLengthMeters?.toString() ?? "");
      setPhotos([]);
      setLoadingPhotos(true);
      setError("");
    });

    fetchProjectFiles(project.id, "intervention-assessment")
      .then((assessmentPhotos) => {
        if (mounted) setPhotos(assessmentPhotos);
      })
      .catch((failure) => {
        if (mounted) setError(failure instanceof Error ? failure.message : "Fotografiile intervenției nu au putut fi încărcate.");
      })
      .finally(() => {
        if (mounted) setLoadingPhotos(false);
      });

    return () => {
      mounted = false;
    };
  }, [project.id, initialSummary?.assessment?.damageType, initialSummary?.assessment?.cause, initialSummary?.assessment?.damageLocation]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) setReport(initialSummary?.documentation?.report ?? buildInterventionReport(project, initialSummary));
      if (mounted) setReviewIncident(initialSummary?.documentation?.incidentDescription ?? initialSummary?.assessment?.incidentDescription ?? "");
      if (mounted) setReviewRemediation(initialSummary?.documentation?.remediationDescription ?? initialSummary?.execution?.remediationDescription ?? "");
      if (mounted) setReviewMaterials(initialSummary?.execution?.materials ?? []);
      if (mounted) setReviewServices(initialSummary?.documentation?.services ?? []);
    });
    return () => {
      mounted = false;
    };
  }, [project, initialSummary]);

  const damagePhotos = photos.filter((photo) => photo.category === "damage");
  const validPhotos = damagePhotos.filter((photo) => validPhotoCoordinates(photo.geo));
  const siteMeasurementPhotos = photos.filter((photo) => photo.category === "site-measurement");
  const validSiteMeasurementPhotos = siteMeasurementPhotos.filter((photo) => validPhotoCoordinates(photo.geo));
  const siteMeasurementLengthMeters = Number(siteMeasurementLength);
  const siteMeasurementReady = !siteMeasurementEnabled || Boolean(siteMeasurementCode.trim())
    && Number.isFinite(siteMeasurementLengthMeters) && siteMeasurementLengthMeters > 0
    && validSiteMeasurementPhotos.length > 0;
  const orangeIntervention = project.activityType === "Intervenție Orange";
  const completedItems = Number(Boolean(damageType)) + Number(validPhotos.length > 0) + Number(!orangeIntervention || Boolean(damageLocation)) + Number(!orangeIntervention || Boolean(cause));
  const progress = Math.round((completedItems / (orangeIntervention ? 4 : 2)) * 100);
  const ready = Boolean(damageType) && Boolean(arrivedAt) && Boolean(incidentDescription.trim()) && validPhotos.length > 0 && siteMeasurementReady && (!orangeIntervention || (Boolean(cause) && Boolean(damageLocation)));
  const executionActivities = initialSummary?.execution?.activities ?? [];
  const totalExecutionPhotos = executionActivities.reduce((total, activity) => total + activity.photoCount, 0);
  const totalCableMeters = executionActivities.reduce((total, activity) => total + (activity.type === "fo-installation" ? activity.cableLengthMeters ?? 0 : 0), 0);
  const reportReady = report.trim().length >= 20 && report.trim().length <= 5_000;
  const canFinalize = Boolean(canEdit && initialSummary?.assessment && executionActivities.length && reportReady && project.status !== "Finalizat");

  async function addPhotos(selectedFiles: File[], category: "damage" | "site-measurement" = "damage") {
    if (!selectedFiles.length) return;

    setUploading(true);
    setError("");
    try {
      const geo = await currentPhotoLocation();
      for (const file of selectedFiles) {
        const saved = await uploadProjectFile({
          projectId: project.id,
          section: "intervention-assessment",
          category,
          file,
          geo,
        });
        setPhotos((current) => [...current, saved]);
      }
      onNotify(category === "site-measurement"
        ? "Fotografia măsurătorii OTDR a fost salvată cu poziția GPS."
        : selectedFiles.length === 1
          ? "Fotografia avariei a fost salvată cu poziția GPS."
          : `${selectedFiles.length} fotografii ale avariei au fost salvate cu poziția GPS.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Fotografiile intervenției nu au putut fi încărcate.");
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photo: StoredProjectFile) {
    setRemovingId(photo.id);
    setError("");
    try {
      await deleteProjectFile(photo.id);
      setPhotos((current) => current.filter((item) => item.id !== photo.id));
      onNotify("Fotografia intervenției a fost ștearsă.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Fotografia nu a putut fi ștearsă.");
    } finally {
      setRemovingId("");
    }
  }

  async function saveAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!damageType || !arrivedAt || !incidentDescription.trim() || !validPhotos.length || !siteMeasurementReady || (orangeIntervention && (!cause || !damageLocation))) {
      setError(!siteMeasurementReady
        ? "Completează codul site-ului, lungimea OTDR și fotografia măsurătorii cu GPS valid."
        : orangeIntervention ? "Selectează tipul și cauza avariei, amplasează locația pe hartă și adaugă cel puțin o fotografie cu GPS valid." : "Selectează tipul avariei și adaugă cel puțin o fotografie cu GPS valid.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSaved({
        ...initialSummary,
        assessment: {
          damageType,
          ...(cause ? { cause } : {}),
          ...(arrivedAt ? { arrivedAt } : {}),
          incidentDescription: incidentDescription.trim(),
          ...(damageLocation ? { damageLocation } : {}),
          ...(siteMeasurementEnabled ? { siteMeasurement: {
            siteCode: siteMeasurementCode.trim().toLocaleUpperCase("ro-RO"),
            otdrLengthMeters: siteMeasurementLengthMeters,
            photoCount: siteMeasurementPhotos.length,
          } } : {}),
          photoCount: damagePhotos.length,
          geotaggedPhotoCount: validPhotos.length,
          documentedAt: Date.now(),
        },
      });
      onNotify(`Constatarea intervenției ${project.id} a fost salvată.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Constatarea intervenției nu a putut fi salvată.");
    } finally {
      setSaving(false);
    }
  }

  async function closeIntervention() {
    if (!canFinalize || !initialSummary?.assessment) {
      setError("Completează constatarea, cel puțin o activitate de execuție și raportul intervenției.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await onSaved({
        ...initialSummary,
        execution: initialSummary.execution ? { ...initialSummary.execution, materials: reviewMaterials } : initialSummary.execution,
        documentation: {
          report: report.trim(),
          incidentDescription: reviewIncident.trim(),
          remediationDescription: reviewRemediation.trim(),
          services: reviewServices,
          validatedAt: 0,
          validatedBy: "",
        },
      });
      onNotify(`Intervenția ${project.id} a fost validată și închisă.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Intervenția nu a putut fi validată și închisă.");
    } finally {
      setSaving(false);
    }
  }

  function addReviewedMaterial() {
    const [source, code] = reviewMaterialKey.split(":") as ["orange" | "proconect", string];
    const catalog = source === "orange" ? orangeMaterials : proconectMaterials;
    const item = catalog.find((entry) => entry.code === code);
    const quantity = Number(reviewMaterialQuantity.replace(",", "."));
    if (!item || !Number.isFinite(quantity) || quantity <= 0) return;
    setReviewMaterials((current) => [...current.filter((entry) => !(entry.source === source && entry.code === code)), { source, code, description: item.description, unit: item.unit, quantity }]);
    setReviewMaterialKey("");
    setReviewMaterialQuantity("");
  }

  function addReviewedService() {
    const service = orangeServicePackages.find((item) => item.code === serviceCode);
    const quantity = Number(serviceQuantity.replace(",", "."));
    if (!service || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return;
    if (service.mainPackage) {
      const otherMainPackage = reviewServices.find((selection) => selection.code !== service.code && orangeServicePackages.find((item) => item.code === selection.code)?.mainPackage);
      if (otherMainPackage) {
        onNotify("Poți selecta un singur pachet principal SP/CR.");
        return;
      }
    }
    setReviewServices((current) => [...current.filter((item) => item.code !== service.code), { code: service.code, quantity }]);
    setServiceCode("");
    setServiceQuantity("1");
  }

  async function downloadKmz() {
    const response = await fetch(`/api/reports?${new URLSearchParams({ projectId: project.id, format: "kmz" })}`, { credentials: "same-origin" });
    if (!response.ok) {
      onNotify("Fișierul KMZ nu a putut fi generat.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.id}.kmz`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-wrap inner-page activity-workspace-page intervention-page">
      <section className="page-heading compact">
        <div>
          <p className="eyebrow">INTERVENȚII TEHNICE</p>
          <h1>{sectionTitles[section]}</h1>
          <p>{project.id} · {project.client}</p>
        </div>
        {canEdit && <button className="primary-button" onClick={onEdit}>Editează lucrarea <span>→</span></button>}
      </section>

      <nav className={`intervention-stage-nav${canEdit ? "" : " technician-stages"}`} aria-label="Etapele intervenției">
        <button type="button" className={section === "assessment" ? "active" : ""} onClick={() => onSectionChange("assessment")}>
          <span>1</span><div><strong>Constatare</strong><small>Avarie și fotografii inițiale</small></div>
        </button>
        <button type="button" className={section === "execution" ? "active" : ""} onClick={() => onSectionChange("execution")}>
          <span>2</span><div><strong>Execuție</strong><small>{orangeIntervention ? "Activități și hartă fără puncte preîncărcate" : "Activități și hartă OrangeNetwork"}</small></div>
        </button>
        {canEdit && <button type="button" className={section === "documentation" ? "active" : ""} onClick={() => onSectionChange("documentation")}>
          <span>3</span><div><strong>Documentare</strong><small>Validare administrativă</small></div>
        </button>}
      </nav>

      <div className="activity-workspace-grid intervention-brief-grid">
        <section className="project-card activity-brief-card">
          <div className="card-heading"><div><h2>Cerințele intervenției</h2><p>Informațiile transmise tehnicianului pentru această lucrare.</p></div></div>
          <div className="activity-brief-content"><p>{project.requirements}</p></div>
          <div className="activity-contact-grid">
            {orangeIntervention ? <><div><small>COD SITE A</small><strong>{project.client}</strong></div><div><small>COD SITE B</small><strong>{project.address || "Nu este specificat"}</strong></div></> : <><div><small>LOCAȚIE</small><strong>{project.address}</strong></div><div><small>PERSOANĂ DE CONTACT</small><strong>{project.contact}</strong><span>{project.phone}</span></div></>}
          </div>
        </section>

        <aside className="project-card activity-assignment-card">
          <div className="card-heading"><div><h2>Alocare</h2><p>Intervenția activă.</p></div></div>
          <div className="activity-assignment-content">
            <div><small>TEHNICIAN</small><strong>{project.technician}</strong></div>
            <div><small>PROGRAMARE</small><strong>{project.date || "Neprogramată"}</strong></div>
            <div><small>STATUS</small><strong>{project.status}</strong></div>
            {driveFolderUrl && <a href={driveFolderUrl} target="_blank" rel="noreferrer">Deschide dosarul Google Drive ↗</a>}
          </div>
        </aside>
      </div>

      {section === "assessment" ? (
        <form className="intervention-section-layout" onSubmit={saveAssessment}>
          <section className="project-card intervention-assessment-card">
            <div className="card-heading"><div><h2>Constatare avarie</h2><p>Identifică avaria și documentează situația găsită în teren.</p></div></div>

            <div className="intervention-assessment-content">
              <div style={{ order: -3 }}>
                <button className="primary-button" type="button" disabled={Boolean(arrivedAt)} onClick={() => {
                  const timestamp = Date.now();
                  setArrivedAt(timestamp);
                  onNotify("Ora sosirii în zona avariei a fost înregistrată. Salvează constatarea pentru confirmare.");
                }}>{arrivedAt ? `Ajuns în zonă · ${formatCapturedAt(arrivedAt)}` : "Am ajuns în zona avariei"}</button>
              </div>
              <label className="intervention-damage-field">
                <span>Tipul avariei <b>OBLIGATORIU</b></span>
                <select value={damageType} onChange={(event) => setDamageType(event.target.value as InterventionDamageType | "")} required>
                  <option value="">Selectează tipul avariei</option>
                  <option value="FO cut">FO cut</option>
                  <option value="Atenuare">Atenuare</option>
                  <option value="Echipament">Echipament</option>
                </select>
                <small>Alege categoria care descrie natura problemei constatate.</small>
              </label>

              {orangeIntervention && (
                <label className="intervention-damage-field">
                  <span>Cauza avariei <b>OBLIGATORIU</b></span>
                  <select value={cause} onChange={(event) => setCause(event.target.value as InterventionCause | "")} required>
                    <option value="">Selectează cauza</option>
                    <option value="Accident-Orice tip de accident (masina,etc.)">Accident-Orice tip de accident (masina,etc.)</option>
                    <option value="Clima-Alunecari de teren, viituri, furtuna, etc…">Clima-Alunecari de teren, viituri, furtuna, etc…</option>
                    <option value="Defect-Defect cablu/cutie jonctiune, etc,…">Defect-Defect cablu/cutie jonctiune, etc,…</option>
                    <option value="Lucrari infrastructura-Lucrari efectuate de companiile nationale">Lucrari infrastructura-Lucrari efectuate de companiile nationale</option>
                    <option value="Lucrari civile-Lucrari efectuate de persoane fizice">Lucrari civile-Lucrari efectuate de persoane fizice</option>
                    <option value="Primarie-Decizii primarie de a taia cablul">Primarie-Decizii primarie de a taia cablul</option>
                    <option value="Vandalism-Furt">Vandalism-Furt</option>
                  </select>
                  <small>Alege cauza constatată în teren.</small>
                </label>
              )}

              {orangeIntervention && <DamageLocationPicker value={damageLocation} onChange={(location) => setDamageLocation({ ...location, placedAt: Date.now() })} onNotify={onNotify} />}

              <div className="intervention-photo-heading">
                <div><h3>Fotografii constatare</h3><p>Imagini clare din care reiese natura avariei.</p></div>
                <span>{validPhotos.length} {validPhotos.length === 1 ? "poză GPS" : "poze GPS"}</span>
              </div>

              <label className={`intervention-photo-upload${uploading ? " is-uploading" : ""}`}>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  disabled={uploading}
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    event.currentTarget.value = "";
                    void addPhotos(selectedFiles);
                  }}
                />
                <span className="intervention-upload-icon">⌖</span>
                <strong>{uploading ? "Se identifică poziția și se încarcă..." : "Adaugă fotografii cu GPS"}</strong>
                <small>Accesul la locația dispozitivului este obligatoriu.</small>
              </label>

              {loadingPhotos && <p className="intervention-loading">Se verifică fotografiile salvate...</p>}

              {damagePhotos.length > 0 && <div className="intervention-photo-grid">
                {damagePhotos.map((photo) => <article className="intervention-photo-item" key={photo.id}>
                  <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Deschide fotografia ${photo.name}`}>
                    <img src={photo.url} alt={`Constatare avarie: ${photo.name}`} loading="lazy" />
                  </a>
                  <div className="intervention-photo-meta"><strong>{photo.name}</strong><span>⌖ {photo.geo}</span><small>{formatCapturedAt(photo.capturedAt)}</small></div>
                  <button type="button" onClick={() => void removePhoto(photo)} disabled={removingId === photo.id} aria-label={`Șterge fotografia ${photo.name}`}>{removingId === photo.id ? "..." : "Șterge"}</button>
                </article>)}
              </div>}

              <div className="intervention-site-measurement" style={{ order: -2 }}><label className="intervention-damage-field">
                <span>Măsurătoare site <b>DACĂ ESTE CAZUL</b></span>
                <select value={siteMeasurementEnabled ? "yes" : "no"} onChange={(event) => setSiteMeasurementEnabled(event.target.value === "yes")}>
                  <option value="no">Nu este cazul</option>
                  <option value="yes">Da, există măsurătoare OTDR</option>
                </select>
                <small>Activează numai dacă s-a efectuat o măsurătoare din site.</small>
              </label>

              {siteMeasurementEnabled && <>
                <label className="intervention-damage-field">
                  <span>Cod site <b>OBLIGATORIU</b></span>
                  <input value={siteMeasurementCode} maxLength={50} onChange={(event) => setSiteMeasurementCode(event.target.value)} placeholder="ex. CJ0123" required />
                </label>
                <label className="intervention-damage-field">
                  <span>Lungime măsurătoare OTDR (m) <b>OBLIGATORIU</b></span>
                  <input type="number" min="0.01" max="1000000" step="0.01" value={siteMeasurementLength} onChange={(event) => setSiteMeasurementLength(event.target.value)} placeholder="ex. 1250" required />
                </label>
                <div className="intervention-photo-heading">
                  <div><h3>Fotografie măsurătoare site</h3><p>Fotografia ecranului sau rezultatului OTDR, cu poziție GPS.</p></div>
                  <span>{validSiteMeasurementPhotos.length} {validSiteMeasurementPhotos.length === 1 ? "poză GPS" : "poze GPS"}</span>
                </div>
                <label className={`intervention-photo-upload${uploading ? " is-uploading" : ""}`}>
                  <input type="file" accept="image/*" capture="environment" disabled={uploading} onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    event.currentTarget.value = "";
                    void addPhotos(selectedFiles, "site-measurement");
                  }} />
                  <span className="intervention-upload-icon">⌖</span>
                  <strong>{uploading ? "Se încarcă..." : "Adaugă fotografia OTDR"}</strong>
                  <small>Este necesară cel puțin o fotografie cu GPS valid.</small>
                </label>
                {siteMeasurementPhotos.length > 0 && <div className="intervention-photo-grid">
                  {siteMeasurementPhotos.map((photo) => <article className="intervention-photo-item" key={photo.id}>
                    <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={`Măsurătoare OTDR: ${photo.name}`} loading="lazy" /></a>
                    <div className="intervention-photo-meta"><strong>{photo.name}</strong><span>⌖ {photo.geo}</span><small>{formatCapturedAt(photo.capturedAt)}</small></div>
                    <button type="button" onClick={() => void removePhoto(photo)} disabled={removingId === photo.id}>{removingId === photo.id ? "..." : "Șterge"}</button>
                  </article>)}
                </div>}
              </>}
              </div>

              <label className="intervention-damage-field">
                <span>Descriere incident <b>OBLIGATORIU</b></span>
                <textarea value={incidentDescription} maxLength={2000} rows={5} onChange={(event) => setIncidentDescription(event.target.value)} placeholder="Descrie situația constatată în teren" required />
                <small>Coordonatorul va putea verifica și edita acest text înainte de validarea QAF.</small>
              </label>

              {error && <p className="intervention-error" role="alert">{error}</p>}
            </div>
          </section>

          <aside className="client-summary intervention-summary">
            <div className="summary-title"><span>✓</span><div><h2>Validare constatare</h2><p>{project.id} · Intervenție</p></div></div>
            <div className="summary-progress"><div><span>Progres</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>
            <div className="summary-checklist">
              <div className={damageType ? "done" : ""}><span>{damageType ? "✓" : "○"}</span><p><strong>Tipul avariei</strong><small>{damageType || "În așteptare"}</small></p></div>
              {orangeIntervention && <div className={cause ? "done" : ""}><span>{cause ? "✓" : "○"}</span><p><strong>Cauza avariei</strong><small>{cause || "Selectează cauza"}</small></p></div>}
              {orangeIntervention && <div className={damageLocation ? "done" : ""}><span>{damageLocation ? "✓" : "○"}</span><p><strong>Locația avariei</strong><small>{damageLocation ? `${damageLocation.lat.toFixed(6)}, ${damageLocation.lon.toFixed(6)}` : "Amplasează punctul pe hartă"}</small></p></div>}
              <div className={validPhotos.length ? "done" : ""}><span>{validPhotos.length ? "✓" : "○"}</span><p><strong>Fotografii geotagate</strong><small>{validPhotos.length ? `${validPhotos.length} ${validPhotos.length === 1 ? "fotografie cu GPS valid" : "fotografii cu GPS valid"}` : "Minimum o fotografie obligatorie"}</small></p></div>
            </div>
            <div className="geo-notice"><span>⌖</span><p><strong>GPS, dată și oră obligatorii</strong>Fotografiile sunt marcate direct cu poziția, data și ora constatării.</p></div>
            {initialSummary?.assessment?.documentedAt && <p className="intervention-saved-note">Salvată: {formatCapturedAt(initialSummary.assessment.documentedAt)}</p>}
            <button className="primary-button submit-documentation" type="submit" disabled={!ready || saving || uploading || loadingPhotos}>{saving ? "Se salvează..." : "Salvează constatarea"} <span>→</span></button>
          </aside>
        </form>
      ) : section === "execution" ? (
        <InterventionExecutionSection project={project} initialSummary={initialSummary} onNotify={onNotify} onSaved={onSaved} blankMap={orangeIntervention} />
      ) : canEdit ? (
        <div className="intervention-documentation-layout">
          <section className="project-card intervention-report-card">
            <div className="card-heading"><div><h2>Raport scurt al intervenției</h2><p>Generat din constatare și operațiunile realizate în teren.</p></div></div>

            <div className="intervention-report-body">
              <div className="intervention-report-metrics">
                <article><small>TIP AVARIE</small><strong>{initialSummary?.assessment?.damageType ?? "Necompletat"}</strong></article>
                <article><small>ACTIVITĂȚI</small><strong>{executionActivities.length}</strong></article>
                <article><small>FOTOGRAFII GPS</small><strong>{(initialSummary?.assessment?.geotaggedPhotoCount ?? 0) + totalExecutionPhotos}</strong></article>
                <article><small>CABLU FO</small><strong>{totalCableMeters.toLocaleString("ro-RO")} m</strong></article>
              </div>

              <div className="intervention-report-heading">
                <div><strong>Conținut raport</strong><small>Poți ajusta textul înainte de validare.</small></div>
                {project.status !== "Finalizat" && <button type="button" onClick={() => setReport(buildInterventionReport(project, initialSummary))}>Regenerează</button>}
              </div>

              <textarea
                className="intervention-report-textarea"
                value={report}
                onChange={(event) => setReport(event.target.value)}
                maxLength={5_000}
                rows={11}
                readOnly={project.status === "Finalizat"}
                aria-label="Raportul intervenției"
              />
              <p className="intervention-report-counter">{report.trim().length.toLocaleString("ro-RO")} / 5.000 caractere</p>

              <label className="intervention-damage-field"><span>Descriere incident validată</span><textarea rows={5} maxLength={2000} value={reviewIncident} onChange={(event) => setReviewIncident(event.target.value)} /></label>
              <label className="intervention-damage-field"><span>Descriere remediere validată</span><textarea rows={5} maxLength={2000} value={reviewRemediation} onChange={(event) => setReviewRemediation(event.target.value)} /></label>

              <div className="card-heading"><div><h2>Materiale validate</h2><p>Coordonatorul poate corecta lista înainte de generarea QAF.</p></div></div>
              <label className="intervention-damage-field"><span>Material</span><select value={reviewMaterialKey} onChange={(event) => setReviewMaterialKey(event.target.value)}><option value="">Selectează</option><optgroup label="Orange">{orangeMaterials.map((item) => <option key={`orange:${item.code}`} value={`orange:${item.code}`}>{item.code} · {item.description}</option>)}</optgroup><optgroup label="Proconect">{proconectMaterials.map((item) => <option key={`proconect:${item.code}`} value={`proconect:${item.code}`}>{item.code} · {item.description}</option>)}</optgroup></select></label>
              <label className="intervention-damage-field"><span>Cantitate</span><input type="number" min="0.01" step="0.01" value={reviewMaterialQuantity} onChange={(event) => setReviewMaterialQuantity(event.target.value)} /></label>
              <button type="button" className="secondary-button" onClick={addReviewedMaterial}>Adaugă / actualizează materialul</button>
              {reviewMaterials.map((item) => <div className="intervention-records-list" key={`${item.source}:${item.code}`}><article><span>{item.source === "orange" ? "OR" : "PC"}</span><div><strong>{item.code} · {item.description}</strong></div><b>{item.quantity} {item.unit}</b><button type="button" className="record-delete-button" onClick={() => setReviewMaterials((current) => current.filter((entry) => entry !== item))}>Șterge</button></article></div>)}

              <div className="card-heading"><div><h2>Servicii QAF</h2><p>Lista completă din foaia Services. Se poate selecta maximum un pachet principal SP/CR.</p></div></div>
              <label className="intervention-damage-field"><span>Serviciu</span><select value={serviceCode} onChange={(event) => setServiceCode(event.target.value)}><option value="">Selectează serviciul</option>{orangeServicePackages.map((service) => <option key={service.code} value={service.code}>{service.code} · {service.description} · {service.unit}</option>)}</select></label>
              <label className="intervention-damage-field"><span>Cantitate</span><input type="number" min="0.01" max="1000000" step="0.01" value={serviceQuantity} onChange={(event) => setServiceQuantity(event.target.value)} /></label>
              <button type="button" className="secondary-button" onClick={addReviewedService}>Adaugă / actualizează serviciul</button>
              {reviewServices.map((selection) => { const service = orangeServicePackages.find((item) => item.code === selection.code); return <div className="intervention-records-list" key={selection.code}><article><span>SV</span><div><strong>{selection.code}</strong><small>{service?.description ?? "Serviciu QAF"}</small></div><b>{selection.quantity} {service?.unit ?? ""}</b><button type="button" className="record-delete-button" onClick={() => setReviewServices((current) => current.filter((item) => item.code !== selection.code))}>Șterge</button></article></div>; })}
              <button type="button" className="secondary-button" onClick={() => void downloadKmz()}>Generează KMZ</button>

              {executionActivities.length > 0 && <div className="intervention-report-activities">
                <h3>Operațiuni incluse</h3>
                {executionActivities.map((activity) => <article key={activity.id}><span>✓</span><div><strong>{interventionActivityLabels[activity.type]}</strong><small>{interventionActivityDescription(activity)}</small></div><b>{activity.photoCount} foto GPS</b></article>)}
              </div>}

              {error && <p className="intervention-error" role="alert">{error}</p>}
            </div>
          </section>

          <aside className="client-summary intervention-summary intervention-closure-summary">
            <div className="summary-title"><span>✓</span><div><h2>Validare și închidere</h2><p>{project.id} · Acces administrativ</p></div></div>
            <div className="summary-checklist">
              <div className={initialSummary?.assessment ? "done" : ""}><span>{initialSummary?.assessment ? "✓" : "○"}</span><p><strong>Constatare completată</strong><small>{initialSummary?.assessment?.damageType ?? "Tipul avariei și fotografiile lipsesc"}</small></p></div>
              <div className={executionActivities.length ? "done" : ""}><span>{executionActivities.length ? "✓" : "○"}</span><p><strong>Execuție documentată</strong><small>{executionActivities.length ? `${executionActivities.length} ${executionActivities.length === 1 ? "activitate salvată" : "activități salvate"}` : "Minimum o activitate obligatorie"}</small></p></div>
              <div className={reportReady ? "done" : ""}><span>{reportReady ? "✓" : "○"}</span><p><strong>Raport pregătit</strong><small>{reportReady ? "Raportul intervenției este complet" : "Raportul trebuie să aibă cel puțin 20 de caractere"}</small></p></div>
            </div>

            {initialSummary?.documentation && <p className="intervention-saved-note">Validată de {initialSummary.documentation.validatedBy} · {formatCapturedAt(initialSummary.documentation.validatedAt)}</p>}

            <button className="primary-button submit-documentation" type="button" onClick={() => void closeIntervention()} disabled={!canFinalize || saving}>
              {project.status === "Finalizat" ? "Intervenție închisă" : saving ? "Se validează..." : "Validează și închide"}<span>{project.status === "Finalizat" ? "✓" : "→"}</span>
            </button>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
