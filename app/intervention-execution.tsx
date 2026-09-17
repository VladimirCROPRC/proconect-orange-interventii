"use client";

import { useDeferredValue, useEffect, useMemo, useState, type MouseEvent } from "react";
import { deleteProjectFile, fetchProjectFiles, formatCapturedAt, uploadProjectFile, type StoredProjectFile } from "./client-storage";
import {
  requiredInterventionCablePhotos,
  type InterventionActivityType,
  type InterventionExecutionActivity,
  type InterventionFieldSummary,
  type InterventionJunction,
  type InterventionMaterialSelection,
} from "./field-documentation";
import { orangeMaterials, proconectMaterials } from "./orange-materials";
import type { ProjectRecord } from "./project-data";
import { useMapGestures } from "./use-map-gestures";
import { useMapFullscreen } from "./use-map-fullscreen";
import { fetchMapSites, mapSiteMarkerClass } from "./map-sites-client";
import { MapSiteLegend } from "./map-site-legend";

type Coordinate = { lat: number; lon: number };
type OrangeNetworkSiteRow = [code: string, description: string, region: string, lat: number, lon: number];
type OrangeNetworkPayload = { sites: OrangeNetworkSiteRow[] };
type MapMode = "documented" | "undocumented" | "draw" | "pan";
type JunctionSlot = "a" | "b" | "junction";
type DraftJunction = Omit<InterventionJunction, "kind" | "network"> & {
  kind: "" | "documented" | "existing" | "new";
  network: "" | "mobile" | "fixed";
};
type ActivityDraft = {
  id: string;
  type: InterventionActivityType | "";
  endpointA: DraftJunction | null;
  endpointB: DraftJunction | null;
  junction: DraftJunction | null;
  routePoints: Coordinate[];
  cableType: string;
  cableLength: string;
};
type Props = {
  project: ProjectRecord;
  initialSummary?: InterventionFieldSummary;
  onNotify: (message: string) => void;
  onSaved: (summary: InterventionFieldSummary) => Promise<void>;
  blankMap?: boolean;
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;
const TILE_SIZE = 256;
const DEFAULT_CENTER = { lat: 44.4268, lon: 26.1025 };

const activityCatalog: Record<InterventionActivityType, { title: string; short: string; description: string; badge: string }> = {
  "fo-installation": {
    title: "Instalare FO",
    short: "Instalare FO",
    description: "Desenează cablul între două joncțiuni existente sau noi.",
    badge: "FO",
  },
  "junction-installation": {
    title: "Instalare joncțiune pe cablul existent",
    short: "Joncțiune nouă",
    description: "Plasează joncțiunea nouă pe hartă și alege rețeaua.",
    badge: "JN",
  },
  "chamber-installation": {
    title: "Instalare cameretă",
    short: "Cameretă nouă",
    description: "Plasează camereta pe hartă și încarcă două fotografii GPS obligatorii.",
    badge: "CM",
  },
  diagnostics: {
    title: "Îndreptare cablu la cald",
    short: "Îndreptare cablu la cald",
    description: "Plasează pe hartă punctul în care cablul este îndreptat la cald.",
    badge: "IC",
  },
  "splice-repair": {
    title: "Refacere sudură",
    short: "Refacere sudură",
    description: "Alege joncțiunea în care este refăcută sudura FO.",
    badge: "SU",
  },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function projectCoordinate(point: Coordinate, zoom: number) {
  const size = TILE_SIZE * 2 ** zoom;
  const latitude = clamp(point.lat, -85.05112878, 85.05112878);
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((point.lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

function unprojectCoordinate(point: { x: number; y: number }, zoom: number): Coordinate {
  const size = TILE_SIZE * 2 ** zoom;
  const longitude = (point.x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / size;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon: longitude };
}

function screenPoint(point: Coordinate, center: Coordinate, zoom: number) {
  const projected = projectCoordinate(point, zoom);
  const projectedCenter = projectCoordinate(center, zoom);
  return { x: projected.x - projectedCenter.x + MAP_WIDTH / 2, y: projected.y - projectedCenter.y + MAP_HEIGHT / 2 };
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

function documentedJunction(row: OrangeNetworkSiteRow, index: number): DraftJunction {
  return {
    id: `intervention-orangeNetwork-${index}`,
    code: row[0],
    name: row[1] || `Site ${row[0]}`,
    region: row[2],
    lat: row[3],
    lon: row[4],
    documented: true,
    kind: "documented",
    network: "",
  };
}

function validGeo(value: string) {
  const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s|$)/.exec(value.trim());
  return Boolean(match && Math.abs(Number(match[1])) <= 90 && Math.abs(Number(match[2])) <= 180);
}

function distanceBetween(a: Coordinate, b: Coordinate) {
  const radius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(b.lat - a.lat);
  const longitudeDelta = radians(b.lon - a.lon);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function formatCoordinate(point: Coordinate) {
  return `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
}

function googleMapsUrl(point: Coordinate) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lon}`)}`;
}

function readyJunction(junction: DraftJunction | null) {
  return Boolean(junction && (junction.documented || ((junction.kind === "existing" || junction.kind === "new") && junction.network)));
}

function saveJunction(junction: DraftJunction): InterventionJunction {
  const { network, kind, ...details } = junction;
  return { ...details, kind: kind as InterventionJunction["kind"], ...(network ? { network } : {}) };
}

function emptyDraft(): ActivityDraft {
  return { id: crypto.randomUUID(), type: "", endpointA: null, endpointB: null, junction: null, routePoints: [], cableType: "", cableLength: "" };
}

async function photoLocation() {
  if (!window.isSecureContext || !navigator.geolocation) throw new Error("Fotografiile activității necesită acces GPS.");
  return new Promise<string>((resolve, reject) => navigator.geolocation.getCurrentPosition(
    ({ coords }) => resolve(`${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} · ±${Math.round(coords.accuracy)} m`),
    (failure) => reject(new Error(failure.code === 1
      ? "Permite accesul la locație pentru fotografiile intervenției."
      : failure.code === 3 ? "Localizarea GPS a durat prea mult. Încearcă din nou." : "Poziția GPS nu a putut fi determinată.")),
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
  ));
}

export function InterventionExecutionSection({ project, initialSummary, onNotify, onSaved, blankMap = false }: Props) {
  const [sites, setSites] = useState<OrangeNetworkSiteRow[]>([]);
  const [sitesStatus, setSitesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [center, setCenter] = useState<Coordinate>(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(13);
  const [mode, setMode] = useState<MapMode>("pan");
  const [activeSlot, setActiveSlot] = useState<JunctionSlot>("a");
  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [previewJunction, setPreviewJunction] = useState<DraftJunction | null>(null);
  const [activities, setActivities] = useState<InterventionExecutionActivity[]>(initialSummary?.execution?.activities ?? []);
  const [materials, setMaterials] = useState<InterventionMaterialSelection[]>(initialSummary?.execution?.materials ?? []);
  const [remediationDescription, setRemediationDescription] = useState(initialSummary?.execution?.remediationDescription ?? "");
  const [materialSource, setMaterialSource] = useState<"orange" | "proconect">("orange");
  const [materialCode, setMaterialCode] = useState("");
  const [materialQuantity, setMaterialQuantity] = useState("");
  const [savingMaterials, setSavingMaterials] = useState(false);
  const [photos, setPhotos] = useState<StoredProjectFile[]>([]);
  const [search, setSearch] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<(Coordinate & { accuracy: number }) | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState("");
  const [deletingActivity, setDeletingActivity] = useState("");
  const [error, setError] = useState("");
  const deferredSearch = useDeferredValue(search);
  const mapGestures = useMapGestures({
    center,
    zoom,
    setCenter,
    setZoom,
    project: projectCoordinate,
    unproject: unprojectCoordinate,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    maximumZoom: 25,
    mousePan: true,
  });
  const mapFullscreen = useMapFullscreen();

  useEffect(() => {
    let mounted = true;
    if (blankMap) {
      queueMicrotask(() => {
        if (!mounted) return;
        setSites([]);
        setSitesStatus("ready");
      });
      return () => { mounted = false; };
    }
    fetchMapSites().then((payload) => {
        if (!mounted) return;
        setSites(payload.sites);
        setSitesStatus("ready");
      })
      .catch(() => {
        if (mounted) setSitesStatus("error");
      });
    return () => { mounted = false; };
  }, [blankMap]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setActivities(initialSummary?.execution?.activities ?? []);
      setMaterials(initialSummary?.execution?.materials ?? []);
      setRemediationDescription(initialSummary?.execution?.remediationDescription ?? "");
      setDraft(null);
      setPreviewJunction(null);
      setPhotos([]);
      setError("");
      setSearch("");
      setMode("pan");
    });
    fetchProjectFiles(project.id, "intervention-execution")
      .then((stored) => { if (mounted) setPhotos(stored); })
      .catch((failure) => { if (mounted) setError(failure instanceof Error ? failure.message : "Fotografiile activităților nu sunt disponibile."); });
    return () => { mounted = false; };
  }, [project.id, initialSummary?.execution?.documentedAt]);

  const tiles = useMemo(() => {
    const sourceZoom = Math.min(zoom, 19);
    const overzoomScale = 2 ** (zoom - sourceZoom);
    const renderedTileSize = TILE_SIZE * overzoomScale;
    const projectedCenter = projectCoordinate(center, zoom);
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
    const projectedCenter = projectCoordinate(center, zoom);
    const northWest = unprojectCoordinate({ x: projectedCenter.x - MAP_WIDTH / 2, y: projectedCenter.y - MAP_HEIGHT / 2 }, zoom);
    const southEast = unprojectCoordinate({ x: projectedCenter.x + MAP_WIDTH / 2, y: projectedCenter.y + MAP_HEIGHT / 2 }, zoom);
    const minLatitude = Math.min(northWest.lat, southEast.lat);
    const maxLatitude = Math.max(northWest.lat, southEast.lat);
    const minLongitude = Math.min(northWest.lon, southEast.lon);
    const maxLongitude = Math.max(northWest.lon, southEast.lon);
    const first = lowerLatitudeBound(sites, minLatitude);
    const last = lowerLatitudeBound(sites, maxLatitude + Number.EPSILON);
    const stride = Math.max(1, Math.ceil((last - first) / 4000));
    const result: Array<{ site: DraftJunction; point: { x: number; y: number } }> = [];
    for (let index = first; index < last; index += stride) {
      const row = sites[index];
      if (row[4] < minLongitude || row[4] > maxLongitude) continue;
      const site = documentedJunction(row, index);
      const point = screenPoint(site, center, zoom);
      if (point.x > -20 && point.x < MAP_WIDTH + 20 && point.y > -20 && point.y < MAP_HEIGHT + 20) result.push({ site, point });
    }
    return result.slice(0, 140);
  }, [center, sites, zoom]);

  const searchResults = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase("ro");
    if (query.length < 2) return [];
    const exactMatches: DraftJunction[] = [];
    for (let index = 0; index < sites.length; index += 1) {
      const site = documentedJunction(sites[index], index);
      if (site.code.trim().toLocaleLowerCase("ro") === query) exactMatches.push(site);
    }
    return exactMatches.slice(0, 6);
  }, [deferredSearch, sites]);

  const savedJunctions = useMemo(() => {
    const points = new Map<string, InterventionJunction>();
    for (const activity of activities) {
      for (const point of [activity.junction, activity.endpointA, activity.endpointB]) {
        if (point && !point.documented) points.set(point.id, point);
      }
    }
    return Array.from(points.values());
  }, [activities]);

  const routeCoordinates = draft?.type === "fo-installation"
    ? [draft.endpointA, ...draft.routePoints, draft.endpointB].filter((point): point is Coordinate => Boolean(point))
    : [];
  const mappedDistance = routeCoordinates.slice(1).reduce((sum, point, index) => sum + distanceBetween(routeCoordinates[index], point), 0);
  const cableLength = Number(draft?.cableLength.replace(",", ".") ?? "");
  const cableLengthValid = Number.isFinite(cableLength) && cableLength > 0 && cableLength <= 1_000_000;
  const requiredPhotos = draft?.type === "fo-installation" ? requiredInterventionCablePhotos(cableLengthValid ? cableLength : 0) : draft?.type === "chamber-installation" ? 2 : draft?.type ? 1 : 0;
  const activityPhotos = draft ? photos.filter((photo) => photo.category === `${draft.id}:photo` && validGeo(photo.geo)) : [];
  const selectedReady = blankMap
    ? Boolean(draft?.junction && (draft.junction.documented || draft.junction.kind))
    : draft?.type === "fo-installation"
      ? readyJunction(draft.endpointA) && readyJunction(draft.endpointB)
      : readyJunction(draft?.junction ?? null);
  const routeReady = draft?.type !== "fo-installation" || (routeCoordinates.length >= 2 && Boolean(draft.cableType.trim()) && cableLengthValid);
  const activityReady = Boolean(initialSummary?.assessment && draft?.type && selectedReady && routeReady && requiredPhotos && activityPhotos.length >= requiredPhotos);

  function beginActivity() {
    if (!initialSummary?.assessment) {
      onNotify("Salvează mai întâi constatarea înainte de a adăuga activități.");
      return;
    }
    if (draft) {
      onNotify("Salvează sau anulează activitatea aflată deja în editare.");
      return;
    }
    setDraft(emptyDraft());
    setActiveSlot("a");
    setMode("documented");
    setError("");
  }

  function chooseActivityType(type: InterventionActivityType) {
    const damageLocation = initialSummary?.assessment?.damageLocation;
    const orangeDamagePoint: DraftJunction | null = blankMap && damageLocation && type !== "junction-installation" && type !== "chamber-installation" ? { ...damageLocation, id: `damage-${project.id}`, code: "Locația avariei", name: "Locația avariei", region: "Punct stabilit la constatare", documented: false, kind: "existing", network: "" } : null;
    const canUsePreview = Boolean(previewJunction && type !== "junction-installation" && type !== "chamber-installation");
    setDraft((current) => current ? {
      ...current, type,
      endpointA: type === "fo-installation" && canUsePreview ? previewJunction : null,
      endpointB: null,
      junction: type !== "fo-installation" ? orangeDamagePoint ?? (canUsePreview ? previewJunction : null) : null,
      routePoints: [], cableType: "", cableLength: "",
    } : current);
    setActiveSlot(type === "fo-installation" ? (canUsePreview ? "b" : "a") : "junction");
    setMode(blankMap || type === "junction-installation" || type === "chamber-installation" ? "undocumented" : "documented");
    setSearch("");
    setError("");
  }

  function updateJunction(slot: JunctionSlot, junction: DraftJunction | null) {
    setDraft((current) => {
      if (!current) return current;
      return slot === "a" ? { ...current, endpointA: junction } : slot === "b" ? { ...current, endpointB: junction } : { ...current, junction };
    });
  }

  function pickDocumented(junction: DraftJunction) {
    if (!draft?.type) {
      setPreviewJunction(junction);
      setCenter({ lat: junction.lat, lon: junction.lon });
      setZoom((current) => Math.max(current, 18));
      onNotify(`${junction.code} a fost găsită. Poți porni activitatea nouă.`);
      return;
    }
    if (draft.type === "junction-installation" || draft.type === "chamber-installation") {
      onNotify(draft.type === "chamber-installation" ? "Camereta nouă trebuie plasată direct pe hartă." : "Joncțiunea nouă trebuie plasată pe cablul existent direct pe hartă.");
      return;
    }
    setPreviewJunction(junction);
    updateJunction(draft.type === "fo-installation" ? activeSlot === "junction" ? "a" : activeSlot : "junction", junction);
    setCenter({ lat: junction.lat, lon: junction.lon });
    setZoom((current) => Math.max(current, 15));
    setSearch("");
  }

  function mapPoint(event: MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pixel = projectCoordinate(center, zoom);
    return unprojectCoordinate({
      x: pixel.x + ((event.clientX - bounds.left) / bounds.width) * MAP_WIDTH - MAP_WIDTH / 2,
      y: pixel.y + ((event.clientY - bounds.top) / bounds.height) * MAP_HEIGHT - MAP_HEIGHT / 2,
    }, zoom);
  }

  function onMapClick(event: MouseEvent<HTMLDivElement>) {
    if (mapGestures.consumeSuppressedClick()) return;
    if (!draft?.type || mode === "pan" || mode === "documented") return;
    const coordinate = mapPoint(event);
    if (mode === "draw") {
      if (draft.type !== "fo-installation" || !draft.endpointA) {
        onNotify("Selectează mai întâi joncțiunea A, apoi trasează cablul.");
        return;
      }
      setDraft((current) => current ? { ...current, routePoints: [...current.routePoints, coordinate] } : current);
      return;
    }

    const junction: DraftJunction = {
      ...coordinate,
      id: `field-${crypto.randomUUID()}`,
      code: draft.type === "chamber-installation" ? "Cameretă nouă" : draft.type === "junction-installation" ? "Joncțiune nouă" : "Fără cod",
      name: draft.type === "chamber-installation" ? "Cameretă nou instalată" : draft.type === "junction-installation" ? "Joncțiune nouă pe cablu existent" : "Joncțiune nedocumentată",
      region: "Punct introdus pe hartă",
      documented: false,
      kind: draft.type === "junction-installation" || draft.type === "chamber-installation" ? "new" : draft.type === "fo-installation" ? "" : "existing",
      network: "",
    };
    updateJunction(draft.type === "fo-installation" ? activeSlot === "junction" ? "a" : activeSlot : "junction", junction);
  }

  function locate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      onNotify("Localizarea GPS nu este disponibilă pe acest dispozitiv.");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const location = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
        setCurrentLocation(location);
        setCenter(location);
        setZoom(17);
        setGpsLoading(false);
        onNotify(`Locația curentă a fost identificată · precizie ±${Math.round(coords.accuracy)} m.`);
      },
      (failure) => {
        setGpsLoading(false);
        onNotify(failure.code === 1 ? "Permite locația din setările browserului." : "Poziția curentă nu a putut fi determinată.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 },
    );
  }

  async function addActivityPhotos(files: File[]) {
    if (!draft || !files.length) return;
    setUploading(true);
    setError("");
    try {
      const geo = await photoLocation();
      for (const file of files) {
        const saved = await uploadProjectFile({ projectId: project.id, section: "intervention-execution", category: `${draft.id}:photo`, file, geo });
        setPhotos((current) => [...current, saved]);
      }
      onNotify(files.length === 1 ? "Fotografia activității a fost salvată cu GPS." : `${files.length} fotografii ale activității au fost salvate cu GPS.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Fotografiile activității nu au putut fi încărcate.");
    } finally {
      setUploading(false);
    }
  }

  async function removeActivityPhoto(file: StoredProjectFile) {
    setRemovingPhoto(file.id);
    setError("");
    try {
      await deleteProjectFile(file.id);
      setPhotos((current) => current.filter((photo) => photo.id !== file.id));
      onNotify("Fotografia activității a fost ștearsă.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Fotografia nu a putut fi ștearsă.");
    } finally {
      setRemovingPhoto("");
    }
  }

  async function cancelActivity() {
    if (!draft) return;
    const pendingPhotos = photos.filter((photo) => photo.category === `${draft.id}:photo`);
    await Promise.allSettled(pendingPhotos.map((photo) => deleteProjectFile(photo.id)));
    setPhotos((current) => current.filter((photo) => photo.category !== `${draft.id}:photo`));
    setDraft(null);
    setMode("pan");
    setSearch("");
    setError("");
  }

  async function saveActivity() {
    if (!draft?.type || !initialSummary?.assessment) {
      setError("Completează constatarea și selectează tipul activității.");
      return;
    }
    if (!selectedReady) {
      setError(draft.type === "fo-installation"
        ? "Completează joncțiunile A și B; pentru punctele nedocumentate alege tipul și rețeaua."
        : "Selectează joncțiunea și, când este nedocumentată, alege rețeaua Orange.");
      return;
    }
    if (!routeReady) {
      setError("Completează traseul, tipul cablului și lungimea instalată.");
      return;
    }
    if (activityPhotos.length < requiredPhotos) {
      setError(`Mai sunt necesare ${requiredPhotos - activityPhotos.length} fotografii cu GPS pentru această activitate.`);
      return;
    }

    const documentedAt = activityPhotos.reduce((latest, photo) => Math.max(latest, photo.capturedAt), 0);
    const record: InterventionExecutionActivity = {
      id: draft.id,
      type: draft.type,
      ...(draft.type === "fo-installation" ? {
        endpointA: saveJunction(draft.endpointA!),
        endpointB: saveJunction(draft.endpointB!),
        routePoints: routeCoordinates,
        cableType: draft.cableType.trim(),
        cableLengthMeters: cableLength,
      } : { junction: saveJunction(draft.junction!) }),
      photoCount: activityPhotos.length,
      requiredPhotoCount: requiredPhotos,
      documentedAt,
    };

    setSaving(true);
    setError("");
    try {
      const nextActivities = [...activities, record];
      await onSaved({ ...initialSummary, execution: { activities: nextActivities, materials, remediationDescription, documentedAt } });
      setActivities(nextActivities);
      setDraft(null);
      setMode("pan");
      onNotify(`${activityCatalog[record.type].title} a fost salvată pentru tichetul ${project.id}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Activitatea nu a putut fi salvată.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRemediationDescription() {
    if (!remediationDescription.trim()) {
      onNotify("Descrie acțiunile întreprinse pentru remediere.");
      return;
    }
    setSaving(true);
    try {
      await onSaved({ ...initialSummary, execution: { activities, materials, remediationDescription: remediationDescription.trim(), documentedAt: Date.now() } });
      onNotify("Descrierea remedierii a fost salvată.");
    } catch (failure) {
      onNotify(failure instanceof Error ? failure.message : "Descrierea remedierii nu a putut fi salvată.");
    } finally {
      setSaving(false);
    }
  }

  async function saveMaterialSelections() {
    if (!initialSummary?.assessment) {
      onNotify("Salvează mai întâi constatarea.");
      return;
    }
    setSavingMaterials(true);
    try {
      await onSaved({ ...initialSummary, execution: { activities, materials, remediationDescription, documentedAt: Date.now() } });
      onNotify("Materialele utilizate au fost salvate.");
    } catch (failure) {
      onNotify(failure instanceof Error ? failure.message : "Materialele nu au putut fi salvate.");
    } finally {
      setSavingMaterials(false);
    }
  }

  function addMaterial() {
    const catalog = materialSource === "orange" ? orangeMaterials : proconectMaterials;
    const item = catalog.find((entry) => entry.code === materialCode);
    const quantity = Number(materialQuantity.replace(",", "."));
    if (!item || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
      onNotify("Selectează materialul și introdu o cantitate validă.");
      return;
    }
    setMaterials((current) => {
      const existing = current.find((entry) => entry.source === materialSource && entry.code === item.code);
      return existing
        ? current.map((entry) => entry === existing ? { ...entry, quantity: entry.quantity + quantity } : entry)
        : [...current, { source: materialSource, code: item.code, description: item.description, unit: item.unit, quantity }];
    });
    setMaterialCode("");
    setMaterialQuantity("");
  }

  async function deleteSavedActivity(activity: InterventionExecutionActivity) {
    if (!window.confirm(`Ștergi activitatea „${activityCatalog[activity.type].title}” și toate fotografiile aferente?`)) return;
    setDeletingActivity(activity.id);
    setError("");
    try {
      const nextActivities = activities.filter((item) => item.id !== activity.id);
      const nextSummary: InterventionFieldSummary = nextActivities.length || materials.length
        ? { ...initialSummary, execution: { activities: nextActivities, materials, documentedAt: nextActivities.length ? Math.max(...nextActivities.map((item) => item.documentedAt)) : initialSummary?.execution?.documentedAt ?? 0 } }
        : { ...initialSummary, execution: undefined };
      const attachedPhotos = photos.filter((photo) => photo.category === `${activity.id}:photo`);
      const removals = await Promise.allSettled(attachedPhotos.map((photo) => deleteProjectFile(photo.id)));
      const removedIds = new Set(attachedPhotos.filter((_, index) => removals[index].status === "fulfilled").map((photo) => photo.id));
      setPhotos((current) => current.filter((photo) => !removedIds.has(photo.id)));
      const failed = removals.filter((result) => result.status === "rejected").length;
      if (failed) throw new Error(`${failed} fotografii nu au putut fi șterse din toate destinațiile. Reîncearcă ștergerea activității.`);
      await onSaved(nextSummary);
      setActivities(nextActivities);
      onNotify("Activitatea și fotografiile aferente au fost șterse din aplicație, Google Drive și OneDrive.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Activitatea nu a putut fi ștearsă.");
    } finally {
      setDeletingActivity("");
    }
  }

  function junctionPanel(slot: JunctionSlot, title: string, junction: DraftJunction | null) {
    const selected = activeSlot === slot;
    return <article className={`intervention-junction-panel${selected ? " selected" : ""}`}>
      <button type="button" className="intervention-junction-select" onClick={() => { setActiveSlot(slot); if (mode === "draw") setMode("documented"); }}>
        <span>{slot === "a" ? "A" : slot === "b" ? "B" : "J"}</span>
        <div><small>{title}</small><strong>{junction ? junction.documented ? `${junction.code} · ${junction.name}` : junction.kind === "new" ? "Joncțiune nouă" : "Joncțiune nedocumentată" : "Alege punctul pe hartă"}</strong></div>
        <b>{readyJunction(junction) ? "✓" : "○"}</b>
      </button>
      {junction && <><p className="intervention-junction-coordinates">⌖ {junction.lat.toFixed(6)}, {junction.lon.toFixed(6)}</p><div className="splice-junction-links"><button type="button" onClick={() => { setCenter({ lat: junction.lat, lon: junction.lon }); setZoom((current) => Math.max(current, 18)); }}>Arată punctul pe hartă</button>{junction.documented && <a href={googleMapsUrl(junction)} target="_blank" rel="noreferrer">Google Maps ↗</a>}</div></>}
      {junction && !junction.documented && <div className="intervention-junction-options">
        {draft?.type === "fo-installation" && <fieldset><legend>TIP JONCȚIUNE *</legend><div>{(["existing", "new"] as const).map((kind) =>
          <button type="button" key={kind} className={junction.kind === kind ? "active" : ""} onClick={() => updateJunction(slot, { ...junction, kind })}>{kind === "existing" ? "Existentă" : "Nouă"}</button>
        )}</div></fieldset>}
        {!blankMap && <fieldset><legend>REȚEA ORANGE *</legend><div>{(["mobile", "fixed"] as const).map((network) =>
          <button type="button" key={network} className={junction.network === network ? "active" : ""} onClick={() => updateJunction(slot, { ...junction, network })}>{network === "mobile" ? "Orange Mobil" : "Orange Fixed"}</button>
        )}</div></fieldset>}
      </div>}
    </article>;
  }

  const mapInstruction = !draft ? (previewJunction ? "Joncțiune găsită · pornește Activitate nouă" : "Caută joncțiunea sau pornește Activitate nouă") : !draft.type ? "Alege tipul activității" : mode === "pan"
    ? "Trage harta pentru deplasare" : mode === "draw" ? "Atinge succesiv traseul cablului" : mode === "undocumented"
      ? `Atinge locul joncțiunii ${activeSlot === "a" ? "A" : activeSlot === "b" ? "B" : "nedocumentate"}`
      : blankMap ? "Plasează punctul necesar direct pe hartă" : `Alege un punct OrangeNetwork${draft.type === "fo-installation" ? ` pentru capătul ${activeSlot.toUpperCase()}` : ""}`;

  return <div className="intervention-execution-shell">
    <section className="project-card intervention-activities-heading">
      <div><h2>Execuție intervenție</h2><p>1. Caută joncțiunea · 2. Alege activitatea · 3. Operează pe hartă · 4. Documentează și salvează.</p></div>
      <button type="button" className="primary-button" onClick={beginActivity} disabled={Boolean(draft)}><span>＋</span> Activitate nouă</button>
    </section>

    {!initialSummary?.assessment && <div className="intervention-execution-notice">Salvează mai întâi secțiunea „Constatare” pentru a începe execuția.</div>}

    {draft && <section className="project-card intervention-activity-types">
      <div className="card-heading"><div><h2>1. Alege activitatea</h2><p>Selectează operațiunea, apoi folosește aceleași controale ale hărții ca în Instalări.</p></div></div>
      <div className="intervention-type-grid">{(Object.keys(activityCatalog) as InterventionActivityType[]).filter((type) => !blankMap || type !== "fo-installation").map((type) => <button
        type="button"
        key={type}
        className={draft.type === type ? "active" : ""}
        onClick={() => chooseActivityType(type)}
        disabled={activityPhotos.length > 0 && draft.type !== type}
      ><span>{activityCatalog[type].badge}</span><strong>{activityCatalog[type].short}</strong><small>{activityCatalog[type].description}</small></button>)}</div>
    </section>}

    <div className="intervention-map-layout">
      <section className={`splice-map-card intervention-map-card ${mapFullscreen.fullscreen ? "map-fullscreen" : ""}`} >
        <div className="splice-map-head intervention-map-head"><div><small>MOD ACTIV</small><strong>{draft?.type ? activityCatalog[draft.type].title : "Puncte și activități ale intervenției"}</strong></div>
          <div className="intervention-map-actions">
            {!blankMap && draft?.type !== "junction-installation" && draft?.type !== "chamber-installation" && <button type="button" className={mode === "documented" ? "active" : ""} onClick={() => setMode("documented")} disabled={!draft?.type}>J documentată</button>}
            {!blankMap && <button type="button" className={mode === "undocumented" ? "active" : ""} onClick={() => setMode("undocumented")} disabled={!draft?.type}>J fără cod</button>}
            {draft?.type === "fo-installation" && <button type="button" className={mode === "draw" ? "active" : ""} onClick={() => setMode("draw")}>Trasează</button>}
            <button type="button" className="fo-fullscreen-toggle" onClick={mapFullscreen.toggleFullscreen} aria-pressed={mapFullscreen.fullscreen}>{mapFullscreen.fullscreen ? "× Închide" : "⛶ Ecran complet"}</button>
          </div>
        </div>

        <div className={`fo-map splice-map intervention-execution-map${mode === "pan" ? " mode-pan" : mode === "undocumented" || mode === "draw" ? " placing" : ""}`}
          role="application" aria-label="Hartă OrangeNetwork și OpenStreetMap pentru activitățile intervenției"
          onClick={onMapClick} onPointerDown={mapGestures.onPointerDown} onPointerMove={mapGestures.onPointerMove} onPointerUp={mapGestures.onPointerUp} onPointerCancel={mapGestures.onPointerCancel} onWheel={mapGestures.onWheel}>
          <div className="fo-map-tiles" aria-hidden="true">{tiles.map((tile) => <img key={tile.key} src={`https://tile.openstreetmap.org/${tile.sourceZoom}/${tile.urlX}/${tile.urlY}.png`} alt="" draggable={false} style={{ left: `${tile.x / MAP_WIDTH * 100}%`, top: `${tile.y / MAP_HEIGHT * 100}%`, width: `${tile.size / MAP_WIDTH * 100}%`, height: `${tile.size / MAP_HEIGHT * 100}%` }} />)}</div>

          <svg className="fo-route-line intervention-routes" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            {activities.filter((activity) => activity.type === "fo-installation").map((activity) => <polyline key={activity.id} className="intervention-saved-route" points={(activity.routePoints ?? []).map((point) => { const position = screenPoint(point, center, zoom); return `${position.x},${position.y}`; }).join(" ")} />)}
            {routeCoordinates.length > 1 && <><polyline className="route-shadow" points={routeCoordinates.map((point) => { const position = screenPoint(point, center, zoom); return `${position.x},${position.y}`; }).join(" ")} /><polyline className="route-cable" points={routeCoordinates.map((point) => { const position = screenPoint(point, center, zoom); return `${position.x},${position.y}`; }).join(" ")} /></>}
          </svg>

          {!blankMap && visibleSites.map(({ site, point }) => <button type="button" className={`fo-site-marker ${mapSiteMarkerClass(site.code)}${draft?.endpointA?.id === site.id || draft?.endpointB?.id === site.id || draft?.junction?.id === site.id || previewJunction?.id === site.id ? " selected" : ""}`} key={site.id} title={`${site.code} · ${site.name}`} aria-label={`Alege ${site.code} ${site.name}`} style={{ left: `${point.x / MAP_WIDTH * 100}%`, top: `${point.y / MAP_HEIGHT * 100}%` }} onClick={(event) => { event.stopPropagation(); pickDocumented(site); }}><i /></button>)}

          {savedJunctions.map((junction) => { const point = screenPoint(junction, center, zoom); return <button type="button" key={junction.id} className="fo-site-marker intervention-field-marker" title={`${junction.kind === "new" ? "Joncțiune nouă" : "Joncțiune existentă"} · ${junction.network === "mobile" ? "Orange Mobil" : "Orange Fixed"}`} style={{ left: `${point.x / MAP_WIDTH * 100}%`, top: `${point.y / MAP_HEIGHT * 100}%` }} onClick={(event) => { event.stopPropagation(); if (draft?.type === "junction-installation" || draft?.type === "chamber-installation") return; updateJunction(draft?.type === "fo-installation" ? activeSlot : "junction", { ...junction, network: junction.network ?? "" }); }}><i /></button>; })}

          {previewJunction && !draft?.endpointA && !draft?.endpointB && !draft?.junction && (() => { const point = screenPoint(previewJunction, center, zoom); return <span className="fo-placed-dot junction-dot" aria-label="Joncțiune găsită" style={{ left: `${point.x / MAP_WIDTH * 100}%`, top: `${point.y / MAP_HEIGHT * 100}%` }} />; })()}
          {draft?.routePoints.map((point, index) => { const position = screenPoint(point, center, zoom); return <span className="fo-route-point" key={`${point.lat}-${point.lon}-${index}`} style={{ left: `${position.x / MAP_WIDTH * 100}%`, top: `${position.y / MAP_HEIGHT * 100}%` }}>{index + 1}</span>; })}
          {([draft?.endpointA ? ["A", draft.endpointA] : null, draft?.endpointB ? ["B", draft.endpointB] : null, draft?.junction ? ["J", draft.junction] : null] as Array<[string, DraftJunction] | null>).filter((item): item is [string, DraftJunction] => Boolean(item)).map(([label, junction]) => {
            const point = screenPoint(junction, center, zoom);
            return <span className={`fo-placed-dot ${label === "A" ? "client-dot" : "junction-dot"}${junction.documented ? "" : " undocumented"}`} aria-label={label === "A" ? "Punct A" : "Punct joncțiune"} key={label} style={{ left: `${point.x / MAP_WIDTH * 100}%`, top: `${point.y / MAP_HEIGHT * 100}%` }} />;
          })}
          {currentLocation && (() => { const point = screenPoint(currentLocation, center, zoom); return <span className="splice-current-location" style={{ left: `${point.x / MAP_WIDTH * 100}%`, top: `${point.y / MAP_HEIGHT * 100}%` }}><i /><small>LOCAȚIA MEA</small></span>; })()}

          {!blankMap && <div className="fo-map-instruction"><span>{mode === "draw" ? "⌁" : mode === "pan" ? "✥" : activeSlot.toUpperCase().slice(0, 1)}</span>{mapInstruction}</div>}
          {draft?.type === "fo-installation" && <div className="fo-route-live-distance" aria-live="polite"><small>LUNGIME TRASEU</small><strong>{Math.round(mappedDistance).toLocaleString("ro-RO")} m</strong></div>}
          <button type="button" className={`fo-locate-button splice-locate-button ${currentLocation ? "located" : ""}`} onClick={(event) => { event.stopPropagation(); locate(); }} disabled={gpsLoading}><span className={gpsLoading ? "loading" : ""}>{gpsLoading ? "↻" : currentLocation ? "✓" : "⌖"}</span><div><strong>{gpsLoading ? "Se caută poziția…" : currentLocation ? "Locație identificată" : "Locația mea"}</strong><small>{currentLocation ? `Precizie ±${Math.round(currentLocation.accuracy)} m` : "Centrează harta intervenției"}</small></div></button>
          <div className="fo-zoom" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setZoom((value) => clamp(value + 1, 7, 25))}>＋</button><button type="button" onClick={() => setZoom((value) => clamp(value - 1, 7, 25))}>−</button></div>
          <a className="fo-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>© OpenStreetMap contributors</a>
        </div>

          {!blankMap && <MapSiteLegend />}
        <div className="fo-map-footer intervention-map-footer">
          <button type="button" onClick={locate} disabled={gpsLoading}><span>⌖</span>{gpsLoading ? "Se caută GPS…" : "Identifică locația curentă"}</button>
          <button type="button" onClick={() => setDraft((current) => current ? { ...current, routePoints: current.routePoints.slice(0, -1) } : current)} disabled={!draft?.routePoints.length}><span>↶</span>Anulează ultimul punct</button>
          <button type="button" onClick={() => setDraft((current) => current ? { ...current, routePoints: [] } : current)} disabled={!draft?.routePoints.length}><span>⌫</span>Șterge traseul</button>
          <button type="button" onClick={() => void cancelActivity()} disabled={!draft || saving}><span>↻</span>Reset activitate</button>
        </div>

        {!blankMap && <div className="splice-map-search"><label><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Introdu codul exact, ex. J2…" disabled={draft?.type === "junction-installation" || draft?.type === "chamber-installation"} /></label><div className={`splice-data-state ${sitesStatus}`}><i>{sitesStatus === "ready" ? "✓" : sitesStatus === "error" ? "!" : "↻"}</i>{sitesStatus === "ready" ? `${sites.length.toLocaleString("ro-RO")} puncte` : sitesStatus === "error" ? "Date indisponibile" : "Se încarcă"}</div>
          {search.trim().length >= 2 && <div className="splice-search-results">{searchResults.filter((site) => site.code.trim().toLocaleLowerCase("ro") === search.trim().toLocaleLowerCase("ro")).map((site) => <article className={previewJunction?.id === site.id ? "selected" : ""} key={site.id}><button type="button" className="splice-exact-junction-name" onClick={() => pickDocumented(site)}><strong>{site.code}</strong><b>Arată pe hartă</b></button><a href={googleMapsUrl(site)} target="_blank" rel="noreferrer">Google Maps ↗</a></article>)}{!searchResults.some((site) => site.code.trim().toLocaleLowerCase("ro") === search.trim().toLocaleLowerCase("ro")) && <p>Nicio joncțiune cu acest cod.</p>}</div>}
        </div>}
      </section>

      <aside className="intervention-activity-panel">
        {!draft ? <section className="splice-empty-card intervention-empty-card"><span>{previewJunction ? "✓" : "＋"}</span><h2>{previewJunction ? previewJunction.code : "Nicio activitate în editare"}</h2><p>{previewJunction ? `Joncțiune găsită la ${formatCoordinate(previewJunction)}. Va fi preselectată pentru activitatea compatibilă.` : "Caută mai întâi joncțiunea sau adaugă direct o activitate de execuție."}</p>{previewJunction && <a className="splice-preselected-maps" href={googleMapsUrl(previewJunction)} target="_blank" rel="noreferrer">Google Maps ↗</a>}<button type="button" onClick={beginActivity}>＋ Activitate nouă</button></section>
          : !draft.type ? <section className="splice-empty-card intervention-empty-card"><span>1</span><h2>Alege tipul activității</h2><p>Selectează una dintre operațiunile disponibile pentru a activa harta și formularul dedicat.</p><button type="button" onClick={() => void cancelActivity()}>Anulează activitatea</button></section>
            : <><section className="project-card intervention-activity-form"><div className="card-heading"><div><h2>2. {activityCatalog[draft.type].title}</h2><p>{activityCatalog[draft.type].description}</p></div></div>
              <div className="intervention-activity-form-body">
                {draft.type === "fo-installation" ? <>
                  {junctionPanel("a", "JONCȚIUNEA A", draft.endpointA)}
                  {junctionPanel("b", "JONCȚIUNEA B", draft.endpointB)}
                  <div className="intervention-route-toolbar"><button type="button" onClick={() => setMode("draw")} disabled={!draft.endpointA}>⌁ Trasează cablul</button><button type="button" onClick={() => setDraft((current) => current ? { ...current, routePoints: current.routePoints.slice(0, -1) } : current)} disabled={!draft.routePoints.length}>Anulează punct</button></div>
                  <p className="intervention-route-distance">Traseu estimat pe hartă: <strong>{Math.round(mappedDistance).toLocaleString("ro-RO")} m</strong></p>
                  <label className="intervention-damage-field"><span>Tip cablu FO <b>OBLIGATORIU</b></span><select value={draft.cableType} onChange={(event) => setDraft((current) => current ? { ...current, cableType: event.target.value } : current)}><option value="">Selectează tipul cablului</option>{[4, 12, 24, 48, 96].map((fibers) => <option key={fibers} value={`Cablu FO ${fibers}F`}>{fibers} fibre</option>)}</select></label>
                  <label className="intervention-damage-field"><span>Lungime instalată <b>METRI</b></span><input type="number" min="0.1" max="1000000" step="0.1" inputMode="decimal" value={draft.cableLength} onChange={(event) => setDraft((current) => current ? { ...current, cableLength: event.target.value } : current)} placeholder="ex. 125" /></label>
                  <div className="fo-photo-rules intervention-photo-thresholds"><span className={cableLengthValid && cableLength <= 100 ? "active" : ""}><b>≤100 m</b><small>3 poze</small></span><span className={cableLength > 100 && cableLength <= 200 ? "active" : ""}><b>101–200 m</b><small>5 poze</small></span><span className={cableLength > 200 && cableLength <= 300 ? "active" : ""}><b>201–300 m</b><small>10 poze</small></span><span className={cableLength > 300 ? "active" : ""}><b>&gt;300 m</b><small>15 poze</small></span></div>
                </> : junctionPanel("junction", draft.type === "diagnostics" ? "PUNCTUL ÎNDREPTĂRII CABLULUI" : draft.type === "splice-repair" ? "JONCȚIUNEA REFACERII SUDURII" : draft.type === "chamber-installation" ? "CAMERETA NOU INSTALATĂ" : "JONCȚIUNEA NOU INSTALATĂ", draft.junction)}

                <div className="intervention-activity-photo-title"><strong>3. {draft.type === "diagnostics" ? "Fotografii îndreptare cablu la cald" : draft.type === "fo-installation" ? "Fotografii instalare FO" : draft.type === "chamber-installation" ? "Fotografii camereta (2 obligatorii)" : "Fotografii remediere"}</strong><span>{activityPhotos.length}/{requiredPhotos || "—"}</span></div>
                <label className={`intervention-photo-upload intervention-activity-upload${uploading ? " is-uploading" : ""}${!requiredPhotos ? " is-disabled" : ""}`}><input type="file" accept="image/*" capture="environment" multiple disabled={uploading || !requiredPhotos} onChange={(event) => { const selected = Array.from(event.target.files ?? []); event.currentTarget.value = ""; void addActivityPhotos(selected); }} /><span className="intervention-upload-icon">⌖</span><strong>{uploading ? "Se încarcă fotografiile..." : "Adaugă fotografii GPS"}</strong><small>Data, ora și poziția sunt marcate pe imagine.</small></label>

                {activityPhotos.length > 0 && <div className="intervention-activity-photo-list">{activityPhotos.map((photo) => <article key={photo.id}><span>✓</span><div><strong>{photo.name}</strong><small>⌖ {photo.geo} · {formatCapturedAt(photo.capturedAt)}</small></div><button type="button" onClick={() => void removeActivityPhoto(photo)} disabled={removingPhoto === photo.id}>{removingPhoto === photo.id ? "..." : "×"}</button></article>)}</div>}
                {error && <p className="intervention-error" role="alert">{error}</p>}
                <div className="intervention-activity-actions"><button type="button" className="secondary-button" onClick={() => void cancelActivity()} disabled={saving}>Anulează</button><button type="button" className="primary-button" onClick={() => void saveActivity()} disabled={!activityReady || saving || uploading}>{saving ? "Se salvează..." : "Salvează execuția"} <span>→</span></button></div>
              </div></section></>}
      </aside>
    </div>

    <section className="project-card intervention-records-card">
      <div className="card-heading"><div><h2>Descriere remediere</h2><p>Descrie acțiunile întreprinse în teren pentru eliminarea incidentului.</p></div></div>
      <div className="intervention-activity-form-body">
        <label className="intervention-damage-field"><span>Acțiuni întreprinse</span><textarea rows={6} maxLength={2000} value={remediationDescription} onChange={(event) => setRemediationDescription(event.target.value)} placeholder="Descrie operațiunile de remediere" /></label>
        <button type="button" className="primary-button" onClick={() => void saveRemediationDescription()} disabled={saving || !remediationDescription.trim()}>{saving ? "Se salvează…" : "Salvează descrierea"}</button>
      </div>
    </section>

    {blankMap && <section className="project-card intervention-records-card">
      <div className="card-heading"><div><h2>Materiale utilizate</h2><p>Alege materialele Orange și materialele Proconect consumate la intervenție.</p></div></div>
      <div className="intervention-activity-form-body">
        <div className="intervention-route-toolbar"><button type="button" className={materialSource === "orange" ? "active" : ""} onClick={() => { setMaterialSource("orange"); setMaterialCode(""); }}>Materiale Orange</button><button type="button" className={materialSource === "proconect" ? "active" : ""} onClick={() => { setMaterialSource("proconect"); setMaterialCode(""); }}>Materiale Proconect</button></div>
        <label className="intervention-damage-field"><span>Material</span><select value={materialCode} onChange={(event) => setMaterialCode(event.target.value)}><option value="">Selectează materialul</option>{(materialSource === "orange" ? orangeMaterials : proconectMaterials).map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description} · {item.unit}</option>)}</select></label>
        <label className="intervention-damage-field"><span>Cantitate</span><input type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" value={materialQuantity} onChange={(event) => setMaterialQuantity(event.target.value)} placeholder="Introdu cantitatea" /></label>
        <button type="button" className="secondary-button" onClick={addMaterial}>Adaugă materialul</button>
        {materials.length > 0 && <div className="intervention-records-list">{materials.map((item) => <article key={`${item.source}-${item.code}`}><span>{item.source === "orange" ? "OR" : "PC"}</span><div><strong>{item.code} · {item.description}</strong><small>{item.source === "orange" ? "Material Orange" : "Material Proconect"}</small></div><b>{item.quantity} {item.unit}</b><button type="button" className="record-delete-button" onClick={() => setMaterials((current) => current.filter((entry) => entry !== item))}>Șterge</button></article>)}</div>}
        <button type="button" className="primary-button" onClick={() => void saveMaterialSelections()} disabled={savingMaterials}>{savingMaterials ? "Se salvează…" : "Salvează materialele"}</button>
      </div>
    </section>}

    <section className="project-card intervention-records-card"><div className="card-heading"><div><h2>Activități salvate</h2><p>{activities.length ? `${activities.length} ${activities.length === 1 ? "activitate documentată" : "activități documentate"} pentru tichetul ${project.id}.` : "Nicio activitate salvată pentru această intervenție."}</p></div></div>
      {activities.length > 0 && <div className="intervention-records-list">{activities.map((activity) => <article key={activity.id}><span>{activityCatalog[activity.type].badge}</span><div><strong>{activityCatalog[activity.type].title}</strong><small>{activity.type === "fo-installation" ? `${activity.endpointA?.code ?? "Joncțiunea A"} → ${activity.endpointB?.code ?? "Joncțiunea B"} · ${activity.cableType} · ${activity.cableLengthMeters} m` : `${activity.type === "chamber-installation" ? "Cameretă nouă" : activity.junction?.documented ? activity.junction.code : "Joncțiune nedocumentată"}${activity.junction?.network ? ` · ${activity.junction.network === "mobile" ? "Orange Mobil" : "Orange Fixed"}` : ""}`}</small></div><b>{activity.photoCount}/{activity.requiredPhotoCount} foto GPS</b><button type="button" className="record-delete-button" onClick={() => void deleteSavedActivity(activity)} disabled={Boolean(deletingActivity)}>{deletingActivity === activity.id ? "Se șterge…" : "Șterge"}</button></article>)}</div>}
    </section>
  </div>;
}
