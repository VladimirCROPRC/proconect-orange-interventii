"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProjectFieldDocumentation, RouteMethod } from "./field-documentation";
import { fetchProjectFiles, uploadProjectFile, type StoredProjectFile } from "./client-storage";

type DocumentProject = {
  id: string;
  client: string;
  address: string;
  cpe: string;
  sfp: boolean;
  mc: boolean;
  mcType: "" | "100 Mbps" | "1 Gbps" | "JumboFrame";
  terminalBox: boolean;
  splice: string;
};

type ReportDraft = {
  title: string;
  siteLabel: string;
  siteCode: string;
  lec: string;
  site: string;
  route: string;
  client: string;
  materialChambers: string;
  materialPoles: string;
};

type ReferenceCategory = "orangeNetwork" | "mapxtreme";

const referenceReportLines: Record<ReferenceCategory, string> = {
  orangeNetwork: "Nu necesită OrangeNetwork.",
  mapxtreme: "Nu necesită MapXtreme.",
};

type BudgetSuggestion = {
  id: string;
  category: "Manoperă" | "Material";
  catalogPosition: string;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  evidence: string;
  selected: boolean;
};

type Props = {
  project: DocumentProject;
  fieldData: ProjectFieldDocumentation;
  onNotify: (message: string) => void;
};

const routeCatalog: Record<Exclude<RouteMethod, "aerial">, { position: string; name: string; unit: string; price: number }> = {
  duct: { position: "22", name: "Instalare cablu FO în monotub sau canalizație existentă", unit: "km", price: 323 },
  tray: { position: "15", name: "Instalare cablu comunicații prin pat de cablu", unit: "km", price: 480 },
  facade: { position: "10", name: "Pozat FO ADSS pe fațade de clădiri", unit: "km", price: 430 },
};

const materialCatalog = {
  boat: { position: "M2", name: "Accesoriu instalare cablu FO ADSS «Bărcuță»", price: 0.53 },
  stainlessClamp: { position: "M3", name: "Accesoriu instalare cablu FO ADSS «Colier tablă inox»", price: 0.39 },
  hook: { position: "M4", name: "Accesoriu instalare cablu FO ADSS «Cârlig»", price: 0.31 },
  armorod: { position: "M5", name: "Accesoriu instalare cablu FO ADSS «Armorod»", price: 5.69 },
};

function formatNumber(value: number) {
  return value.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function asBullets(lines: string[]) {
  return lines.map((line) => `–  ${line}`).join("\n");
}

function inferSiteLabel(project: DocumentProject, fieldData: ProjectFieldDocumentation) {
  const source = `${fieldData.site?.odf ?? ""} ${fieldData.site?.etn ?? ""}`;
  const siteCode = source.match(/(?:^|[-_\s])([a-z]\d{3,})(?:$|[-_\s])/i)?.[1];
  return siteCode ? `Site ${siteCode.toUpperCase()}` : `Site ${project.id}`;
}

function getRouteCatalogItem(method: RouteMethod, cableType: string) {
  if (method !== "aerial") return routeCatalog[method];
  const fiberCount = Number(cableType.match(/(\d+)\s*(?:fire|fibre)/i)?.[1] ?? 0);
  if (fiberCount >= 144) return { position: "13", name: "Instalare FO ADSS 144 fire pe stâlpi", unit: "km", price: 380 };
  if (fiberCount >= 24) return { position: "12", name: "Instalare FO ADSS 24, 48 sau 96 fire pe stâlpi", unit: "km", price: 380 };
  return { position: "11", name: "Instalare FO ADSS 2, 4, 8 sau 12 fire pe stâlpi", unit: "km", price: 380 };
}

function buildReport(project: DocumentProject, fieldData: ProjectFieldDocumentation): ReportDraft {
  const siteLines = fieldData.site?.noIntervention
    ? [`Nu s-a intervenit în secțiunea Site. Motiv: ${fieldData.site.noInterventionReason}.`]
    : fieldData.site
    ? [
        `S-a cablat portul ${fieldData.site.etnPort} din switch ${fieldData.site.etn}.`,
        `Conexiunea a fost realizată în ODF ${fieldData.site.odf}, portul ${fieldData.site.odfPort}.`,
        ...(fieldData.site.mediaConverterInstalled && fieldData.site.mediaConverterType ? [`S-a instalat Media Converter ${fieldData.site.mediaConverterType} în site.`] : []),
        ...(fieldData.site.sfpInstalled && fieldData.site.sfpType ? [`S-a instalat ${fieldData.site.sfpType} în site.`] : []),
      ]
    : ["Datele pentru ODF și eTN nu au fost încă salvate din teren."];

  const routeLines = fieldData.route?.noIntervention
    ? [`Nu s-a intervenit la traseul FO. Motiv: ${fieldData.route.noInterventionReason}.`]
    : fieldData.route?.segments.length
    ? (() => {
        const cableTypes = [...new Set(fieldData.route.segments.map((segment) => segment.cableType.match(/(4|12|24|48|96)[ ]*F/i)?.[1]).filter((value): value is string => Boolean(value)).map((value) => `${value}F`))];
        const cableDescription = cableTypes.length === 1 ? `un cablu FO ${cableTypes[0]}` : `cabluri FO ${cableTypes.join(", ")}`;
        return [`S-a instalat ${cableDescription} între ${fieldData.route.junction.label} și locația clientului, în lungime de ${fieldData.route.totalLengthMeters.toLocaleString("ro-RO")} m, din care ${fieldData.route.segments.map((segment) => `${segment.lengthMeters.toLocaleString("ro-RO")} m ${segment.label.toLocaleLowerCase("ro-RO")}`).join(", ")}.`];
      })()
    : ["Traseul FO nu a fost încă salvat din teren."];

  if (fieldData.route?.segments.some((segment) => segment.method === "aerial")) {
    const accessories = [
      ["Bărcuță", fieldData.route.aerialMaterials.boat],
      ["Colier tablă inox", fieldData.route.aerialMaterials.stainlessClamp],
      ["Cârlig", fieldData.route.aerialMaterials.hook],
      ["Armorod", fieldData.route.aerialMaterials.armorod],
    ].filter((item): item is [string, number] => Number(item[1]) > 0);
    if (accessories.length) routeLines.push(`Accesorii instalare aeriană: ${accessories.map(([name, quantity]) => `${name}: ${quantity.toLocaleString("ro-RO")} buc.`).join(", ")}`);
  }

  if (fieldData.splices?.noIntervention) {
    routeLines.push(`Nu s-a intervenit la sudurile FO. Motiv: ${fieldData.splices.noInterventionReason}.`);
  } else if (fieldData.splices?.count) {
    routeLines.push(`Total suduri FO: ${fieldData.splices.count}.`);
  }

  const equipment = fieldData.client?.equipment ?? [
    project.cpe,
    ...(project.sfp ? ["SFP optic"] : []),
    ...(project.mc ? [`Media Converter${project.mcType ? ` ${project.mcType}` : ""}`] : []),
    ...(project.terminalBox ? ["Terminal Box"] : []),
  ];
  const clientLines = fieldData.client?.noIntervention
    ? [`Nu s-a intervenit la client. Motiv: ${fieldData.client.noInterventionReason}.`]
    : [
        `S-a instalat și configurat echipamentul ${equipment[0] || project.cpe}.`,
        ...equipment.slice(1).map((item) => `S-a instalat ${item}.`),
      ];
  if (fieldData.client?.service) clientLines.push(`Serviciul documentat: ${fieldData.client.service}.`);
  if (fieldData.client?.clientHasNoGroundingSystem) {
    clientLines.push("Clientul declară că locația nu dispune de sistem de împământare, iar echipamentul nu a putut fi conectat la împământare.");
  }

  return {
    title: "Raport acceptanță",
    siteLabel: inferSiteLabel(project, fieldData),
    siteCode: "",
    lec: "",
    site: asBullets(siteLines),
    route: asBullets(routeLines),
    client: asBullets(clientLines),
    materialChambers: "0",
    materialPoles: "0",
  };
}

function buildBudgetSuggestions(fieldData: ProjectFieldDocumentation): BudgetSuggestion[] {
  const suggestions: BudgetSuggestion[] = [];

  for (const segment of fieldData.route?.segments ?? []) {
    const item = getRouteCatalogItem(segment.method, segment.cableType);
    suggestions.push({
      id: `route-${segment.method}`,
      category: "Manoperă",
      catalogPosition: item.position,
      name: item.name,
      unit: item.unit,
      unitPrice: item.price,
      quantity: Number((segment.lengthMeters / 1000).toFixed(3)),
      evidence: `${segment.label} · ${segment.lengthMeters.toLocaleString("ro-RO")} m documentați`,
      selected: true,
    });
  }

  if (fieldData.splices?.count) {
    suggestions.push({
      id: "splice-work",
      category: "Manoperă",
      catalogPosition: "7",
      name: "Sudură fibră optică",
      unit: "buc",
      unitPrice: 4,
      quantity: fieldData.splices.count,
      evidence: `${fieldData.splices.count} ${fieldData.splices.count === 1 ? "sudură salvată" : "suduri salvate"} în secțiunea Suduri FO`,
      selected: true,
    });
    suggestions.push({
      id: "junction-open-close",
      category: "Manoperă",
      catalogPosition: "8",
      name: "Închidere/deschidere cutie de joncțiune/ODF",
      unit: "luc",
      unitPrice: 11.9,
      quantity: Math.max(1, new Set(fieldData.splices.junctions.map((junction) => junction.label)).size),
      evidence: "Joncțiuni deschise, închise și fotografiate în teren",
      selected: true,
    });
  }

  const materials = fieldData.route?.aerialMaterials;
  if (materials) {
    for (const key of Object.keys(materialCatalog) as Array<keyof typeof materialCatalog>) {
      if (!materials[key]) continue;
      const item = materialCatalog[key];
      suggestions.push({
        id: `material-${key}`,
        category: "Material",
        catalogPosition: item.position,
        name: item.name,
        unit: "buc",
        unitPrice: item.price,
        quantity: materials[key],
        evidence: `${materials[key]} buc. declarate la instalarea aeriană`,
        selected: true,
      });
    }
  }

  const newJunctions = Math.max(
    fieldData.route?.junction.kind === "new" ? 1 : 0,
    fieldData.splices?.junctions.filter((junction) => junction.kind === "new").length ?? 0
  );
  if (newJunctions) {
    suggestions.push({
      id: "new-junction-box",
      category: "Material",
      catalogPosition: "M6",
      name: "Furnizare cutie de joncțiune FO ADSS, 12 joncțiuni",
      unit: "buc",
      unitPrice: 63,
      quantity: newJunctions,
      evidence: `${newJunctions} ${newJunctions === 1 ? "joncțiune nou instalată" : "joncțiuni nou instalate"}`,
      selected: true,
    });
  }

  return suggestions;
}

export function ProjectDocumentsSection({ project, fieldData, onNotify }: Props) {
  const [tab, setTab] = useState<"report" | "splices" | "materials" | "estimate" | "references">("report");
  const [referenceFiles, setReferenceFiles] = useState<StoredProjectFile[]>([]);
  const [referenceUploading, setReferenceUploading] = useState<"orangeNetwork" | "mapxtreme" | "">("");
  const [report, setReport] = useState(() => buildReport(project, fieldData));
  const [suggestions, setSuggestions] = useState(() => buildBudgetSuggestions(fieldData));
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setReport(buildReport(project, fieldData));
      setSuggestions(buildBudgetSuggestions(fieldData));
      setSavedAt("");
    });
    fetch(`/api/reports?${new URLSearchParams({ projectId: project.id }).toString()}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { saved?: { report: ReportDraft; updatedAt: number } | null; error?: string };
        if (!response.ok) throw new Error(payload.error || "Raportul nu este disponibil momentan.");
        if (!active || !payload.saved) return;
        setReport({ ...buildReport(project, fieldData), ...payload.saved.report });
        setSavedAt(new Intl.DateTimeFormat("ro-RO", { hour: "2-digit", minute: "2-digit" }).format(new Date(payload.saved.updatedAt)));
      })
      .catch(() => {
        // The generated report remains editable while a saved version is temporarily unavailable.
      });
    return () => {
      active = false;
    };
  }, [project.id, fieldData]);

  useEffect(() => {
    let active = true;
    fetchProjectFiles(project.id, "project")
      .then((files) => {
        if (active) setReferenceFiles(files.filter((file) => file.category === "orangeNetwork" || file.category === "mapxtreme"));
      })
      .catch(() => {
        if (active) setReferenceFiles([]);
      });
    return () => {
      active = false;
    };
  }, [project.id]);

  function referenceNotRequired(category: ReferenceCategory) {
    const expected = referenceReportLines[category].toLocaleLowerCase("ro-RO");
    return report.client.split("\n").some((line) => line.replace(/^[–—-]\s*/, "").trim().toLocaleLowerCase("ro-RO") === expected);
  }

  function setReferenceNotRequired(category: ReferenceCategory, checked: boolean) {
    const text = referenceReportLines[category];
    const retained = report.client
      .split("\n")
      .filter((line) => line.replace(/^[–—-]\s*/, "").trim().toLocaleLowerCase("ro-RO") !== text.toLocaleLowerCase("ro-RO"));
    const updatedReport = { ...report, client: [...retained, ...(checked ? [`–  ${text}`] : [])].filter(Boolean).join("\n") };
    setReport(updatedReport);
    void saveReport(
      checked ? `Raportul a fost actualizat cu „${text}”` : `Mențiunea pentru ${category === "orangeNetwork" ? "OrangeNetwork" : "MapXtreme"} a fost eliminată din raport.`,
      updatedReport,
    );
  }

  async function uploadReferencePhoto(category: ReferenceCategory, file: File | null) {
    if (!file) return;
    setReferenceUploading(category);
    try {
      const stored = await uploadProjectFile({ projectId: project.id, section: "project", category, file });
      setReferenceFiles((current) => [stored, ...current.filter((item) => item.category !== category)]);
      onNotify("Poza " + (category === "orangeNetwork" ? "OrangeNetwork" : "MapXtreme") + " a fost salvată.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Poza nu a putut fi încărcată.");
    } finally {
      setReferenceUploading("");
    }
  }

  const cableMaterials = useMemo(() => {
    const totals = new Map<string, number>();
    for (const segment of fieldData.route?.segments ?? []) totals.set(segment.cableType, (totals.get(segment.cableType) ?? 0) + segment.lengthMeters);
    return [...totals.entries()].map(([name, quantity]) => ({ name, quantity, unit: "m" }));
  }, [fieldData.route]);
  const orangeMaterials = [
    ...(project.cpe ? [{ name: `CPE ${project.cpe}`, quantity: 1, unit: "buc." }] : []),
    ...(project.sfp ? [{ name: fieldData.client?.sfpType || "SFP", quantity: fieldData.client?.sfpQuantity || 1, unit: "buc." }] : []),
    ...(project.mc ? [{ name: `Media Converter${project.mcType ? ` ${project.mcType}` : ""}`, quantity: 1, unit: "buc." }] : []),
    ...(project.terminalBox ? [{ name: "Terminal Box", quantity: 1, unit: "buc." }] : []),
    ...(fieldData.site?.mediaConverterInstalled && fieldData.site.mediaConverterType ? [{ name: `Media Converter ${fieldData.site.mediaConverterType} · site`, quantity: 1, unit: "buc." }] : []),
    ...(fieldData.site?.sfpInstalled && fieldData.site.sfpType ? [{ name: `${fieldData.site.sfpType} · site`, quantity: 1, unit: "buc." }] : []),
    ...cableMaterials,
  ];
  const proconectMaterials = [
    { name: "Bărcuță", quantity: fieldData.route?.aerialMaterials.boat ?? 0, unit: "buc." },
    { name: "Colier tablă inox", quantity: fieldData.route?.aerialMaterials.stainlessClamp ?? 0, unit: "buc." },
    { name: "Cârlig", quantity: fieldData.route?.aerialMaterials.hook ?? 0, unit: "buc." },
    { name: "Armorod", quantity: fieldData.route?.aerialMaterials.armorod ?? 0, unit: "buc." },
  ].filter((item) => item.quantity > 0);

  const selectedSuggestions = suggestions.filter((item) => item.selected);
  const estimateTotal = useMemo(
    () => selectedSuggestions.reduce((total, item) => total + item.quantity * item.unitPrice, 0),
    [selectedSuggestions]
  );

  function updateReport(field: keyof ReportDraft, value: string) {
    setReport((current) => ({ ...current, [field]: value }));
  }

  function regenerate() {
    setReport((current) => {
      const generated = buildReport(project, fieldData);
      const referenceLines = (Object.keys(referenceReportLines) as ReferenceCategory[])
        .filter((category) => current.client.split("\n").some((line) => line.replace(/^[–—-]\s*/, "").trim().toLocaleLowerCase("ro-RO") === referenceReportLines[category].toLocaleLowerCase("ro-RO")))
        .map((category) => `–  ${referenceReportLines[category]}`);
      return { ...generated, siteCode: current.siteCode, lec: current.lec, client: [generated.client, ...referenceLines].join("\n") };
    });
    onNotify("Raportul a fost regenerat din operațiunile salvate în teren.");
  }

  async function saveReport(successMessage = `Raportul de acceptanță pentru ${project.id} a fost salvat permanent.`, reportToSave: ReportDraft = report) {
    try {
      const response = await fetch("/api/reports", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, report: reportToSave }),
      });
      const payload = (await response.json()) as { updatedAt?: number; error?: string };
      if (!response.ok || !payload.updatedAt) throw new Error(payload.error || "Raportul nu a putut fi salvat.");
      setSavedAt(new Intl.DateTimeFormat("ro-RO", { hour: "2-digit", minute: "2-digit" }).format(new Date(payload.updatedAt)));
      onNotify(successMessage);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Raportul de acceptanță nu a putut fi salvat.");
    }
  }

  function updateSuggestion(id: string, patch: Partial<BudgetSuggestion>) {
    setSuggestions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <div className="page-wrap project-documents-page">
      <section className="page-heading documents-heading">
        <div><p className="eyebrow">CONTROL ȘI ÎNCHIDERE PROIECT</p><h1>Documente</h1><p>Pregătește raportul de acceptanță și devizul pe baza datelor documentate în teren.</p></div>
        <div className="manager-access-badge"><span>◆</span><div><small>ACCES RESTRICȚIONAT</small><strong>Admin / Manager / Coordonator</strong></div></div>
      </section>

      <div className="documents-tabs" role="tablist" aria-label="Subsecțiuni documente">
        <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><span>DOC</span><div><strong>Raport de acceptanță</strong><small>Previzualizare și editare</small></div></button>
        <button className={tab === "splices" ? "active" : ""} onClick={() => setTab("splices")}><span>FO</span><div><strong>Fișă de suduri</strong><small>Corespondență fibre</small></div><b>{fieldData.splices?.records?.length ?? 0}</b></button>
        <button className={tab === "materials" ? "active" : ""} onClick={() => setTab("materials")}><span>MAT</span><div><strong>Fișă de materiale</strong><small>Orange și Proconect</small></div><b>{orangeMaterials.length + proconectMaterials.length}</b></button>
        <button className={tab === "estimate" ? "active" : ""} onClick={() => setTab("estimate")}><span>EUR</span><div><strong>Sugestii deviz</strong><small>Operațiuni și materiale</small></div><b>{suggestions.length}</b></button>
        <button className={tab === "references" ? "active" : ""} onClick={() => setTab("references")}><span>IMG</span><div><strong>OrangeNetwork și MapXtreme</strong><small>Imagini de referință</small></div><b>{referenceFiles.length}</b></button>
      </div>

      {tab === "references" && (
        <section className="splice-sheet-card">
          <div className="document-toolbar">
            <div><span>IMG</span><p><strong>Imagini de referință · {project.id}</strong><small>Încarcă separat capturile OrangeNetwork și MapXtreme</small></p></div>
          </div>
          <div className="form-section">
            <div className="upload-grid">
              {(["orangeNetwork", "mapxtreme"] as const).map((category) => {
                const saved = referenceFiles.find((file) => file.category === category);
                const label = category === "orangeNetwork" ? "OrangeNetwork" : "MapXtreme";
                const notRequired = referenceNotRequired(category);
                return (
                  <div className="reference-upload-item" key={category}>
                    <label className={saved ? "upload-box has-file" : "upload-box"}>
                      <input type="file" accept=".png,.jpg,.jpeg,image/*" disabled={Boolean(referenceUploading) || notRequired} onChange={(event) => void uploadReferencePhoto(category, event.target.files?.[0] ?? null)} />
                      <b>{referenceUploading === category ? "…" : saved ? "✓" : "↑"}</b>
                      <strong>{saved?.name || "Încarcă poza " + label}</strong>
                      <small>{notRequired ? "Marcată ca nefiind necesară" : saved ? "Poză salvată · selectează alta pentru o versiune nouă" : "PNG sau JPG, max. 20 MB"}</small>
                    </label>
                    <label className="reference-not-required">
                      <input type="checkbox" checked={notRequired} onChange={(event) => setReferenceNotRequired(category, event.target.checked)} />
                      <span>Nu e necesar</span>
                    </label>
                  </div>
                );
              })}
            </div>
            {referenceFiles.length > 0 && <div className="drive-note"><span>✓</span><div><strong>{referenceFiles.length === 2 ? "Ambele imagini sunt salvate" : "O imagine este salvată"}</strong><p>Fișierele sunt incluse în dosarul de documente al instalării și în sincronizarea configurată.</p></div></div>}
          </div>
        </section>
      )}

      {tab === "report" && (
        <div className="report-workspace">
          <section className="acceptance-preview-card">
            <div className="document-toolbar"><div><span>W</span><p><strong>Raport acceptanță · {project.id}</strong><small>Model: Raport acceptanta.docx</small></p></div><div><button onClick={regenerate}>↻ Generează din teren</button><button className="primary-button" onClick={() => void saveReport()}>Salvează</button></div></div>
            <article className="acceptance-paper">
              <input className="report-title-input" value={report.title} onChange={(event) => updateReport("title", event.target.value)} aria-label="Titlul raportului" />
              <input className="report-site-input" value={`Site ${report.siteCode || project.id}`} readOnly aria-label="Site și cod site" />
              <section className="editable-report-section site-report-section">
                {report.siteCode && <p className="report-metadata-line"><strong>Cod site:</strong> {report.siteCode}</p>}
                <textarea value={report.site} onChange={(event) => updateReport("site", event.target.value)} rows={Math.max(2, report.site.split("\n").length + 1)} aria-label="Conținut secțiune Site" />
                <small>Fiecare rând este inclus ca punct distinct în raport.</small>
              </section>
              {(["route", "client"] as const).map((section) => (
                <section className="editable-report-section" key={section}>
                  <h2>{section === "route" ? "Traseu" : `Client ${report.lec || ""}`.trim()}</h2>
                  {section === "client" && report.lec && <p className="report-metadata-line"><strong>Client LEC:</strong> {report.lec}</p>}
                  <textarea value={report[section]} onChange={(event) => updateReport(section, event.target.value)} rows={Math.max(2, report[section].split("\n").length + 1)} aria-label={`Conținut secțiune ${section}`} />
                  <small>Fiecare rând este inclus ca punct distinct în raport.</small>
                </section>
              ))}
            </article>
          </section>

          <aside className="report-status-card">
            <div className="summary-title"><span>DOC</span><div><h2>Stare raport</h2><p>{project.id} · {project.client}</p></div></div>
            <div className="report-source-list">
              <div className={fieldData.site ? "complete" : ""}><span>{fieldData.site ? "✓" : "○"}</span><p><strong>Operațiuni site</strong><small>{fieldData.site ? fieldData.site.noIntervention ? "Nu s-a intervenit" : "ODF și eTN preluate" : "Date nesalvate"}</small></p></div>
              <div className={fieldData.route ? "complete" : ""}><span>{fieldData.route ? "✓" : "○"}</span><p><strong>Traseu FO</strong><small>{fieldData.route ? fieldData.route.noIntervention ? "Nu s-a intervenit" : `${fieldData.route.totalLengthMeters} m preluați` : "Date nesalvate"}</small></p></div>
              <div className={fieldData.splices ? "complete" : ""}><span>{fieldData.splices ? "✓" : "○"}</span><p><strong>Suduri FO</strong><small>{fieldData.splices ? fieldData.splices.noIntervention ? "Nu s-a intervenit" : `${fieldData.splices.count} înregistrări` : "Date nesalvate"}</small></p></div>
              <div className={fieldData.client ? "complete" : ""}><span>{fieldData.client ? "✓" : "○"}</span><p><strong>Client</strong><small>{fieldData.client ? fieldData.client.noIntervention ? `Nu s-a intervenit · ${fieldData.client.service}` : fieldData.client.service : "Date nesalvate"}</small></p></div>
            </div>
            <div className="report-save-state"><span>{savedAt ? "✓" : "i"}</span><p><strong>{savedAt ? `Versiune salvată la ${savedAt}` : "Raport editabil"}</strong><small>Modificările administratorului nu schimbă datele tehnicianului.</small></p></div>
            <button className="secondary-button report-export" onClick={() => onNotify("Raportul va fi exportat în format DOCX după confirmarea administratorului.")}>Exportă DOCX <span>↗</span></button>
          </aside>
        </div>
      )}

      {tab === "splices" && (
        <section className="splice-sheet-card">
          <div className="document-toolbar splice-sheet-toolbar">
            <div><span>FO</span><p><strong>Fișă de suduri · {project.id}</strong><small>Generată din înregistrările salvate în teren</small></p></div>
            <div><button className="primary-button" onClick={() => window.print()}>Tipărește / Salvează PDF</button></div>
          </div>
          <article className="splice-sheet-paper">
            <header>
              <div><small>PRO CONECT</small><h1>Fișă de suduri fibră optică</h1></div>
              <strong>{project.id}</strong>
            </header>
            <div className="splice-sheet-project">
              <div><small>CLIENT</small><strong>{project.client}</strong></div>
              <div><small>LOCAȚIE</small><strong>{project.address}</strong></div>
              <div><small>COD SITE</small><strong>{report.siteCode || "Nespecificat"}</strong></div>
              <div><small>CLIENT LEC</small><strong>{report.lec || "Nespecificat"}</strong></div>
              <div><small>DIAGRAMĂ DE REFERINȚĂ</small><strong>{project.splice || "Neîncărcată"}</strong></div>
              <div><small>TOTAL SUDURI</small><strong>{fieldData.splices?.count ?? 0}</strong></div>
            </div>
            {fieldData.splices?.noIntervention ? (
              <div className="splice-sheet-empty"><strong>Nu s-a intervenit la sudurile FO</strong><p>{fieldData.splices.noInterventionReason}</p></div>
            ) : fieldData.splices?.records?.length ? (
              <div className="splice-sheet-table-wrap">
                <table className="splice-sheet-table">
                  <thead><tr><th>NR.</th><th>JONCȚIUNE</th><th>TIP / REȚEA</th><th>COORDONATE</th><th>CABLU SITE</th><th>BUFFER / FIBRĂ SITE</th><th>CABLU CLIENT</th><th>BUFFER / FIBRĂ CLIENT</th></tr></thead>
                  <tbody>{fieldData.splices.records.map((record, index) => (
                    <tr key={record.id}>
                      <td>{index + 1}</td>
                      <td><strong>{record.junction.documented ? record.junction.code : "Fără cod"}</strong><small>{record.junction.name}</small></td>
                      <td><strong>{record.junction.documented ? "Documentată" : record.junctionKind === "new" ? "Nouă" : "Existentă"}</strong><small>{record.network === "mobile" ? "Orange Mobil" : record.network === "fixed" ? "Orange Fixed" : "—"}</small></td>
                      <td>{record.junction.documented ? "—" : `${record.junction.lat.toFixed(6)}, ${record.junction.lon.toFixed(6)}`}</td>
                      <td>{record.siteCableType || "Nespecificat"}</td>
                      <td>{record.siteBuffer} / {record.siteFiber}</td>
                      <td>{record.clientCableType || "Nespecificat"}</td>
                      <td>{record.clientBuffer} / {record.clientFiber}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="splice-sheet-empty"><strong>Nu există suduri salvate</strong><p>Completează secțiunea „Suduri FO” pentru a genera fișa.</p></div>
            )}
            <footer><span>{project.id} · {project.client}</span><span>Fișă generată din datele documentate în aplicație</span></footer>
          </article>
        </section>
      )}

      {tab === "materials" && (
        <section className="material-sheet-card">
          <div className="document-toolbar material-sheet-toolbar">
            <div><span>MAT</span><p><strong>Fișă de materiale · {project.id}</strong><small>Generată din echipamentele și materialele documentate</small></p></div>
            <div><button onClick={() => window.print()}>Tipărește / PDF</button><button className="primary-button" onClick={() => void saveReport(`Fișa de materiale pentru ${project.id} a fost salvată.`)}>Salvează fișa</button></div>
          </div>
          <article className="material-sheet-paper">
            <header><div><small>PRO CONECT</small><h1>Fișă de materiale</h1></div><strong>{project.id}</strong></header>
            <div className="material-sheet-project"><span><small>CLIENT</small><strong>{project.client}</strong></span><span><small>LOCAȚIE</small><strong>{project.address}</strong></span></div>
            <section>
              <h2>Materiale Orange</h2>
              <table><thead><tr><th>NR.</th><th>MATERIAL</th><th>CANTITATE</th><th>UM</th></tr></thead><tbody>
                {orangeMaterials.length ? orangeMaterials.map((item, index) => <tr key={item.name}><td>{index + 1}</td><td>{item.name}</td><td>{item.quantity.toLocaleString("ro-RO")}</td><td>{item.unit}</td></tr>) : <tr><td colSpan={4}>Nu există materiale Orange documentate.</td></tr>}
              </tbody></table>
            </section>
            <section>
              <h2>Materiale Proconect</h2>
              <table><thead><tr><th>NR.</th><th>MATERIAL</th><th>CANTITATE</th><th>UM</th></tr></thead><tbody>
                {proconectMaterials.map((item, index) => <tr key={item.name}><td>{index + 1}</td><td>{item.name}</td><td>{item.quantity.toLocaleString("ro-RO")}</td><td>{item.unit}</td></tr>)}
              </tbody></table>
            </section>
            <footer><span>{project.id} · {project.client}</span><span>Cantități preluate din documentația proiectului</span></footer>
          </article>
        </section>
      )}

      {tab === "estimate" && (
        <section className="estimate-card">
          <div className="estimate-head"><div><span>Σ</span><p><small>MODEL DEVIZ</small><strong>Deviz final · sugestii automate</strong><em>Prețurile sunt preluate din fișierul atașat; cantitățile provin din teren.</em></p></div><div><small>TOTAL SELECTAT, FĂRĂ TVA</small><strong>{formatNumber(estimateTotal)} EUR</strong></div></div>
          {suggestions.length ? (
            <div className="estimate-table-wrap">
              <table className="estimate-table">
                <thead><tr><th>INCLUDE</th><th>POZ.</th><th>LUCRARE / MATERIAL</th><th>UM</th><th>PREȚ EUR</th><th>CANTITATE</th><th>TOTAL EUR</th></tr></thead>
                <tbody>{suggestions.map((item) => (
                  <tr className={item.selected ? "selected" : ""} key={item.id}>
                    <td><input type="checkbox" checked={item.selected} onChange={(event) => updateSuggestion(item.id, { selected: event.target.checked })} aria-label={`Include ${item.name}`} /></td>
                    <td><span className={item.category === "Material" ? "estimate-position material" : "estimate-position"}>{item.catalogPosition}</span></td>
                    <td><strong>{item.name}</strong><small>{item.evidence}</small></td>
                    <td>{item.unit}</td>
                    <td>{formatNumber(item.unitPrice)}</td>
                    <td><input type="number" min="0" step="0.001" value={item.quantity} onChange={(event) => updateSuggestion(item.id, { quantity: Number(event.target.value) })} /></td>
                    <td><strong>{formatNumber(item.quantity * item.unitPrice)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <div className="estimate-empty"><span>○</span><h2>Nicio sugestie disponibilă</h2><p>Salvează traseul, sudurile sau materialele utilizate pentru a genera pozițiile de deviz.</p></div>
          )}
          <div className="estimate-footer"><p><span>i</span><strong>Verificare administrator</strong> Sugestiile nu modifică devizul până la confirmare.</p><div><button className="secondary-button" onClick={() => onNotify("Modelul Deviz final RID1750308.xls este disponibil pentru consultare.")}>Vezi modelul</button><button className="primary-button" disabled={!selectedSuggestions.length} onClick={() => onNotify(`${selectedSuggestions.length} poziții au fost pregătite pentru devizul ${project.id}.`)}>Aplică în deviz <span>→</span></button></div></div>
        </section>
      )}
    </div>
  );
}
