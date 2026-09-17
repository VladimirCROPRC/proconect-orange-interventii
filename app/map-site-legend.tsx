export function MapSiteLegend() {
  return (
    <div className="map-site-legend" aria-label="Legenda punctelor de pe hartă">
      <span><i className="mobile" />Roșu — Joncțiuni Orange Mobil</span>
      <span><i className="fixed" />Albastru — Joncțiuni Orange Fixed</span>
      <span><i className="clients" />Negru — Clienți</span>
      <span><i className="sites" />Verde — Site-uri</span>
    </div>
  );
}
