"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchMapSites, mapSiteMarkerClass, type MapSiteRow } from "./map-sites-client";
import { MapSiteLegend } from "./map-site-legend";
import { useMapGestures } from "./use-map-gestures";
import { useMapFullscreen } from "./use-map-fullscreen";

type Coordinate = { lat: number; lon: number };
type SelectedPoint = Coordinate & { code?: string; title: string; detail: string };

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;
const TILE_SIZE = 256;
const DEFAULT_CENTER: Coordinate = { lat: 44.4268, lon: 26.1025 };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function project(point: Coordinate, zoom: number) {
  const size = TILE_SIZE * 2 ** zoom;
  const latitude = clamp(point.lat, -85.05112878, 85.05112878);
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

function unproject(point: { x: number; y: number }, zoom: number): Coordinate {
  const size = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: longitude };
}

function screenPoint(point: Coordinate, center: Coordinate, zoom: number) {
  const projected = project(point, zoom);
  const projectedCenter = project(center, zoom);
  return {
    x: projected.x - projectedCenter.x + MAP_WIDTH / 2,
    y: projected.y - projectedCenter.y + MAP_HEIGHT / 2,
  };
}

function lowerLatitudeBound(rows: MapSiteRow[], latitude: number) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle][3] < latitude) low = middle + 1;
    else high = middle;
  }
  return low;
}

function googleMapsUrl(point: Coordinate) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lon}`)}`;
}

export function TechnicianMap() {
  const [sites, setSites] = useState<MapSiteRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(14);
  const [siteCode, setSiteCode] = useState("");
  const [address, setAddress] = useState("");
  const [addressResults, setAddressResults] = useState<SelectedPoint[]>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const [locating, setLocating] = useState(false);
  const mapFullscreen = useMapFullscreen();

  useEffect(() => {
    let active = true;
    fetchMapSites()
      .then((payload) => {
        if (!active) return;
        setSites(payload.sites);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const gestures = useMapGestures({
    center,
    zoom,
    setCenter,
    setZoom,
    project,
    unproject,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    minimumZoom: 7,
    maximumZoom: 20,
    mousePan: true,
  });

  const tiles = useMemo(() => {
    const sourceZoom = Math.min(zoom, 19);
    const scale = 2 ** (zoom - sourceZoom);
    const tileSize = TILE_SIZE * scale;
    const projectedCenter = project(center, zoom);
    const tilesAcross = 2 ** sourceZoom;
    const firstX = Math.floor((projectedCenter.x - MAP_WIDTH / 2) / tileSize);
    const lastX = Math.floor((projectedCenter.x + MAP_WIDTH / 2) / tileSize);
    const firstY = Math.floor((projectedCenter.y - MAP_HEIGHT / 2) / tileSize);
    const lastY = Math.floor((projectedCenter.y + MAP_HEIGHT / 2) / tileSize);
    const result: Array<{ key: string; x: number; y: number; size: number; sourceZoom: number; urlX: number; urlY: number }> = [];
    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        if (y < 0 || y >= tilesAcross) continue;
        result.push({
          key: `${zoom}-${x}-${y}`,
          x: x * tileSize - (projectedCenter.x - MAP_WIDTH / 2),
          y: y * tileSize - (projectedCenter.y - MAP_HEIGHT / 2),
          size: tileSize,
          sourceZoom,
          urlX: ((x % tilesAcross) + tilesAcross) % tilesAcross,
          urlY: y,
        });
      }
    }
    return result;
  }, [center, zoom]);

  const visibleSites = useMemo(() => {
    const projectedCenter = project(center, zoom);
    const northWest = unproject({ x: projectedCenter.x - MAP_WIDTH / 2, y: projectedCenter.y - MAP_HEIGHT / 2 }, zoom);
    const southEast = unproject({ x: projectedCenter.x + MAP_WIDTH / 2, y: projectedCenter.y + MAP_HEIGHT / 2 }, zoom);
    const minLat = Math.min(northWest.lat, southEast.lat);
    const maxLat = Math.max(northWest.lat, southEast.lat);
    const minLon = Math.min(northWest.lon, southEast.lon);
    const maxLon = Math.max(northWest.lon, southEast.lon);
    const first = lowerLatitudeBound(sites, minLat);
    const last = lowerLatitudeBound(sites, maxLat + Number.EPSILON);
    const stride = Math.max(1, Math.ceil((last - first) / 5000));
    const candidates: Array<{ row: MapSiteRow; index: number; point: { x: number; y: number } }> = [];
    for (let index = first; index < last; index += stride) {
      const row = sites[index];
      if (row[4] < minLon || row[4] > maxLon) continue;
      const point = screenPoint({ lat: row[3], lon: row[4] }, center, zoom);
      if (point.x > -20 && point.x < MAP_WIDTH + 20 && point.y > -20 && point.y < MAP_HEIGHT + 20) candidates.push({ row, index, point });
    }
    return candidates
      .sort((left, right) => ((left.point.x - MAP_WIDTH / 2) ** 2 + (left.point.y - MAP_HEIGHT / 2) ** 2) - ((right.point.x - MAP_WIDTH / 2) ** 2 + (right.point.y - MAP_HEIGHT / 2) ** 2))
      .slice(0, 180);
  }, [center, sites, zoom]);

  function selectSite(row: MapSiteRow) {
    const point = { lat: row[3], lon: row[4] };
    setCenter(point);
    setZoom(18);
    setSelected({ ...point, code: row[0], title: row[0], detail: [row[1], row[2]].filter(Boolean).join(" · ") });
    setMessage("");
  }

  function searchSite(event: FormEvent) {
    event.preventDefault();
    const query = siteCode.trim().toLocaleUpperCase("ro-RO");
    if (!query) return;
    const row = sites.find((item) => item[0].trim().toLocaleUpperCase("ro-RO") === query);
    if (!row) {
      setMessage(`Codul „${siteCode.trim()}” nu a fost găsit exact în registru.`);
      return;
    }
    selectSite(row);
  }

  function locateCurrentPosition() {
    if (!navigator.geolocation) {
      setMessage("Localizarea nu este disponibilă pe acest dispozitiv.");
      return;
    }
    setLocating(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point: SelectedPoint = {
          lat: coords.latitude,
          lon: coords.longitude,
          title: "Locația curentă",
          detail: `Precizie aproximativă ±${Math.round(coords.accuracy)} m`,
        };
        setCenter(point);
        setZoom(18);
        setSelected(point);
        setLocating(false);
      },
      () => {
        setMessage("Locația nu a putut fi detectată. Verifică permisiunea GPS pentru aplicație.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 },
    );
  }

  async function searchAddress(event: FormEvent) {
    event.preventDefault();
    const query = address.trim();
    if (query.length < 3) return;
    setSearchingAddress(true);
    setMessage("");
    setAddressResults([]);
    try {
      const response = await fetch(`/api/geocode?${new URLSearchParams({ q: query }).toString()}`, { cache: "no-store" });
      const payload = await response.json() as { results?: Array<{ title: string; lat: number; lon: number }>; error?: string };
      if (!response.ok) throw new Error(payload.error || "Adresa nu a putut fi căutată.");
      const results = (payload.results ?? []).map((item) => ({ title: item.title, detail: "Rezultat adresă", lat: item.lat, lon: item.lon }));
      setAddressResults(results);
      if (results[0]) {
        setCenter({ lat: results[0].lat, lon: results[0].lon });
        setZoom(17);
        setSelected(results[0]);
      } else setMessage("Nu a fost găsită nicio adresă.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Adresa nu a putut fi căutată.");
    } finally {
      setSearchingAddress(false);
    }
  }

  return (
    <div className="page-wrap technician-map-page">
      <section className="page-heading">
        <div><p className="eyebrow">REGISTRU ȘI ORIENTARE</p><h1>Hartă</h1><p>Caută locații după adresa completă sau după codul exact al site-ului.</p></div>
      </section>
      <section className="technician-map-searches">
        <form onSubmit={searchAddress}>
          <label><span>Caută după adresă</span><div><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Stradă, număr, localitate" /><button type="submit" disabled={searchingAddress}>{searchingAddress ? "Se caută…" : "Caută"}</button></div></label>
        </form>
        <form onSubmit={searchSite}>
          <label><span>Caută după codul site-ului</span><div><input value={siteCode} onChange={(event) => setSiteCode(event.target.value)} placeholder="ex. J2, JU6593, L0931-19" /><button type="submit" disabled={status !== "ready"}>Caută</button></div></label>
        </form>
      </section>
      {message && <p className="technician-map-message">{message}</p>}
      {addressResults.length > 1 && <div className="technician-address-results">{addressResults.map((result) => <button key={`${result.lat}-${result.lon}`} onClick={() => { setSelected(result); setCenter(result); setZoom(17); }}><strong>{result.title}</strong><small>Arată pe hartă</small></button>)}</div>}
      <section className={`fo-map-card technician-map-card ${mapFullscreen.fullscreen ? "map-fullscreen" : ""}`}>
        <div className="fo-map-head">
          <div><small>HARTĂ SITE-URI</small><strong>{status === "loading" ? "Se încarcă registrul…" : status === "error" ? "Registrul nu este disponibil" : `${sites.length.toLocaleString("ro-RO")} puncte disponibile`}</strong></div>
          <div className="technician-map-controls">
            <button className="technician-location-button" onClick={locateCurrentPosition} disabled={locating}><span>⌖</span>{locating ? "Se localizează…" : "Locația curentă"}</button>
            <div className="technician-map-zoom"><button onClick={() => setZoom((value) => Math.min(20, value + 1))} aria-label="Mărește harta">＋</button><button onClick={() => setZoom((value) => Math.max(7, value - 1))} aria-label="Micșorează harta">−</button></div>
            <button className="fo-fullscreen-toggle" onClick={mapFullscreen.toggleFullscreen} aria-pressed={mapFullscreen.fullscreen}><span>{mapFullscreen.fullscreen ? "×" : "⛶"}</span>{mapFullscreen.fullscreen ? "Închide" : "Ecran complet"}</button>
          </div>
        </div>
        <div className="fo-map mode-pan" role="application" aria-label="Hartă site-uri" onPointerDown={gestures.onPointerDown} onPointerMove={gestures.onPointerMove} onPointerUp={gestures.onPointerUp} onPointerCancel={gestures.onPointerCancel} onWheel={gestures.onWheel}>
          <div className="fo-map-tiles" aria-hidden="true">{tiles.map((tile) => <img key={tile.key} src={`https://tile.openstreetmap.org/${tile.sourceZoom}/${tile.urlX}/${tile.urlY}.png`} alt="" draggable={false} style={{ left: `${(tile.x / MAP_WIDTH) * 100}%`, top: `${(tile.y / MAP_HEIGHT) * 100}%`, width: `${(tile.size / MAP_WIDTH) * 100}%`, height: `${(tile.size / MAP_HEIGHT) * 100}%` }} />)}</div>
          {visibleSites.map(({ row, index, point }) => <button className={`fo-site-marker ${mapSiteMarkerClass(row[0])} ${selected?.code === row[0] ? "selected" : ""}`} style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }} key={`${row[0]}-${index}`} title={`${row[0]} · ${row[1]}`} onClick={(event) => { event.stopPropagation(); selectSite(row); }}><i /></button>)}
          {selected && !selected.code && (() => { const point = screenPoint(selected, center, zoom); return <span className="technician-address-marker" style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }}>⌖</span>; })()}
          <div className="fo-map-instruction"><span>✥</span>Glisează harta · folosește pinch zoom</div>
        </div>
        <div className="fo-map-footer"><MapSiteLegend /></div>
      </section>
      {selected && <section className="technician-map-selection"><div><small>{selected.code ? "COD SITE" : "ADRESĂ SELECTATĂ"}</small><strong>{selected.title}</strong><p>{selected.detail}</p><span>{selected.lat.toFixed(6)}, {selected.lon.toFixed(6)}</span></div><a href={googleMapsUrl(selected)} target="_blank" rel="noreferrer">Google Maps ↗</a></section>}
    </div>
  );
}
