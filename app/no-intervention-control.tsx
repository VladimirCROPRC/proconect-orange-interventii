"use client";

type Props = {
  sectionLabel: string;
  noIntervention: boolean;
  reason: string;
  onSelectionChange: (value: boolean) => void;
  onReasonChange: (value: string) => void;
};

export function NoInterventionControl({ sectionLabel, noIntervention, reason, onSelectionChange, onReasonChange }: Props) {
  return (
    <section className={`no-intervention-control ${noIntervention ? "selected" : ""}`}>
      <div className="no-intervention-heading">
        <div><small>STATUS SECȚIUNE</small><strong>S-a intervenit în {sectionLabel}?</strong></div>
        <span>{noIntervention ? "MOTIV OBLIGATORIU" : "EXECUȚIE ÎN TEREN"}</span>
      </div>
      <div className="no-intervention-options" role="radiogroup" aria-label={`Intervenție în ${sectionLabel}`}>
        <button type="button" className={!noIntervention ? "active" : ""} role="radio" aria-checked={!noIntervention} onClick={() => onSelectionChange(false)}>
          <span>✓</span><p><strong>S-a intervenit</strong><small>Completează execuția și fotografiile obligatorii</small></p>
        </button>
        <button type="button" className={noIntervention ? "active no-work" : ""} role="radio" aria-checked={noIntervention} onClick={() => onSelectionChange(true)}>
          <span>—</span><p><strong>Nu s-a intervenit</strong><small>Înregistrează motivul fără fotografii de execuție</small></p>
        </button>
      </div>
      {noIntervention && (
        <label className="no-intervention-reason">
          <span>Motivul neintervenției *</span>
          <textarea
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="Descrie clar motivul pentru care nu s-a intervenit în această secțiune…"
            maxLength={2000}
            rows={4}
          />
          <small>{reason.trim().length ? `${reason.trim().length}/2000 caractere` : "Câmp obligatoriu pentru salvare"}</small>
        </label>
      )}
    </section>
  );
}
