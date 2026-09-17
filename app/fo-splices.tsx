"use client";

import { useDeferredValue, useEffect, useMemo, useState, type MouseEvent } from "react";
import { deleteProjectFile, fetchProjectFiles, uploadProjectFile } from "./client-storage";
import type { SpliceConnection, SpliceFieldSummary } from "./field-documentation";
import { NoInterventionControl } from "./no-intervention-control";
import { useMapGestures } from "./use-map-gestures";
import { useMapFullscreen } from "./use-map-fullscreen";
import { fetchMapSites, mapSiteMarkerClass } from "./map-sites-client";
import { MapSiteLegend } from "./map-site-legend";

type Coordinate = { lat: number; lon: number };
type OrangeNetworkSiteRow = [code: string, description: string, region: string, lat: number, lon: number];
type OrangeNetworkPayload = { source: string; valid: number; sites: OrangeNetworkSiteRow[] };
type JunctionKind = "" | "existing" | "new";
type JunctionNetwork = "" | "mobile" | "fixed";
type SelectMode = "documented" | "undocumented";
type SplicePhotoKey = "open" | "closed" | "placed";

type SpliceProject = {
  id: string;
  client: string;
  address: string;
  technician: string;
  splice: string;
};

type Junction = Coordinate & {
  id: string;
  code: string;
  name: string;
  region: string;
  documented: boolean;
};

type SpliceRecord = {
  id: string;
  projectId: string;
  junction: Junction;
  junctionKind: JunctionKind;
  network: JunctionNetwork;
  folderName?: string;
  siteCableType?: string;
  clientCableType?: string;
  spliceMode?: "fiber" | "end-to-end";
  spliceCount?: number;
  connections?: SpliceConnection[];
  siteBuffer: string;
  siteFiber: string;
  clientBuffer: string;
  clientFiber: string;
  photos: Record<SplicePhotoKey, string>;
};

type Props = {
  project: SpliceProject;
  initialSummary?: SpliceFieldSummary;
  onNotify: (message: string) => void;
  onSaved?: (summary: SpliceFieldSummary) => Promise<void> | void;
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;
const TILE_SIZE = 256;
const DEFAULT_CENTER: Coordinate = { lat: 44.4268, lon: 26.1025 };
const fiberColors = ["Albastru", "Portocaliu", "Verde", "Maro", "Gri", "Alb", "Roșu", "Negru", "Galben", "Violet", "Roz", "Turcoaz"];
const colorHex: Record<string, string> = {
  Albastru: "#2874c6",
  Portocaliu: "#ee8a24",
  Verde: "#2f9d62",
  Maro: "#8a5a3b",
  Gri: "#89909d",
  Alb: "#ffffff",
  Roșu: "#d94d55",
  Negru: "#252a33",
  Galben: "#e5bd28",
  Violet: "#8159be",
  Roz: "#dc77a4",
  Turcoaz: "#23a9a5",
};
const splicePhotoCatalog: Record<SplicePhotoKey, { title: string; description: string; badge: string }> = {
  open: { title: "Joncțiunea deschisă", description: "Interiorul joncțiunii și caseta de suduri vizibile.", badge: "DES" },
  closed: { title: "Joncțiunea închisă", description: "Joncțiunea închisă și securizată după intervenție.", badge: "ÎNC" },
  placed: { title: "Joncțiunea amplasată", description: "Poziția finală pe stâlp sau în camereta de telecomunicații.", badge: "LOC" },
};
const splicePhotoKeys = Object.keys(splicePhotoCatalog) as SplicePhotoKey[];

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

function lowerLatitudeBound(rows: OrangeNetworkSiteRow[], latitude: number) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle][3] < latitude) low = middle + 1;
    else high = middle;
  }
  return low;
}

function siteFromRow(row: OrangeNetworkSiteRow, index: number): Junction {
  return {
    id: `splice-site-${index}`,
    code: row[0],
    name: row[1] || `Site ${row[0]}`,
    region: row[2],
    lat: row[3],
    lon: row[4],
    documented: true,
  };
}

function formatCoordinate(point: Coordinate) {
  return `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
}

function googleMapsUrl(point: Coordinate) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lon}`)}`;
}

function FiberSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="splice-color-field">
      <span>{label} *</span>
      <div>
        <i className={value === "Alb" ? "white" : ""} style={{ background: value ? colorHex[value] : "#e7e9ef" }} />
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Selectează culoarea</option>
          {fiberColors.map((color) => <option key={color}>{color}</option>)}
        </select>
      </div>
    </label>
  );
}

export function FoSplicesSection({ project: projectItem, initialSummary, onNotify, onSaved }: Props) {
  const [sites, setSites] = useState<OrangeNetworkSiteRow[]>([]);
  const [sitesStatus, setSitesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(15);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<(Coordinate & { accuracy: number }) | null>(null);
  const [mode, setMode] = useState<SelectMode>("documented");
  const [creating, setCreating] = useState(false);
  const [junction, setJunction] = useState<Junction | null>(null);
  const [junctionKind, setJunctionKind] = useState<JunctionKind>("");
  const [network, setNetwork] = useState<JunctionNetwork>("");
  const [siteCableType, setSiteCableType] = useState("");
  const [clientCableType, setClientCableType] = useState("");
  const [spliceMode, setSpliceMode] = useState<"fiber" | "end-to-end">("fiber");
  const [spliceCount, setSpliceCount] = useState<number | "">("");
  const [connections, setConnections] = useState<SpliceConnection[]>([]);
  const [splicePhotos, setSplicePhotos] = useState<Partial<Record<SplicePhotoKey, string>>>({});
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState("");
  const [deletingRecord, setDeletingRecord] = useState("");
  const [records, setRecords] = useState<SpliceRecord[]>([]);
  const [noIntervention, setNoIntervention] = useState(false);
  const [noInterventionReason, setNoInterventionReason] = useState("");
  const deferredSearch = useDeferredValue(search);
  const mapGestures = useMapGestures({
    center,
    zoom,
    setCenter,
    setZoom,
    project,
    unproject,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    maximumZoom: 25,
  });
  const mapFullscreen = useMapFullscreen();

  useEffect(() => {
    let active = true;
    fetchMapSites().then((payload) => {
        if (!active) return;
        setSites(payload.sites);
        setSitesStatus("ready");
      })
      .catch(() => active && setSitesStatus("error"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      resetDraft();
      setCreating(false);
      setRecords(initialSummary?.records ?? []);
      setNoIntervention(Boolean(initialSummary?.noIntervention));
      setNoInterventionReason(initialSummary?.noInterventionReason ?? "");
    });
    return () => {
      active = false;
    };
  }, [projectItem.id, initialSummary]);

  const tiles = useMemo(() => {
    const sourceZoom = Math.min(zoom, 19);
    const overzoomScale = 2 ** (zoom - sourceZoom);
    const renderedTileSize = TILE_SIZE * overzoomScale;
    const projectedCenter = project(center, zoom);
    const tilesAcross = 2 ** sourceZoom;
    const firstX = Math.floor((projectedCenter.x - MAP_WIDTH / 2) / renderedTileSize);
    const lastX = Math.floor((projectedCenter.x + MAP_WIDTH / 2) / renderedTileSize);
    const firstY = Math.floor((projectedCenter.y - MAP_HEIGHT / 2) / renderedTileSize);
    const lastY = Math.floor((projectedCenter.y + MAP_HEIGHT / 2) / renderedTileSize);
    const result: Array<{ key: string; x: number; y: number; size: number; sourceZoom: number; urlX: number; urlY: number }> = [];
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      for (let tileY = firstY; tileY <= lastY; tileY += 1) {
        if (tileY < 0 || tileY >= tilesAcross) continue;
        result.push({
          key: `${zoom}-${tileX}-${tileY}`,
          x: tileX * renderedTileSize - (projectedCenter.x - MAP_WIDTH / 2),
          y: tileY * renderedTileSize - (projectedCenter.y - MAP_HEIGHT / 2),
          size: renderedTileSize,
          sourceZoom,
          urlX: ((tileX % tilesAcross) + tilesAcross) % tilesAcross,
          urlY: tileY,
        });
      }
    }
    return result;
  }, [center, zoom]);

  const visibleSites = useMemo(() => {
    const projectedCenter = project(center, zoom);
    const northWest = unproject({ x: projectedCenter.x - MAP_WIDTH / 2, y: projectedCenter.y - MAP_HEIGHT / 2 }, zoom);
    const southEast = unproject({ x: projectedCenter.x + MAP_WIDTH / 2, y: projectedCenter.y + MAP_HEIGHT / 2 }, zoom);
    const minimumLatitude = Math.min(northWest.lat, southEast.lat);
    const maximumLatitude = Math.max(northWest.lat, southEast.lat);
    const minimumLongitude = Math.min(northWest.lon, southEast.lon);
    const maximumLongitude = Math.max(northWest.lon, southEast.lon);
    const first = lowerLatitudeBound(sites, minimumLatitude);
    const last = lowerLatitudeBound(sites, maximumLatitude + Number.EPSILON);
    const stride = Math.max(1, Math.ceil((last - first) / 4000));
    const result: Array<{ site: Junction; point: { x: number; y: number } }> = [];
    for (let index = first; index < last; index += stride) {
      const row = sites[index];
      if (row[4] < minimumLongitude || row[4] > maximumLongitude) continue;
      const site = siteFromRow(row, index);
      const point = screenPoint(site, center, zoom);
      if (point.x > -20 && point.x < MAP_WIDTH + 20 && point.y > -20 && point.y < MAP_HEIGHT + 20) result.push({ site, point });
    }
    return result.slice(0, 140);
  }, [center, sites, zoom]);

  const searchResults = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase("ro");
    if (query.length < 2) return [];
    const exactMatches: Junction[] = [];
    for (let index = 0; index < sites.length; index += 1) {
      const site = siteFromRow(sites[index], index);
      if (site.code.trim().toLocaleLowerCase("ro") === query) exactMatches.push(site);
    }
    return exactMatches.slice(0, 6);
  }, [deferredSearch, sites]);

  const projectRecords = records.filter((record) => record.projectId === projectItem.id);
  const cableTypesReady = Boolean(siteCableType.trim() && clientCableType.trim());
  const spliceCountReady = typeof spliceCount === "number" && Number.isInteger(spliceCount) && spliceCount >= 1 && spliceCount <= 96;
  const colorsReady = spliceCountReady && connections.length === spliceCount && connections.every((connection) =>
    Boolean(connection.siteBuffer && connection.clientBuffer && (spliceMode === "end-to-end" || (connection.siteFiber && connection.clientFiber))),
  );
  const completedSplicePhotos = splicePhotoKeys.filter((key) => Boolean(splicePhotos[key])).length;
  const photosReady = completedSplicePhotos === splicePhotoKeys.length;
  const junctionReady = Boolean(junction && (junction.documented || (junctionKind && network)));

  function resetDraft() {
    setJunction(null);
    setJunctionKind("");
    setNetwork("");
    setSiteCableType("");
    setClientCableType("");
    setSpliceMode("fiber");
    setSpliceCount("");
    setConnections([]);
    setSplicePhotos({});
    setDraftId(crypto.randomUUID());
    setSearch("");
    setMode("documented");
  }

  function startNewSplice() {
    const preselectedJunction = junction?.documented ? junction : null;
    resetDraft();
    if (preselectedJunction) {
      setJunction(preselectedJunction);
      setCenter({ lat: preselectedJunction.lat, lon: preselectedJunction.lon });
      setZoom((current) => Math.max(current, 18));
    }
    setCreating(true);
    onNotify(preselectedJunction
      ? `Sudură nouă inițiată în joncțiunea ${preselectedJunction.code}.`
      : "Sudură nouă inițiată. Selectează joncțiunea pe hartă.");
  }

  function chooseDocumented(site: Junction) {
    setJunction(site);
    setJunctionKind("");
    setNetwork("");
    setCenter({ lat: site.lat, lon: site.lon });
    setZoom((current) => Math.max(current, creating ? 15 : 18));
    if (creating) setSearch("");
    if (!creating) onNotify(`${site.code} a fost găsită. Poți verifica punctul pe hartă sau porni „Sudură nouă”.`);
  }

  function handleMapClick(event: MouseEvent<HTMLDivElement>) {
    if (mapGestures.consumeSuppressedClick() || !creating || mode !== "undocumented") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: project(center, zoom).x + ((event.clientX - rect.left) / rect.width) * MAP_WIDTH - MAP_WIDTH / 2,
      y: project(center, zoom).y + ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT - MAP_HEIGHT / 2,
    };
    const coordinate = unproject(point, zoom);
    setJunction({ ...coordinate, id: `undocumented-${Date.now()}`, code: "Fără cod", name: "Joncțiune nedocumentată", region: "Punct introdus pe hartă", documented: false });
    setJunctionKind("");
    setNetwork("");
  }

  function locateCurrentPosition() {
    if (!window.isSecureContext) {
      onNotify("Localizarea GPS necesită deschiderea aplicației prin conexiune securizată HTTPS.");
      return;
    }
    if (!navigator.geolocation) {
      onNotify("Localizarea GPS nu este disponibilă pe acest dispozitiv.");
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinate = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
        setCurrentLocation(coordinate);
        setCenter(coordinate);
        setZoom(17);
        setGpsLoading(false);
        onNotify(`Locația curentă a fost identificată pe harta sudurilor · precizie ±${Math.round(coords.accuracy)} m.`);
      },
      (error) => {
        setGpsLoading(false);
        const message = error.code === 1
          ? "Accesul la locație este blocat. Permite locația din setările browserului."
          : error.code === 3
            ? "Localizarea a durat prea mult. Încearcă din nou într-o zonă cu semnal GPS."
            : "Poziția curentă nu a putut fi determinată. Încearcă din nou.";
        onNotify(message);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
    );
  }

  async function captureSplicePhoto(key: SplicePhotoKey, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!junction) {
      onNotify("Selectează mai întâi joncțiunea pentru această sudură.");
      return;
    }
    setSplicePhotos((current) => ({ ...current, [key]: file.name }));
    try {
      const previousUndocumentedNumbers = projectRecords.filter((record) => !record.junction.documented).map((record, index) => Number(record.folderName?.match(/(\d+)$/)?.[1] ?? index + 1));
      const undocumentedIndex = Math.max(0, ...previousUndocumentedNumbers) + 1;
      const folderToken = junction?.documented
        ? junction.code.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 45)
        : `J_nedocumentata_${undocumentedIndex}`;
      const stored = await uploadProjectFile({ projectId: projectItem.id, section: "splices", category: `${draftId}:${folderToken}:${key}`, file });
      setSplicePhotos((current) => ({ ...current, [key]: stored.name }));
    } catch (error) {
      setSplicePhotos((current) => ({ ...current, [key]: "" }));
      onNotify(error instanceof Error ? error.message : "Fotografia sudurii nu a putut fi salvată.");
    }
  }

  async function openDiagram() {
    try {
      const files = await fetchProjectFiles(projectItem.id, "project");
      const diagram = [...files].reverse().find((file) => file.category === "splice-diagram");
      if (!diagram) throw new Error("Diagrama nu a fost încărcată în stocarea permanentă.");
      window.open(diagram.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Diagrama de suduri nu a putut fi deschisă.");
    }
  }

  async function saveSplice() {
    if (!junction) {
      onNotify("Selectează joncțiunea documentată sau plasează una nedocumentată pe hartă.");
      return;
    }
    if (!junction.documented && !junctionKind) {
      onNotify("Alege dacă joncțiunea nedocumentată este existentă sau nou instalată.");
      return;
    }
    if (!junction.documented && !network) {
      onNotify("Alege rețeaua Orange Mobil sau Orange Fixed.");
      return;
    }
    if (!cableTypesReady) {
      onNotify("Completează tipul de cablu spre site și spre client.");
      return;
    }
    if (!spliceCountReady) {
      onNotify(spliceMode === "end-to-end" ? "Introdu un număr de buffere între 1 și 96." : "Introdu un număr de suduri între 1 și 96.");
      return;
    }
    if (!colorsReady) {
      onNotify(spliceMode === "end-to-end" ? "Completează bufferele pentru toate sudurile cap–cap." : "Completează bufferul și fibra pentru fiecare sudură.");
      return;
    }
    if (!photosReady) {
      onNotify(`Mai sunt necesare ${splicePhotoKeys.length - completedSplicePhotos} fotografii obligatorii pentru această sudură.`);
      return;
    }
    const newRecord: SpliceRecord = {
      id: draftId,
      projectId: projectItem.id,
      junction,
      junctionKind,
      network,
      folderName: junction.documented ? junction.code : `J nedocumentată ${Math.max(0, ...projectRecords.filter((record) => !record.junction.documented).map((record, index) => Number(record.folderName?.match(/(\d+)$/)?.[1] ?? index + 1))) + 1}`,
      siteCableType: siteCableType.trim(),
      clientCableType: clientCableType.trim(),
      spliceMode,
      spliceCount: typeof spliceCount === "number" ? spliceCount : 1,
      connections,
      siteBuffer: connections[0]?.siteBuffer ?? "",
      siteFiber: spliceMode === "fiber" ? connections[0]?.siteFiber ?? "" : "",
      clientBuffer: connections[0]?.clientBuffer ?? "",
      clientFiber: spliceMode === "fiber" ? connections[0]?.clientFiber ?? "" : "",
      photos: {
        open: splicePhotos.open!,
        closed: splicePhotos.closed!,
        placed: splicePhotos.placed!,
      },
    };
    const nextProjectRecords = [...projectRecords, newRecord];
    const summary: SpliceFieldSummary = {
      noIntervention: false,
      noInterventionReason: "",
      count: nextProjectRecords.reduce((total, record) => total + (record.spliceCount ?? 1), 0),
      junctions: nextProjectRecords.map((record) => ({
        label: record.junction.documented ? `${record.junction.code} · ${record.junction.name}` : "Joncțiune nedocumentată",
        documented: record.junction.documented,
        kind: record.junction.documented ? "documented" : record.junctionKind as "existing" | "new",
      })),
      records: nextProjectRecords,
    };
    try {
      await onSaved?.(summary);
      setRecords(nextProjectRecords);
      setCreating(false);
      onNotify(`Sudura din ${junction.documented ? junction.code : "joncțiunea nedocumentată"} a fost salvată permanent.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Sudura nu a putut fi salvată.");
    }
  }

  async function deleteSpliceRecord(record: SpliceRecord) {
    if (!window.confirm("Ștergi această sudură FO și cele 3 fotografii aferente?")) return;
    setDeletingRecord(record.id);
    try {
      const nextProjectRecords = projectRecords.filter((item) => item.id !== record.id);
      const summary: SpliceFieldSummary = {
        noIntervention: false,
        noInterventionReason: "",
        count: nextProjectRecords.reduce((total, item) => total + (item.spliceCount ?? 1), 0),
        junctions: nextProjectRecords.map((item) => ({
          label: item.junction.documented ? `${item.junction.code} · ${item.junction.name}` : "Joncțiune nedocumentată",
          documented: item.junction.documented,
          kind: item.junction.documented ? "documented" : item.junctionKind as "existing" | "new",
        })),
        records: nextProjectRecords,
      };
      const storedFiles = await fetchProjectFiles(projectItem.id, "splices");
      const attached = storedFiles.filter((file) => file.category.startsWith(`${record.id}:`));
      const removals = await Promise.allSettled(attached.map((file) => deleteProjectFile(file.id)));
      const failed = removals.filter((result) => result.status === "rejected").length;
      if (failed) throw new Error(`${failed} fotografii nu au putut fi șterse din toate destinațiile. Reîncearcă ștergerea sudurii.`);
      await onSaved?.(summary);
      setRecords(nextProjectRecords);
      onNotify("Sudura FO și fotografiile aferente au fost șterse din aplicație, Google Drive și OneDrive.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Sudura FO nu a putut fi ștearsă.");
    } finally {
      setDeletingRecord("");
    }
  }

  async function saveNoIntervention() {
    const reason = noInterventionReason.trim();
    if (!reason) {
      onNotify("Completează motivul pentru care nu s-a intervenit la sudurile FO.");
      return;
    }
    const summary: SpliceFieldSummary = {
      noIntervention: true,
      noInterventionReason: reason,
      count: 0,
      junctions: [],
      records: [],
    };
    try {
      await onSaved?.(summary);
      setRecords([]);
      setCreating(false);
      onNotify(`Secțiunea Suduri FO pentru ${projectItem.id} a fost salvată ca „Nu s-a intervenit”.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Secțiunea Suduri FO nu a putut fi salvată.");
    }
  }

  return (
    <div className="page-wrap splice-page">
      <section className="page-heading client-heading">
        <div>
          <p className="eyebrow">DOCUMENTAȚIE FIBRĂ OPTICĂ</p>
          <h1>Suduri FO</h1>
          <p>Alege joncțiunea și documentează continuitatea fibrei între site și client.</p>
        </div>
        {!noIntervention && <button className="primary-button" onClick={startNewSplice}><span>＋</span> Sudură nouă</button>}
      </section>

      <section className="splice-project-bar">
        <div className="splice-project-copy"><span>RID</span><div><small>PROIECT ACTIV</small><strong>{projectItem.id}</strong><p>{projectItem.client}</p></div></div>
        <div className="splice-technician"><span>{projectItem.technician.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span><div><small>TEHNICIAN</small><strong>{projectItem.technician}</strong></div></div>
        <div className="splice-diagram">
          <span>FO</span>
          <div><small>DIAGRAMA DE SUDURI</small><strong>{projectItem.splice}</strong><p>Disponibilă tehnicianului pentru această lucrare</p></div>
          <button disabled={projectItem.splice === "Fișier neîncărcat"} onClick={() => void openDiagram()}>Deschide ↗</button>
        </div>
      </section>

      <NoInterventionControl
        sectionLabel="Suduri FO"
        noIntervention={noIntervention}
        reason={noInterventionReason}
        onSelectionChange={(value) => { setNoIntervention(value); if (value) { resetDraft(); setCreating(false); } }}
        onReasonChange={setNoInterventionReason}
      />

      {noIntervention ? (
        <section className="no-intervention-save-card">
          <span>—</span>
          <div><strong>Suduri FO fără intervenție</strong><p>Nu sunt necesare selectarea joncțiunii, culorile fibrelor sau fotografiile de execuție. Motivul va fi inclus în raportul lucrării.</p></div>
          <button className="primary-button" onClick={saveNoIntervention}>Salvează secțiunea <span>→</span></button>
        </section>
      ) : <div className="splice-layout">
        <section className={`splice-map-card ${mapFullscreen.fullscreen ? "map-fullscreen" : ""}`}>
          <div className="splice-map-head">
            <div><small>SELECTARE JONCȚIUNE</small><strong>{mode === "documented" ? "Punct documentat din registru" : "Punct nedocumentat pe hartă"}</strong></div>
            <div className="splice-mode-switch">
              <button className={mode === "documented" ? "active" : ""} onClick={() => setMode("documented")}>Documentată</button>
              <button className={mode === "undocumented" ? "active" : ""} onClick={() => setMode("undocumented")}>Nedocumentată</button>
              {mapFullscreen.fullscreen && <button
                className={`splice-header-locate ${currentLocation ? "located" : ""}`}
                onClick={locateCurrentPosition}
                disabled={gpsLoading}
                aria-label="Identifică locația curentă pe harta sudurilor"
              ><span>{gpsLoading ? "↻" : currentLocation ? "✓" : "⌖"}</span> {gpsLoading ? "Se caută…" : "Locația mea"}</button>}
              <button
                className="fo-fullscreen-toggle"
                onClick={mapFullscreen.toggleFullscreen}
                aria-pressed={mapFullscreen.fullscreen}
                aria-label={mapFullscreen.fullscreen ? "Închide harta pe tot ecranul" : "Deschide harta pe tot ecranul"}
              ><span>{mapFullscreen.fullscreen ? "×" : "⛶"}</span> {mapFullscreen.fullscreen ? "Închide" : "Ecran complet"}</button>
            </div>
          </div>
          <div
            className={`fo-map splice-map ${mode === "undocumented" ? "placing" : ""}`}
            onClick={handleMapClick}
            onPointerDown={mapGestures.onPointerDown}
            onPointerMove={mapGestures.onPointerMove}
            onPointerUp={mapGestures.onPointerUp}
            onPointerCancel={mapGestures.onPointerCancel}
            onWheel={mapGestures.onWheel}
            role="application"
            aria-label="Hartă OpenStreetMap pentru alegerea joncțiunii sudurii"
          >
            <div className="fo-map-tiles" aria-hidden="true">
              {tiles.map((tile) => <img key={tile.key} src={`https://tile.openstreetmap.org/${tile.sourceZoom}/${tile.urlX}/${tile.urlY}.png`} alt="" draggable={false} style={{ left: `${(tile.x / MAP_WIDTH) * 100}%`, top: `${(tile.y / MAP_HEIGHT) * 100}%`, width: `${(tile.size / MAP_WIDTH) * 100}%`, height: `${(tile.size / MAP_HEIGHT) * 100}%` }} />)}
            </div>
            {visibleSites.map(({ site, point }) => (
              <button className={`fo-site-marker ${mapSiteMarkerClass(site.code)} ${junction?.id === site.id ? "selected" : ""}`} style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }} key={site.id} title={`${site.code} · ${site.name}`} onClick={(event) => { event.stopPropagation(); chooseDocumented(site); }}><i /></button>
            ))}
            {junction && (() => {
              const point = screenPoint(junction, center, zoom);
              return <span className={`fo-placed-dot junction-dot ${junction.documented ? "" : "undocumented"}`} aria-label="Punct joncțiune" style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }} />;
            })()}
            {currentLocation && (() => {
              const point = screenPoint(currentLocation, center, zoom);
              return <span className="splice-current-location" style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }}><i /><small>LOCAȚIA MEA</small></span>;
            })()}
            <div className="fo-map-instruction"><span>{mode === "documented" ? "S" : "S?"}</span>{!creating ? "Glisează harta sau folosește pinch zoom" : mode === "documented" ? "Atinge un site · glisează sau folosește pinch zoom" : "Atinge pentru joncțiune · glisează sau folosește pinch zoom"}</div>
            {!creating && <div className="splice-map-lock"><span>＋</span><strong>Începe cu „Sudură nouă”</strong><small>Harta devine activă pentru selectarea joncțiunii.</small></div>}
            <button
              className={`fo-locate-button splice-locate-button ${currentLocation ? "located" : ""}`}
              onClick={(event) => { event.stopPropagation(); locateCurrentPosition(); }}
              disabled={gpsLoading}
              aria-label="Identifică locația curentă pe harta sudurilor"
            >
              <span className={gpsLoading ? "loading" : ""}>{gpsLoading ? "↻" : currentLocation ? "✓" : "⌖"}</span>
              <div><strong>{gpsLoading ? "Se caută poziția…" : currentLocation ? "Locație identificată" : "Locația mea"}</strong><small>{currentLocation ? `Precizie ±${Math.round(currentLocation.accuracy)} m` : "Centrează harta sudurilor"}</small></div>
            </button>
            <div className="fo-zoom" onClick={(event) => event.stopPropagation()}><button onClick={() => setZoom((current) => clamp(current + 1, 7, 25))}>＋</button><button onClick={() => setZoom((current) => clamp(current - 1, 7, 25))}>−</button></div>
            <a className="fo-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>© OpenStreetMap contributors</a>
          </div>
          <MapSiteLegend />
          <div className="splice-map-search">
            <label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Introdu codul exact, ex. J2…" /></label>
            <div className={`splice-data-state ${sitesStatus}`}><i>{sitesStatus === "ready" ? "✓" : sitesStatus === "error" ? "!" : "↻"}</i>{sitesStatus === "ready" ? `${sites.length.toLocaleString("ro-RO")} site-uri` : sitesStatus === "error" ? "Date indisponibile" : "Se încarcă"}</div>
            {search.trim().length >= 2 && <div className="splice-search-results">{searchResults.filter((site) => site.code.trim().toLocaleLowerCase("ro") === search.trim().toLocaleLowerCase("ro")).map((site) => <article className={junction?.id === site.id ? "selected" : ""} key={site.id}><button className="splice-exact-junction-name" onClick={() => chooseDocumented(site)}><strong>{site.code}</strong><b>Arată pe hartă</b></button><a href={googleMapsUrl(site)} target="_blank" rel="noreferrer" aria-label={`Deschide joncțiunea ${site.code} în Google Maps`}>Google Maps ↗</a></article>)}{!searchResults.some((site) => site.code.trim().toLocaleLowerCase("ro") === search.trim().toLocaleLowerCase("ro")) && <p>Nicio joncțiune cu acest cod.</p>}</div>}
          </div>
        </section>

        <aside className="splice-side">
          {!creating ? (
            <section className="splice-empty-card"><span>{junction?.documented ? "✓" : "SU"}</span><h2>{junction?.documented ? `${junction.code} · ${junction.name}` : "Nicio sudură în editare"}</h2><p>{junction?.documented ? `Joncțiune găsită la ${formatCoordinate(junction)}. Pornește sudura nouă pentru a continua cu fibrele.` : "Poți căuta mai întâi joncțiunea pe hartă sau poți porni direct o înregistrare nouă."}</p>{junction?.documented && <a className="splice-preselected-maps" href={googleMapsUrl(junction)} target="_blank" rel="noreferrer">Google Maps ↗</a>}<button onClick={startNewSplice}>＋ Sudură nouă</button></section>
          ) : (
            <>
              <section className="splice-form-card">
                <div className="splice-card-title"><span>1</span><div><h2>Joncțiunea în care se execută sudura</h2><p>Documentată în registru sau introdusă manual.</p></div></div>
                <div className={`splice-junction-result ${junction ? "selected" : ""}`}><span>{junction ? "✓" : "○"}</span><div><small>PUNCT SELECTAT</small><strong>{junction ? `${junction.code} · ${junction.name}` : "Alege punctul pe hartă"}</strong><p>{junction ? `${junction.region} · ${formatCoordinate(junction)}` : "Folosește harta sau căutarea după site."}</p>{junction?.documented && <div className="splice-junction-links"><button onClick={() => { setCenter({ lat: junction.lat, lon: junction.lon }); setZoom((current) => Math.max(current, 18)); }}>Arată punctul pe hartă</button><a href={googleMapsUrl(junction)} target="_blank" rel="noreferrer">Google Maps ↗</a></div>}</div></div>
                {junction?.documented === false && <div className="splice-undocumented-fields">
                  <fieldset><legend>SITUAȚIE ÎN TEREN *</legend><div>{(["existing", "new"] as const).map((kind) => <label className={junctionKind === kind ? "selected" : ""} key={kind}><input type="radio" name="splice-junction-kind" checked={junctionKind === kind} onChange={() => setJunctionKind(kind)} /><span>{kind === "existing" ? "EX" : "NOU"}</span><p><strong>{kind === "existing" ? "Joncțiune existentă" : "Joncțiune nou instalată"}</strong><small>{kind === "existing" ? "Prezentă deja în teren" : "Instalată în acest proiect"}</small></p><i /></label>)}</div></fieldset>
                  <fieldset><legend>REȚEA ORANGE *</legend><div>{(["mobile", "fixed"] as const).map((item) => <label className={network === item ? "selected" : ""} key={item}><input type="radio" name="splice-network" checked={network === item} onChange={() => setNetwork(item)} /><span>{item === "mobile" ? "MOB" : "FIX"}</span><p><strong>{item === "mobile" ? "Orange Mobil" : "Orange Fixed"}</strong><small>Rețeaua joncțiunii</small></p><i /></label>)}</div></fieldset>
                </div>}
              </section>

              <section className="splice-form-card">
                <div className="splice-card-title"><span>2</span><div><h2>Suduri executate</h2><p>Introdu numărul, apoi completează selectorul generat pentru fiecare sudură.</p></div></div>
                {junction && <div className="splice-undocumented-fields">
                  <fieldset><legend>TIP SUDURĂ *</legend><div>{(["fiber", "end-to-end"] as const).map((item) => <label className={spliceMode === item ? "selected" : ""} key={item}><input type="radio" name="splice-mode" checked={spliceMode === item} onChange={() => { setSpliceMode(item); setConnections((current) => current.map((connection) => item === "end-to-end" ? { ...connection, siteFiber: "", clientFiber: "" } : connection)); }} /><span>{item === "fiber" ? "FIB" : "C-C"}</span><p><strong>{item === "fiber" ? "Fibră–fibră" : "Cap–cap"}</strong><small>{item === "fiber" ? "Se aleg bufferul și fibra" : "Se aleg doar bufferele"}</small></p><i /></label>)}</div></fieldset>
                  <label className="fo-cable-input"><span>{spliceMode === "end-to-end" ? "NUMĂR DE BUFFERE *" : "NUMĂR DE SUDURI *"}</span><input type="number" min="1" max="96" step="1" inputMode="numeric" value={spliceCount} placeholder="Introdu numărul" onChange={(event) => { const rawValue = event.target.value; if (rawValue === "") { setSpliceCount(""); setConnections([]); return; } const value = Math.max(1, Math.min(96, Math.trunc(Number(rawValue)))); setSpliceCount(value); setConnections((current) => Array.from({ length: value }, (_, index) => current[index] ?? { siteBuffer: "", siteFiber: "", clientBuffer: "", clientFiber: "" })); }} /></label>
                </div>}
                <div className="splice-directions">
                  <article><div className="splice-direction-title"><span>→</span><div><small>SENS 1</small><strong>Spre site</strong></div></div><label className="fo-cable-input"><span>TIP CABLU SPRE SITE *</span><select value={siteCableType} onChange={(event) => setSiteCableType(event.target.value)}><option value="">Selectează tipul</option>{[4, 12, 24, 48, 96].map((fibers) => <option key={fibers} value={`Cablu FO ${fibers}F`}>{fibers} fibre</option>)}</select></label></article>
                  <div className="splice-fusion"><i /><span>{spliceMode === "end-to-end" ? "CAP–CAP" : "SUDURĂ"}</span><i /></div>
                  <article><div className="splice-direction-title client"><span>→</span><div><small>SENS 2</small><strong>Spre client</strong></div></div><label className="fo-cable-input"><span>TIP CABLU SPRE CLIENT *</span><select value={clientCableType} onChange={(event) => setClientCableType(event.target.value)}><option value="">Selectează tipul</option>{[4, 12, 24, 48, 96].map((fibers) => <option key={fibers} value={`Cablu FO ${fibers}F`}>{fibers} fibre</option>)}</select></label></article>
                </div>
                {junction && <div className="splice-record-list">{connections.map((connection, index) => <article key={index}><span>{index + 1}</span><div><strong>{spliceMode === "end-to-end" ? `Buffer ${index + 1}` : `Sudura ${index + 1}`}</strong><div className="splice-color-grid"><FiberSelect label="Buffer site" value={connection.siteBuffer} onChange={(value) => setConnections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, siteBuffer: value } : item))} />{spliceMode === "fiber" && <FiberSelect label="Fibră site" value={connection.siteFiber} onChange={(value) => setConnections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, siteFiber: value } : item))} />}<FiberSelect label="Buffer client" value={connection.clientBuffer} onChange={(value) => setConnections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, clientBuffer: value } : item))} />{spliceMode === "fiber" && <FiberSelect label="Fibră client" value={connection.clientFiber} onChange={(value) => setConnections((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, clientFiber: value } : item))} />}</div></div></article>)}</div>}
              </section>

              <section className="splice-form-card splice-photo-section">
                <div className="splice-card-title"><span>3</span><div><h2>Fotografii obligatorii</h2><p>{completedSplicePhotos}/3 cadre încărcate pentru această sudură.</p></div></div>
                <div className="splice-photo-grid">
                  {splicePhotoKeys.map((key) => {
                    const item = splicePhotoCatalog[key];
                    const photoName = splicePhotos[key];
                    return (
                      <label className={photoName ? "complete" : ""} key={key}>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => void captureSplicePhoto(key, event.target.files)}
                        />
                        <span>{photoName ? "✓" : item.badge}</span>
                        <div><strong>{item.title}</strong><small>{photoName || item.description}</small></div>
                        <b>{photoName ? "Schimbă" : "Adaugă"}</b>
                      </label>
                    );
                  })}
                </div>
                <div className="splice-readiness"><span className={junctionReady && cableTypesReady && colorsReady && photosReady ? "ready" : ""}>{junctionReady && cableTypesReady && colorsReady && photosReady ? "✓" : "i"}</span><p><strong>{junctionReady && cableTypesReady && colorsReady && photosReady ? "Sudură pregătită pentru salvare" : !junction ? "Selectează joncțiunea" : !junctionReady ? "Completează clasificarea joncțiunii" : !cableTypesReady ? "Completează tipurile de cablu" : !colorsReady ? "Completează toate culorile" : "Încarcă cele 3 fotografii obligatorii"}</strong><small>Datele obligatorii sunt marcate cu *.</small></p></div>
                <div className="splice-form-actions"><button onClick={() => { resetDraft(); setCreating(false); }}>Renunță</button><button className="primary-button" onClick={saveSplice}>Salvează sudura <span>→</span></button></div>
              </section>
            </>
          )}

          <section className="splice-records-card">
            <div className="splice-card-title"><span>✓</span><div><h2>Suduri documentate</h2><p>{projectItem.id} · {projectRecords.reduce((total, record) => total + (record.spliceCount ?? 1), 0)} suduri</p></div></div>
            {projectRecords.length ? <div className="splice-record-list">{projectRecords.map((record, index) => <article key={record.id}><span>{index + 1}</span><div><strong>{record.junction.documented ? `${record.junction.code} · ${record.junction.name}` : `Fără cod · ${record.junctionKind === "existing" ? "existentă" : "nou instalată"}`}</strong><small>{record.junction.documented ? "Joncțiune documentată" : record.network === "mobile" ? "Orange Mobil" : "Orange Fixed"} · 3 fotografii</small><p><b style={{ background: colorHex[record.siteBuffer] }} />{record.siteCableType || "Cablu nespecificat"} · {record.spliceCount ?? 1} {record.spliceMode === "end-to-end" ? (record.spliceCount ?? 1) === 1 ? "buffer" : "buffere" : (record.spliceCount ?? 1) === 1 ? "sudură" : "suduri"} · {record.spliceMode === "end-to-end" ? "cap–cap" : "fibră–fibră"} <i>→</i> <b style={{ background: colorHex[record.clientBuffer] }} />{record.clientCableType || "Cablu nespecificat"}</p></div><em>Salvată</em><button type="button" className="record-delete-button" onClick={() => void deleteSpliceRecord(record)} disabled={Boolean(deletingRecord)}>{deletingRecord === record.id ? "Se șterge…" : "Șterge"}</button></article>)}</div> : <div className="splice-no-records"><span>○</span><p>Nicio sudură salvată pentru această lucrare.</p></div>}
          </section>
        </aside>
      </div>}
    </div>
  );
}
