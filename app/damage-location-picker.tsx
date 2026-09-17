"use client";

import { useMemo, useState, type MouseEvent } from "react";

type Coordinate = { lat: number; lon: number };
type Props = {
  value?: Coordinate;
  onChange: (location: Coordinate) => void;
  onNotify: (message: string) => void;
};

const WIDTH = 1000;
const HEIGHT = 430;
const TILE = 256;
const DEFAULT_CENTER = { lat: 44.4268, lon: 26.1025 };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function project(point: Coordinate, zoom: number) {
  const size = TILE * 2 ** zoom;
  const latitude = clamp(point.lat, -85.05112878, 85.05112878);
  const sin = Math.sin(latitude * Math.PI / 180);
  return { x: (point.lon + 180) / 360 * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

function unproject(point: { x: number; y: number }, zoom: number): Coordinate {
  const size = TILE * 2 ** zoom;
  const longitude = point.x / size * 360 - 180;
  const n = Math.PI - 2 * Math.PI * point.y / size;
  return { lat: 180 / Math.PI * Math.atan(Math.sinh(n)), lon: longitude };
}

export function DamageLocationPicker({ value, onChange, onNotify }: Props) {
  const [center, setCenter] = useState<Coordinate>(value ?? DEFAULT_CENTER);
  const [zoom, setZoom] = useState(15);
  const [locating, setLocating] = useState(false);
  const tiles = useMemo(() => {
    const projectedCenter = project(center, zoom);
    const firstX = Math.floor((projectedCenter.x - WIDTH / 2) / TILE);
    const firstY = Math.floor((projectedCenter.y - HEIGHT / 2) / TILE);
    const lastX = Math.floor((projectedCenter.x + WIDTH / 2) / TILE);
    const lastY = Math.floor((projectedCenter.y + HEIGHT / 2) / TILE);
    const count = 2 ** zoom;
    const result: Array<{ key: string; x: number; y: number; urlX: number; urlY: number }> = [];
    for (let x = firstX; x <= lastX; x += 1) for (let y = firstY; y <= lastY; y += 1) {
      if (y < 0 || y >= count) continue;
      const urlX = ((x % count) + count) % count;
      result.push({ key: `${x}-${y}`, x: x * TILE - projectedCenter.x + WIDTH / 2, y: y * TILE - projectedCenter.y + HEIGHT / 2, urlX, urlY: y });
    }
    return result;
  }, [center, zoom]);

  function place(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const projectedCenter = project(center, zoom);
    const location = unproject({
      x: projectedCenter.x + (event.clientX - rect.left) / rect.width * WIDTH - WIDTH / 2,
      y: projectedCenter.y + (event.clientY - rect.top) / rect.height * HEIGHT - HEIGHT / 2,
    }, zoom);
    onChange(location);
  }

  function locate() {
    if (!navigator.geolocation) return onNotify("Localizarea nu este disponibilă pe acest dispozitiv.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const location = { lat: coords.latitude, lon: coords.longitude };
      setCenter(location);
      setZoom(18);
      onChange(location);
      setLocating(false);
    }, () => {
      setLocating(false);
      onNotify("Locația curentă nu a putut fi identificată.");
    }, { enableHighAccuracy: true, timeout: 15_000 });
  }

  const marker = value ? (() => {
    const point = project(value, zoom);
    const base = project(center, zoom);
    return { left: (point.x - base.x + WIDTH / 2) / WIDTH * 100, top: (point.y - base.y + HEIGHT / 2) / HEIGHT * 100 };
  })() : null;

  return <section className="project-card">
    <div className="card-heading"><div><h2>Locația avariei</h2><p>Atinge poziția avariei pe hartă sau folosește locația curentă.</p></div></div>
    <div role="application" aria-label="Hartă pentru amplasarea avariei" onClick={place} style={{ position: "relative", height: 320, overflow: "hidden", cursor: "crosshair", background: "#dce4e8" }}>
      {tiles.map((tile) => <img key={tile.key} src={`https://tile.openstreetmap.org/${zoom}/${tile.urlX}/${tile.urlY}.png`} alt="" draggable={false} style={{ position: "absolute", left: `${tile.x / WIDTH * 100}%`, top: `${tile.y / HEIGHT * 100}%`, width: `${TILE / WIDTH * 100}%`, height: `${TILE / HEIGHT * 100}%` }} />)}
      {marker && <span style={{ position: "absolute", left: `${marker.left}%`, top: `${marker.top}%`, width: 22, height: 22, borderRadius: "50%", background: "#e5484d", border: "4px solid white", boxShadow: "0 2px 8px #0008", transform: "translate(-50%, -50%)" }} />}
      <div style={{ position: "absolute", right: 10, top: 10, display: "grid", gap: 4 }} onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setZoom((current) => clamp(current + 1, 7, 19))}>＋</button><button type="button" onClick={() => setZoom((current) => clamp(current - 1, 7, 19))}>−</button></div>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} style={{ position: "absolute", right: 4, bottom: 3, background: "#fffc", fontSize: 10 }}>© OpenStreetMap</a>
    </div>
    <div className="fo-map-footer"><button type="button" onClick={locate} disabled={locating}><span>⌖</span>{locating ? "Se caută GPS…" : "Folosește locația curentă"}</button></div>
    <p style={{ padding: "10px 14px", margin: 0, fontWeight: 700 }}>{value ? `Coordonate: ${value.lat.toFixed(6)}, ${value.lon.toFixed(6)}` : "Locația avariei nu a fost încă amplasată."}</p>
  </section>;
}
