"use client";

import { useEffect, useState } from "react";
import { fetchProjectFiles, uploadProjectFile } from "./client-storage";
import type { FieldMediaConverterType, SiteFieldSummary, SiteSfpType } from "./field-documentation";
import { NoInterventionControl } from "./no-intervention-control";

type SiteProject = {
  id: string;
  client: string;
  address: string;
  technician: string;
};

type SiteOperation = {
  odf: string;
  odfPort: string;
  etn: string;
  etnPort: string;
  mediaConverterInstalled: boolean;
  mediaConverterType: FieldMediaConverterType | "";
  sfpInstalled: boolean;
  sfpType: SiteSfpType | "";
  photos: Record<SitePhotoKey, string>;
};

type SitePhotoKey = "odfPort" | "etn" | "overview";
type SiteTextField = "odf" | "odfPort" | "etn" | "etnPort";

type Props = {
  project: SiteProject;
  initialSummary?: SiteFieldSummary;
  onNotify: (message: string) => void;
  onSaved?: (summary: SiteFieldSummary) => Promise<void> | void;
};

const emptyOperation: SiteOperation = {
  odf: "",
  odfPort: "",
  etn: "",
  etnPort: "",
  mediaConverterInstalled: false,
  mediaConverterType: "",
  sfpInstalled: false,
  sfpType: "",
  photos: { odfPort: "", etn: "", overview: "" },
};

const sitePhotoCatalog: Array<{ key: SitePhotoKey; badge: string; title: string; description: string }> = [
  { key: "odfPort", badge: "ODF", title: "Foto port ODF", description: "Fotografiază clar portul ODF utilizat." },
  { key: "etn", badge: "eTN", title: "Foto eTN", description: "Fotografiază echipamentul eTN și conexiunea." },
  { key: "overview", badge: "360", title: "Foto ansamblu", description: "Fotografiază ansamblul instalației din site." },
];

export function SiteOperationsSection({ project: projectItem, initialSummary, onNotify, onSaved }: Props) {
  const [operation, setOperation] = useState<SiteOperation>(emptyOperation);
  const [savedOperations, setSavedOperations] = useState<Record<string, SiteOperation>>({});
  const [noIntervention, setNoIntervention] = useState(false);
  const [noInterventionReason, setNoInterventionReason] = useState("");
  const requiredItems = noIntervention ? [noInterventionReason] : [
    operation.odf,
    operation.odfPort,
    operation.etn,
    operation.etnPort,
    ...(operation.mediaConverterInstalled ? [operation.mediaConverterType] : []),
    ...(operation.sfpInstalled ? [operation.sfpType] : []),
    ...Object.values(operation.photos),
  ];
  const completedItems = requiredItems.filter((value) => value.trim()).length;
  const progress = Math.round((completedItems / requiredItems.length) * 100);
  const ready = completedItems === requiredItems.length;
  const saved = Boolean(savedOperations[projectItem.id] || initialSummary);

  useEffect(() => {
    const restored = savedOperations[projectItem.id] ?? (initialSummary ? {
      odf: initialSummary.odf,
      odfPort: initialSummary.odfPort,
      etn: initialSummary.etn,
      etnPort: initialSummary.etnPort,
      mediaConverterInstalled: Boolean(initialSummary.mediaConverterInstalled),
      mediaConverterType: initialSummary.mediaConverterType ?? "",
      sfpInstalled: Boolean(initialSummary.sfpInstalled),
      sfpType: initialSummary.sfpType ?? "",
      photos: initialSummary.photos ?? { odfPort: "", etn: "", overview: "" },
    } : emptyOperation);
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setOperation(restored);
        setNoIntervention(Boolean(initialSummary?.noIntervention));
        setNoInterventionReason(initialSummary?.noInterventionReason ?? "");
      }
    });
    fetchProjectFiles(projectItem.id, "site")
      .then((files) => {
        if (!active) return;
        const restoredPhotos = { ...restored.photos };
        for (const file of files) {
          if (file.category === "odfPort" || file.category === "etn" || file.category === "overview") restoredPhotos[file.category] = file.name;
        }
        setOperation((current) => ({ ...current, photos: restoredPhotos }));
      })
      .catch(() => {
        // The saved ODF/eTN values remain available if storage is temporarily unavailable.
      });
    return () => {
      active = false;
    };
  }, [projectItem.id, initialSummary]);

  function updateField(field: SiteTextField, value: string) {
    setOperation((current) => ({ ...current, [field]: value }));
  }

  async function capturePhoto(key: SitePhotoKey, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setOperation((current) => ({
      ...current,
      photos: { ...current.photos, [key]: file.name },
    }));
    try {
      const stored = await uploadProjectFile({ projectId: projectItem.id, section: "site", category: key, file });
      setOperation((current) => ({ ...current, photos: { ...current.photos, [key]: stored.name } }));
    } catch (error) {
      setOperation((current) => ({ ...current, photos: { ...current.photos, [key]: "" } }));
      onNotify(error instanceof Error ? error.message : "Fotografia site-ului nu a putut fi salvată.");
    }
  }

  async function saveOperation() {
    if (noIntervention) {
      const reason = noInterventionReason.trim();
      if (!reason) {
        onNotify("Completează motivul pentru care nu s-a intervenit la site.");
        return;
      }
      try {
        await onSaved?.({
          noIntervention: true,
          noInterventionReason: reason,
          odf: "",
          odfPort: "",
          etn: "",
          etnPort: "",
          mediaConverterInstalled: false,
          mediaConverterType: "",
          sfpInstalled: false,
          sfpType: "",
          photos: { odfPort: "", etn: "", overview: "" },
        });
        setSavedOperations((current) => ({ ...current, [projectItem.id]: emptyOperation }));
        onNotify(`Operațiunile de la site pentru ${projectItem.id} au fost salvate ca „Nu s-a intervenit”.`);
      } catch (error) {
        onNotify(error instanceof Error ? error.message : "Operațiunile site nu au putut fi salvate.");
      }
      return;
    }
    if (!operation.odf.trim()) {
      onNotify("Completează identificatorul ODF.");
      return;
    }
    if (!operation.odfPort.trim()) {
      onNotify("Completează portul ODF.");
      return;
    }
    if (!operation.etn.trim()) {
      onNotify("Completează identificatorul eTN.");
      return;
    }
    if (!operation.etnPort.trim()) {
      onNotify("Completează portul eTN.");
      return;
    }
    if (operation.mediaConverterInstalled && !operation.mediaConverterType) {
      onNotify("Selectează tipul Media Converter instalat în site.");
      return;
    }
    if (operation.sfpInstalled && !operation.sfpType) {
      onNotify("Selectează tipul SFP instalat în site.");
      return;
    }
    const missingPhoto = sitePhotoCatalog.find((item) => !operation.photos[item.key].trim());
    if (missingPhoto) {
      onNotify(`Încarcă fotografia obligatorie: ${missingPhoto.title}.`);
      return;
    }
    const normalized = {
      odf: operation.odf.trim(),
      odfPort: operation.odfPort.trim(),
      etn: operation.etn.trim(),
      etnPort: operation.etnPort.trim(),
      mediaConverterInstalled: operation.mediaConverterInstalled,
      mediaConverterType: operation.mediaConverterInstalled ? operation.mediaConverterType : "",
      sfpInstalled: operation.sfpInstalled,
      sfpType: operation.sfpInstalled ? operation.sfpType : "",
      photos: { ...operation.photos },
    };
    try {
      await onSaved?.({
        noIntervention: false,
        noInterventionReason: "",
        odf: normalized.odf,
        odfPort: normalized.odfPort,
        etn: normalized.etn,
        etnPort: normalized.etnPort,
        mediaConverterInstalled: normalized.mediaConverterInstalled,
        mediaConverterType: normalized.mediaConverterType,
        sfpInstalled: normalized.sfpInstalled,
        sfpType: normalized.sfpType,
        photos: normalized.photos,
      });
      setOperation(normalized);
      setSavedOperations((current) => ({ ...current, [projectItem.id]: normalized }));
      onNotify(`Operațiunile de la site pentru ${projectItem.id} au fost salvate permanent.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Operațiunile site nu au putut fi salvate.");
    }
  }

  const checklist = [
    { label: "Identificator ODF", value: operation.odf },
    { label: "Port ODF", value: operation.odfPort },
    { label: "Identificator eTN", value: operation.etn },
    { label: "Port eTN", value: operation.etnPort },
    ...(operation.mediaConverterInstalled ? [{ label: "Media Converter", value: operation.mediaConverterType }] : []),
    ...(operation.sfpInstalled ? [{ label: "SFP site", value: operation.sfpType }] : []),
    ...sitePhotoCatalog.map((item) => ({ label: item.title, value: operation.photos[item.key] })),
  ];

  return (
    <div className="page-wrap site-operations-page">
      <section className="page-heading client-heading">
        <div>
          <p className="eyebrow">DOCUMENTAȚIE DIN TEREN</p>
          <h1>Operațiuni site</h1>
          <p>Documentează punctele de conectare și cele 3 fotografii obligatorii din site.</p>
        </div>
        <div className="field-technician">
          <span className="avatar">{projectItem.technician.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
          <div><small>TEHNICIAN ALOCAT</small><strong>{projectItem.technician}</strong></div>
        </div>
      </section>

      <section className="site-operation-project">
        <div className="site-project-copy"><span>RID</span><p><small>PROIECT ACTIV</small><strong>{projectItem.id} · {projectItem.client}</strong></p></div>
        <div><span>⌖</span><p><small>LOCAȚIE CLIENT</small><strong>{projectItem.address}</strong></p></div>
        <div className={saved ? "saved" : ""}><span>{saved ? "✓" : "○"}</span><p><small>STATUS FIȘĂ</small><strong>{saved ? "Documentație salvată" : "În curs de completare"}</strong></p></div>
      </section>

      <NoInterventionControl
        sectionLabel="Operațiuni site"
        noIntervention={noIntervention}
        reason={noInterventionReason}
        onSelectionChange={setNoIntervention}
        onReasonChange={setNoInterventionReason}
      />

      {noIntervention ? (
        <section className="no-intervention-save-card">
          <span>—</span>
          <div><strong>Site fără intervenție</strong><p>Nu sunt necesare datele ODF/eTN sau fotografiile de execuție. Motivul introdus va fi inclus în raportul lucrării.</p></div>
          <button className="primary-button" onClick={saveOperation}>{saved ? "Actualizează secțiunea" : "Salvează secțiunea"} <span>→</span></button>
        </section>
      ) : <div className="site-operation-layout">
        <section className="site-operation-card">
          <div className="site-operation-head">
            <div><span>↔</span><p><small>LEGĂTURĂ ÎN SITE</small><strong>ODF și echipament eTN</strong></p></div>
            <b>{completedItems}/{requiredItems.length} elemente completate</b>
          </div>

          <div className="site-operation-body">
            <article className="site-endpoint-card odf">
              <div className="site-endpoint-title">
                <span>ODF</span>
                <div><small>PUNCT OPTIC</small><h2>ODF și port</h2><p>Identifică repartitorul optic și poziția utilizată.</p></div>
              </div>
              <div className="site-operation-fields">
                <label>
                  <span>IDENTIFICATOR ODF *</span>
                  <div><i>ODF</i><input value={operation.odf} onChange={(event) => updateField("odf", event.target.value)} placeholder="ex. ODF-B2B-01" /></div>
                </label>
                <label>
                  <span>PORT ODF *</span>
                  <div><i>PT</i><input value={operation.odfPort} onChange={(event) => updateField("odfPort", event.target.value)} placeholder="ex. 12" /></div>
                </label>
              </div>
            </article>

            <div className="site-operation-link"><i /><span>FIBRĂ OPTICĂ</span><i /></div>

            <article className="site-endpoint-card etn">
              <div className="site-endpoint-title">
                <span>eTN</span>
                <div><small>ECHIPAMENT TRANSPORT</small><h2>eTN și port</h2><p>Identifică echipamentul eTN și interfața de conectare.</p></div>
              </div>
              <div className="site-operation-fields">
                <label>
                  <span>IDENTIFICATOR eTN *</span>
                  <div><i>eTN</i><input value={operation.etn} onChange={(event) => updateField("etn", event.target.value)} placeholder="ex. eTN-BUC-02" /></div>
                </label>
                <label>
                  <span>PORT eTN *</span>
                  <div><i>PT</i><input value={operation.etnPort} onChange={(event) => updateField("etnPort", event.target.value)} placeholder="ex. GE0/0/3" /></div>
                </label>
              </div>
            </article>
          </div>

          <section className="site-equipment-section">
            <div className="site-photo-heading">
              <div><span>EQ</span><p><small>ECHIPAMENTE INSTALATE ÎN SITE</small><strong>Media Converter și SFP</strong></p></div>
            </div>
            <div className="site-equipment-grid">
              <div className="site-equipment-choice">
                <label className="switch-card"><span><b>MC</b><small>Media Converter instalat</small></span><input type="checkbox" checked={operation.mediaConverterInstalled} onChange={(event) => setOperation((current) => ({ ...current, mediaConverterInstalled: event.target.checked, mediaConverterType: event.target.checked ? current.mediaConverterType : "" }))} /><i /></label>
                {operation.mediaConverterInstalled && <label className="site-equipment-select"><span>Tip Media Converter *</span><select value={operation.mediaConverterType} onChange={(event) => setOperation((current) => ({ ...current, mediaConverterType: event.target.value as FieldMediaConverterType | "" }))}><option value="">Selectează tipul</option><option value="100 Mbps">100 Mbps</option><option value="1 Gbps">1 Gbps</option><option value="JumboFrame">JumboFrame</option></select></label>}
              </div>
              <div className="site-equipment-choice">
                <label className="switch-card"><span><b>SFP</b><small>SFP instalat</small></span><input type="checkbox" checked={operation.sfpInstalled} onChange={(event) => setOperation((current) => ({ ...current, sfpInstalled: event.target.checked, sfpType: event.target.checked ? current.sfpType : "" }))} /><i /></label>
                {operation.sfpInstalled && <label className="site-equipment-select"><span>Tip SFP *</span><select value={operation.sfpType} onChange={(event) => setOperation((current) => ({ ...current, sfpType: event.target.value as SiteSfpType | "" }))}><option value="">Selectează tipul</option><option>SFP 1Gb B SC</option><option>SFP 1Gb B LC</option><option>SFP 10Gb B LC</option></select></label>}
              </div>
            </div>
          </section>

          <section className="site-photo-section">
            <div className="site-photo-heading">
              <div><span>⌁</span><p><small>DOCUMENTARE FOTO</small><strong>3 fotografii obligatorii</strong></p></div>
              <b>{Object.values(operation.photos).filter(Boolean).length}/3 încărcate</b>
            </div>
            <div className="site-photo-grid">
              {sitePhotoCatalog.map((item) => {
                const photoName = operation.photos[item.key];
                return (
                  <label className={photoName ? "complete" : ""} key={item.key}>
                    <input type="file" accept="image/*" capture="environment" onChange={(event) => capturePhoto(item.key, event.target.files)} />
                    <span>{photoName ? "✓" : item.badge}</span>
                    <div><strong>{item.title} *</strong><small>{photoName || item.description}</small></div>
                    <b>{photoName ? "Schimbă" : "Adaugă foto"}</b>
                  </label>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="site-operation-summary">
          <div className="summary-title"><span>ST</span><div><h2>Fișa operațiunilor</h2><p>{projectItem.id} · {projectItem.client}</p></div></div>
          <div className="site-operation-progress"><div><span>Progres</span><strong>{progress}%</strong></div><i><b style={{ width: `${progress}%` }} /></i></div>
          <div className="site-operation-checklist">
            {checklist.map((item) => <div className={item.value.trim() ? "complete" : ""} key={item.label}><span>{item.value.trim() ? "✓" : "○"}</span><p><small>{item.label}</small><strong>{item.value.trim() || "Necompletat"}</strong></p></div>)}
          </div>
          <div className={`site-operation-status ${ready ? "ready" : ""}`}><span>{ready ? "✓" : "i"}</span><p><strong>{ready ? "Fișă pregătită pentru salvare" : "Completează datele și cele 3 fotografii"}</strong><small>Portul ODF, eTN-ul și fotografia de ansamblu sunt obligatorii.</small></p></div>
          <button className="primary-button site-operation-save" onClick={saveOperation}>{saved ? "Actualizează documentația" : "Salvează documentația"} <span>→</span></button>
        </aside>
      </div>}
    </div>
  );
}
