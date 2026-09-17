"use client";

import {
  useEffect,
  useDeferredValue,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { deleteProjectFile, fetchProjectFiles, formatCapturedAt, uploadProjectFile } from "./client-storage";
import type { RouteFieldSummary } from "./field-documentation";
import { NoInterventionControl } from "./no-intervention-control";
import { useMapGestures } from "./use-map-gestures";
import { useMapFullscreen } from "./use-map-fullscreen";
import { fetchMapSites, mapSiteMarkerClass } from "./map-sites-client";
import { MapSiteLegend } from "./map-site-legend";

type Coordinate = { lat: number; lon: number };
type MapMode = "pan" | "client" | "route" | "undocumented";
type InstallationMethod = "aerial" | "duct" | "tray" | "facade";
type AerialMaterial = "boat" | "stainlessClamp" | "hook" | "armorod";
type UndocumentedJunctionType = "" | "existing" | "new";
type UndocumentedJunctionNetwork = "" | "mobile" | "fixed";

type OrangeNetworkSite = Coordinate & {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  county: string;
};

type OrangeNetworkSiteRow = [code: string, description: string, region: string, lat: number, lon: number];

type OrangeNetworkPayload = {
  source: string;
  valid: number;
  rejected: Record<string, number>;
  schema: string[];
  sites: OrangeNetworkSiteRow[];
};

type RouteProject = {
  id: string;
  client: string;
  address: string;
  technician: string;
};

type RouteEnd = Coordinate & {
  id: string;
  code: string;
  name: string;
  detail: string;
  documented: boolean;
};

type RoutePhoto = {
  id: string;
  name: string;
  geo: string;
  capturedAt: string;
  geotagged: boolean;
};

type Props = {
  project: RouteProject;
  variant?: "installation" | "survey";
  initialSummary?: RouteFieldSummary;
  onNotify: (message: string) => void;
  onSaved?: (summary: RouteFieldSummary) => Promise<void> | void;
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 600;
const TILE_SIZE = 256;
const DEFAULT_CENTER: Coordinate = { lat: 44.4268, lon: 26.1025 };
const installationCatalog: Record<InstallationMethod, { title: string; description: string; symbol: string }> = {
  aerial: {
    title: "Aerian pe stâlpi",
    description: "Traseu suspendat pe infrastructura aeriană.",
    symbol: "ST",
  },
  duct: {
    title: "Monotub / canalizație",
    description: "Instalare în monotub sau canalizație existentă.",
    symbol: "MT",
  },
  tray: {
    title: "Pat de cablu",
    description: "Pozare în patul de cablu al clădirii.",
    symbol: "PC",
  },
  facade: {
    title: "Fațadă clădire",
    description: "Cablu montat aparent pe fațade.",
    symbol: "FA",
  },
};
const installationMethods = Object.keys(installationCatalog) as InstallationMethod[];
const aerialMaterialCatalog: Record<AerialMaterial, string> = {
  boat: "Bărcuță",
  stainlessClamp: "Colier tablă inox",
  hook: "Cârlig",
  armorod: "Armorod",
};
const aerialMaterials = Object.keys(aerialMaterialCatalog) as AerialMaterial[];
const undocumentedJunctionLabels: Record<Exclude<UndocumentedJunctionType, "">, string> = {
  existing: "Joncțiune existentă",
  new: "Joncțiune nou instalată",
};
const undocumentedJunctionNetworkLabels: Record<Exclude<UndocumentedJunctionNetwork, "">, string> = {
  mobile: "Orange Mobil",
  fixed: "Orange Fixed",
};

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
  return {
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
    lon: longitude,
  };
}

function screenPoint(point: Coordinate, center: Coordinate, zoom: number) {
  const projected = project(point, zoom);
  const projectedCenter = project(center, zoom);
  return {
    x: projected.x - projectedCenter.x + MAP_WIDTH / 2,
    y: projected.y - projectedCenter.y + MAP_HEIGHT / 2,
  };
}

function distanceBetween(a: Coordinate, b: Coordinate) {
  const radius = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(b.lat - a.lat);
  const longitudeDelta = toRadians(b.lon - a.lon);
  const latitudeA = toRadians(a.lat);
  const latitudeB = toRadians(b.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function formatDistance(meters: number) {
  return meters >= 1000
    ? `${(meters / 1000).toLocaleString("ro-RO", { maximumFractionDigits: 2 })} km`
    : `${Math.round(meters)} m`;
}

function formatCoordinate(point: Coordinate) {
  return `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`;
}

function googleMapsUrl(point: Coordinate) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lon}`)}`;
}

function parseLengthMeters(value: string) {
  const length = Number(value.trim().replace(",", "."));
  return Number.isFinite(length) && length > 0 ? length : 0;
}

function parseMaterialQuantity(value: string) {
  const quantity = Number(value.trim());
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
}

function formatLengthMeters(value: number) {
  return `${value.toLocaleString("ro-RO", { maximumFractionDigits: 1 })} m`;
}

function requiredPhotosForLength(lengthMeters: number) {
  if (lengthMeters <= 0) return 0;
  if (lengthMeters <= 100) return 3;
  if (lengthMeters <= 200) return 5;
  if (lengthMeters <= 300) return 10;
  return 15;
}

function siteFromRow(row: OrangeNetworkSiteRow, index: number): OrangeNetworkSite {
  const [code, description, region, lat, lon] = row;
  return {
    id: `orangeNetwork-${index}`,
    code,
    name: description || `Site ${code}`,
    address: "",
    city: region,
    county: "",
    lat,
    lon,
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

export function FoRouteSection({ project: projectItem, variant = "installation", initialSummary, onNotify, onSaved }: Props) {
  const surveyMode = variant === "survey";
  const [sites, setSites] = useState<OrangeNetworkSiteRow[]>([]);
  const [sitesStatus, setSitesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sourceName, setSourceName] = useState("OrangeNetwork Sites.xlsx");
  const [rejectedSites, setRejectedSites] = useState(0);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(15);
  const [mode, setMode] = useState<MapMode>("client");
  const [endA, setEndA] = useState<RouteEnd | null>(null);
  const [endB, setEndB] = useState<RouteEnd | null>(null);
  const [undocumentedJunctionType, setUndocumentedJunctionType] = useState<UndocumentedJunctionType>("");
  const [undocumentedJunctionNetwork, setUndocumentedJunctionNetwork] = useState<UndocumentedJunctionNetwork>("");
  const [routePoints, setRoutePoints] = useState<Coordinate[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<(Coordinate & { accuracy: number }) | null>(null);
  const [selectedInstallationMethods, setSelectedInstallationMethods] = useState<InstallationMethod[]>([]);
  const [cableTypes, setCableTypes] = useState<Record<InstallationMethod, string>>({
    aerial: "",
    duct: "",
    tray: "",
    facade: "",
  });
  const [installationLengths, setInstallationLengths] = useState<Record<InstallationMethod, string>>({
    aerial: "",
    duct: "",
    tray: "",
    facade: "",
  });
  const [aerialMaterialQuantities, setAerialMaterialQuantities] = useState<Record<AerialMaterial, string>>({
    boat: "",
    stainlessClamp: "",
    hook: "",
    armorod: "",
  });
  const [routePhotos, setRoutePhotos] = useState<RoutePhoto[]>([]);
  const [deletingRoute, setDeletingRoute] = useState(false);
  const [noIntervention, setNoIntervention] = useState(false);
  const [noInterventionReason, setNoInterventionReason] = useState("");
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
    mousePan: mode === "pan",
  });
  const mapFullscreen = useMapFullscreen();

  useEffect(() => {
    let active = true;
    fetchMapSites().then((payload) => {
        if (!active) return;
        setSites(payload.sites);
        setSourceName(payload.source);
        setRejectedSites(Object.values(payload.rejected).reduce((total, count) => total + count, 0));
        setSitesStatus("ready");
      })
      .catch(() => active && setSitesStatus("error"));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      resetRoute();
      setNoIntervention(Boolean(initialSummary?.noIntervention));
      setNoInterventionReason(initialSummary?.noInterventionReason ?? "");
      if (!initialSummary) return;
      setSelectedInstallationMethods(initialSummary.segments.map((segment) => segment.method));
      setCableTypes((current) => ({ ...current, ...Object.fromEntries(initialSummary.segments.map((segment) => [segment.method, segment.cableType])) }));
      setInstallationLengths((current) => ({ ...current, ...Object.fromEntries(initialSummary.segments.map((segment) => [segment.method, String(segment.lengthMeters)])) }));
      setAerialMaterialQuantities({
        boat: initialSummary.aerialMaterials.boat ? String(initialSummary.aerialMaterials.boat) : "",
        stainlessClamp: initialSummary.aerialMaterials.stainlessClamp ? String(initialSummary.aerialMaterials.stainlessClamp) : "",
        hook: initialSummary.aerialMaterials.hook ? String(initialSummary.aerialMaterials.hook) : "",
        armorod: initialSummary.aerialMaterials.armorod ? String(initialSummary.aerialMaterials.armorod) : "",
      });
      if (initialSummary.endpoints) {
        setEndA(initialSummary.endpoints.a);
        setEndB(initialSummary.endpoints.b);
        setCenter({ lat: initialSummary.endpoints.a.lat, lon: initialSummary.endpoints.a.lon });
        setMode("route");
      }
      setRoutePoints(initialSummary.routePoints ?? []);
      if (!initialSummary.junction.documented) {
        setUndocumentedJunctionType(initialSummary.junction.kind === "documented" ? "" : initialSummary.junction.kind);
        setUndocumentedJunctionNetwork(initialSummary.junction.network ?? "");
      }
    });
    fetchProjectFiles(projectItem.id, "route")
      .then((files) => {
        if (!active) return;
        setRoutePhotos(files.map((file) => ({
          id: file.id,
          name: file.name,
          geo: file.geo || "GPS indisponibil",
          capturedAt: formatCapturedAt(file.capturedAt),
          geotagged: /^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?/.test(file.geo),
        })));
      })
      .catch(() => {
        // Route geometry remains available even when file listing is temporarily unavailable.
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
        const wrappedX = ((tileX % tilesAcross) + tilesAcross) % tilesAcross;
        result.push({
          key: `${zoom}-${tileX}-${tileY}`,
          x: tileX * renderedTileSize - (projectedCenter.x - MAP_WIDTH / 2),
          y: tileY * renderedTileSize - (projectedCenter.y - MAP_HEIGHT / 2),
          size: renderedTileSize,
          sourceZoom,
          urlX: wrappedX,
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
    const stride = Math.max(1, Math.ceil((last - first) / 5000));
    const candidates: Array<{ site: OrangeNetworkSite; point: { x: number; y: number } }> = [];

    for (let index = first; index < last; index += stride) {
      const row = sites[index];
      if (row[4] < minimumLongitude || row[4] > maximumLongitude) continue;
      const site = siteFromRow(row, index);
      const point = screenPoint(site, center, zoom);
      if (point.x > -20 && point.x < MAP_WIDTH + 20 && point.y > -20 && point.y < MAP_HEIGHT + 20) {
        candidates.push({ site, point });
      }
    }

    return candidates
      .sort((left, right) => {
        const leftDistance = (left.point.x - MAP_WIDTH / 2) ** 2 + (left.point.y - MAP_HEIGHT / 2) ** 2;
        const rightDistance = (right.point.x - MAP_WIDTH / 2) ** 2 + (right.point.y - MAP_HEIGHT / 2) ** 2;
        return leftDistance - rightDistance;
      })
      .slice(0, 140);
  }, [center, sites, zoom]);

  const searchResults = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase("ro");
    if (query.length < 2) return [];
    const exactMatches: OrangeNetworkSite[] = [];
    for (let index = 0; index < sites.length; index += 1) {
      const site = siteFromRow(sites[index], index);
      if (site.code.trim().toLocaleLowerCase("ro") === query) exactMatches.push(site);
    }
    return exactMatches.slice(0, 6);
  }, [deferredSearch, sites]);

  const routeCoordinates = useMemo(
    () => [endA, ...routePoints, endB].filter((point): point is Coordinate => Boolean(point)),
    [endA, endB, routePoints]
  );
  const routeScreenPoints = routeCoordinates.map((point) => screenPoint(point, center, zoom));
  const routeDistance = routeCoordinates.slice(1).reduce(
    (total, point, index) => total + distanceBetween(routeCoordinates[index], point),
    0
  );
  const incompleteCableMethod = selectedInstallationMethods.find((method) => !cableTypes[method].trim());
  const incompleteLengthMethod = selectedInstallationMethods.find((method) => !parseLengthMeters(installationLengths[method]));
  const incompleteAerialMaterial = selectedInstallationMethods.includes("aerial")
    ? aerialMaterials.find((material) => !parseMaterialQuantity(aerialMaterialQuantities[material]))
    : undefined;
  const totalInstalledLength = selectedInstallationMethods.reduce(
    (total, method) => total + parseLengthMeters(installationLengths[method]),
    0
  );
  const requiredRoutePhotos = requiredPhotosForLength(totalInstalledLength);
  const geotaggedRoutePhotos = routePhotos.filter((photo) => photo.geotagged).length;
  const missingRoutePhotos = Math.max(0, requiredRoutePhotos - geotaggedRoutePhotos);
  const routePhotoProgress = requiredRoutePhotos ? Math.min(100, Math.round((geotaggedRoutePhotos / requiredRoutePhotos) * 100)) : 0;
  const undocumentedJunctionTypeReady = endB?.documented !== false || Boolean(undocumentedJunctionType);
  const undocumentedJunctionNetworkReady = endB?.documented !== false || Boolean(undocumentedJunctionNetwork);
  const undocumentedJunctionReady = undocumentedJunctionTypeReady && undocumentedJunctionNetworkReady;
  const routeReady = Boolean(
    endA &&
    endB &&
    undocumentedJunctionReady &&
    (surveyMode || (
      selectedInstallationMethods.length &&
      !incompleteCableMethod &&
      !incompleteLengthMethod &&
      !incompleteAerialMaterial &&
      requiredRoutePhotos &&
      !missingRoutePhotos
    ))
  );

  function resetRoute() {
    setEndA(null);
    setEndB(null);
    setUndocumentedJunctionType("");
    setUndocumentedJunctionNetwork("");
    setRoutePoints([]);
    setCurrentLocation(null);
    setSelectedInstallationMethods([]);
    setCableTypes({ aerial: "", duct: "", tray: "", facade: "" });
    setInstallationLengths({ aerial: "", duct: "", tray: "", facade: "" });
    setAerialMaterialQuantities({ boat: "", stainlessClamp: "", hook: "", armorod: "" });
    setRoutePhotos([]);
    setMode("client");
  }

  function toggleInstallationMethod(method: InstallationMethod) {
    setSelectedInstallationMethods((current) =>
      current.includes(method) ? current.filter((item) => item !== method) : [...current, method]
    );
    if (selectedInstallationMethods.includes(method)) {
      setCableTypes((current) => ({ ...current, [method]: "" }));
      setInstallationLengths((current) => ({ ...current, [method]: "" }));
      if (method === "aerial") {
        setAerialMaterialQuantities({ boat: "", stainlessClamp: "", hook: "", armorod: "" });
      }
    }
  }

  function setDocumentedEnd(site: OrangeNetworkSite) {
    setEndB({
      id: site.id,
      code: site.code,
      name: site.name,
      detail: [site.address, site.city, site.county].filter(Boolean).join(" · "),
      lat: site.lat,
      lon: site.lon,
      documented: true,
    });
    setUndocumentedJunctionType("");
    setUndocumentedJunctionNetwork("");
    setCenter({ lat: site.lat, lon: site.lon });
    setZoom((current) => Math.max(current, 15));
    setSearch("");
    setMode(endA ? "route" : "client");
  }

  function mapCoordinate(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * MAP_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * MAP_HEIGHT;
    const projectedCenter = project(center, zoom);
    return unproject(
      {
        x: projectedCenter.x + x - MAP_WIDTH / 2,
        y: projectedCenter.y + y - MAP_HEIGHT / 2,
      },
      zoom
    );
  }

  function handleMapClick(event: MouseEvent<HTMLDivElement>) {
    if (mapGestures.consumeSuppressedClick() || mode === "pan") return;
    const coordinate = mapCoordinate(event);
    if (mode === "client") {
      setEndA({
        ...coordinate,
        id: `client-${projectItem.id}`,
        code: projectItem.id,
        name: projectItem.client,
        detail: projectItem.address,
        documented: true,
      });
      return;
    }
    if (mode === "undocumented") {
      setEndB({
        ...coordinate,
        id: `undocumented-${Date.now()}`,
        code: "Fără cod",
        name: "Joncțiune nedocumentată",
        detail: "Punct introdus de tehnician pe hartă",
        documented: false,
      });
      setUndocumentedJunctionType("");
      setUndocumentedJunctionNetwork("");
      setMode(endA ? "route" : "client");
      return;
    }
    setRoutePoints((current) => [...current, coordinate]);
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
        setEndA({
          ...coordinate,
          id: `client-${projectItem.id}`,
          code: projectItem.id,
          name: projectItem.client,
          detail: `${projectItem.address} · poziție GPS`,
          documented: true,
        });
        setCenter(coordinate);
        setZoom(17);
        setMode("route");
        setGpsLoading(false);
        onNotify(`Locația curentă a fost identificată și setată ca Client A · precizie ±${Math.round(coords.accuracy)} m.`);
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
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 }
    );
  }

  function captureRoutePhotos(files?: FileList | null) {
    const selectedFiles = files ? Array.from(files) : [];
    if (!selectedFiles.length) return;

    const capturedAt = new Intl.DateTimeFormat("ro-RO", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    const additions: RoutePhoto[] = selectedFiles.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      geo: "Se preia locația…",
      capturedAt,
      geotagged: false,
    }));
    const addedIds = new Set(additions.map((photo) => photo.id));
    setRoutePhotos((current) => [...current, ...additions]);

    const updateAddedPhotos = async (geo: string, geotagged: boolean) => {
      setRoutePhotos((current) => current.map((photo) =>
        addedIds.has(photo.id) ? { ...photo, geo, geotagged } : photo
      ));
      for (const [index, file] of selectedFiles.entries()) {
        try {
          const stored = await uploadProjectFile({ projectId: projectItem.id, section: "route", category: "route-photo", file, geo });
          setRoutePhotos((current) => current.map((photo) => photo.id === additions[index].id
            ? { id: stored.id, name: stored.name, geo: stored.geo || geo, capturedAt: formatCapturedAt(stored.capturedAt), geotagged }
            : photo));
        } catch (error) {
          setRoutePhotos((current) => current.filter((photo) => photo.id !== additions[index].id));
          onNotify(error instanceof Error ? error.message : "Fotografia traseului nu a putut fi salvată.");
        }
      }
    };

    if (!window.isSecureContext || !navigator.geolocation) {
      void updateAddedPhotos("GPS indisponibil", false);
      onNotify("Fotografiile au nevoie de acces GPS pentru a fi considerate valide.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void updateAddedPhotos(`${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)} · ±${Math.round(coords.accuracy)} m`, true);
        onNotify(`${additions.length} ${additions.length === 1 ? "fotografie geolocalizată" : "fotografii geolocalizate"} adăugate la traseu.`);
      },
      (error) => {
        const message = error.code === 1 ? "Permisiune GPS blocată" : error.code === 3 ? "Localizare expirată" : "Poziție indisponibilă";
        void updateAddedPhotos(message, false);
        onNotify("Permite accesul la locație; fotografiile fără GPS nu intră în numărul obligatoriu.");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 }
    );
  }

  function panMap(deltaX: number, deltaY: number) {
    const projectedCenter = project(center, zoom);
    setCenter(unproject({ x: projectedCenter.x + deltaX, y: projectedCenter.y + deltaY }, zoom));
  }

  function fitRoute() {
    if (!routeCoordinates.length) return;
    const latitude = routeCoordinates.reduce((sum, point) => sum + point.lat, 0) / routeCoordinates.length;
    const longitude = routeCoordinates.reduce((sum, point) => sum + point.lon, 0) / routeCoordinates.length;
    setCenter({ lat: latitude, lon: longitude });
    if (routeCoordinates.length === 1) setZoom(17);
  }

  async function saveRoute() {
    if (noIntervention) {
      const reason = noInterventionReason.trim();
      if (!reason) {
        onNotify("Completează motivul pentru care nu s-a intervenit la traseul FO.");
        return;
      }
      const summary: RouteFieldSummary = {
        noIntervention: true,
        noInterventionReason: reason,
        segments: [],
        totalLengthMeters: 0,
        junction: { label: "Nu s-a intervenit", documented: true, kind: "documented" },
        aerialMaterials: { boat: 0, stainlessClamp: 0, hook: 0, armorod: 0 },
        routePoints: [],
      };
      try {
        await onSaved?.(summary);
        onNotify(`Traseul FO pentru ${projectItem.id} a fost salvat ca „Nu s-a intervenit”.`);
      } catch (error) {
        onNotify(error instanceof Error ? error.message : "Traseul FO nu a putut fi salvat.");
      }
      return;
    }
    if (!endA || !endB) {
      onNotify("Completează capătul A și capătul B înainte de salvare.");
      return;
    }
    if (!undocumentedJunctionTypeReady) {
      onNotify("Alege dacă joncțiunea nedocumentată este existentă sau nou instalată în cadrul proiectului.");
      return;
    }
    if (!undocumentedJunctionNetworkReady) {
      onNotify("Alege dacă joncțiunea nedocumentată aparține rețelei Orange Mobil sau Orange Fixed.");
      return;
    }
    if (!surveyMode && !selectedInstallationMethods.length) {
      onNotify("Selectează cel puțin un tip de instalare pentru traseul FO.");
      return;
    }
    if (!surveyMode && incompleteCableMethod) {
      onNotify(`Completează tipul de cablu pentru „${installationCatalog[incompleteCableMethod].title}”.`);
      return;
    }
    if (!surveyMode && incompleteLengthMethod) {
      onNotify(`Completează lungimea instalată pentru „${installationCatalog[incompleteLengthMethod].title}”.`);
      return;
    }
    if (!surveyMode && incompleteAerialMaterial) {
      onNotify(`Completează cantitatea pentru „${aerialMaterialCatalog[incompleteAerialMaterial]}” la instalarea aeriană.`);
      return;
    }
    if (!surveyMode && missingRoutePhotos) {
      onNotify(`Mai sunt necesare ${missingRoutePhotos} ${missingRoutePhotos === 1 ? "fotografie geolocalizată" : "fotografii geolocalizate"} pentru această lungime.`);
      return;
    }
    const junctionDetail = endB.documented
      ? "joncțiune documentată"
      : undocumentedJunctionType === "existing"
        ? "joncțiune nedocumentată existentă"
        : "joncțiune nedocumentată nou instalată";
    const networkDetail = endB.documented
      ? ""
      : ` · ${undocumentedJunctionNetwork === "mobile" ? "Orange Mobil" : "Orange Fixed"}`;
    const summary: RouteFieldSummary = {
      noIntervention: false,
      noInterventionReason: "",
      segments: surveyMode ? [] : selectedInstallationMethods.map((method) => ({
        method,
        label: installationCatalog[method].title,
        cableType: cableTypes[method].trim(),
        lengthMeters: parseLengthMeters(installationLengths[method]),
      })),
      totalLengthMeters: surveyMode ? Math.round(routeDistance) : totalInstalledLength,
      junction: {
        label: endB.documented ? `${endB.code} · ${endB.name}` : `Joncțiune nedocumentată · ${undocumentedJunctionType === "new" ? "nou instalată" : "existentă"}`,
        documented: endB.documented,
        kind: endB.documented ? "documented" : undocumentedJunctionType as "existing" | "new",
        network: endB.documented ? undefined : undocumentedJunctionNetwork as "mobile" | "fixed",
      },
      aerialMaterials: {
        boat: parseMaterialQuantity(aerialMaterialQuantities.boat),
        stainlessClamp: parseMaterialQuantity(aerialMaterialQuantities.stainlessClamp),
        hook: parseMaterialQuantity(aerialMaterialQuantities.hook),
        armorod: parseMaterialQuantity(aerialMaterialQuantities.armorod),
      },
      endpoints: { a: endA, b: endB },
      routePoints,
    };
    try {
      await onSaved?.(summary);
      onNotify(surveyMode ? `Harta Survey pentru ${projectItem.id} a fost salvată · ${junctionDetail}${networkDetail} · ${formatDistance(routeDistance)}.` : `Traseul FO pentru ${projectItem.id} a fost salvat permanent · ${junctionDetail}${networkDetail} · ${formatLengthMeters(totalInstalledLength)} instalați · ${selectedInstallationMethods.length} ${selectedInstallationMethods.length === 1 ? "tip de instalare" : "tipuri de instalare"}.`);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Traseul FO nu a putut fi salvat.");
    }
  }

  async function deleteSavedRoute() {
    if (!window.confirm("Ștergi traseul FO și toate fotografiile aferente?")) return;
    setDeletingRoute(true);
    try {
      const emptySummary: RouteFieldSummary = {
        noIntervention: false,
        noInterventionReason: "",
        segments: [],
        totalLengthMeters: 0,
        junction: { label: "Traseu șters", documented: true, kind: "documented" },
        aerialMaterials: { boat: 0, stainlessClamp: 0, hook: 0, armorod: 0 },
        routePoints: [],
      };
      const removals = await Promise.allSettled(routePhotos.map((photo) => deleteProjectFile(photo.id)));
      const removedIds = new Set(routePhotos.filter((_, index) => removals[index].status === "fulfilled").map((photo) => photo.id));
      setRoutePhotos((current) => current.filter((photo) => !removedIds.has(photo.id)));
      const failed = removals.filter((result) => result.status === "rejected").length;
      if (failed) throw new Error(`${failed} fotografii nu au putut fi șterse din toate destinațiile. Reîncearcă ștergerea traseului.`);
      await onSaved?.(emptySummary);
      setRoutePhotos([]);
      resetRoute();
      setNoIntervention(false);
      setNoInterventionReason("");
      onNotify("Traseul FO și fotografiile aferente au fost șterse din aplicație, Google Drive și OneDrive.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Traseul FO nu a putut fi șters.");
    } finally {
      setDeletingRoute(false);
    }
  }

  async function removeRoutePhoto(photo: RoutePhoto) {
    try {
      await deleteProjectFile(photo.id);
      setRoutePhotos((current) => current.filter((item) => item.id !== photo.id));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Fotografia nu a putut fi ștearsă.");
    }
  }

  const modeLabel: Record<MapMode, string> = {
    pan: "Mută harta",
    client: "Plasează Client A",
    route: "Desenează traseul",
    undocumented: "Plasează joncțiunea B",
  };

  return (
    <div className={`page-wrap fo-route-page ${surveyMode ? "survey-route-page" : ""}`}>
      <section className="page-heading client-heading">
        <div>
          <p className="eyebrow">{surveyMode ? "HARTĂ SURVEY" : "DOCUMENTAȚIE TRASEU FIBRĂ OPTICĂ"}</p>
          <h1>{surveyMode ? "Hartă Survey" : "Traseu FO"}</h1>
          <p>{surveyMode ? "Marchează clientul, traseul propus și joncțiunea observată." : "Marchează clientul, alege joncțiunea și trasează cablul direct pe hartă."}</p>
        </div>
        <div className="field-technician">
          <span className="avatar">{projectItem.technician.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
          <div><small>TEHNICIAN ALOCAT</small><strong>{projectItem.technician}</strong></div>
        </div>
      </section>

      <section className="fo-project-bar">
        <div className="fo-project-identity"><span>RID</span><div><small>PROIECT ACTIV</small><strong>{projectItem.id}</strong><p>{projectItem.client}</p></div></div>
        <div className="fo-client-copy">
          <span>A</span>
          <div><small>CAPĂT CLIENT</small><strong>{projectItem.client}</strong><p>{projectItem.address}</p></div>
        </div>
        <div className={`fo-data-badge ${sitesStatus}`}>
          <span>{sitesStatus === "ready" ? "✓" : sitesStatus === "error" ? "!" : "↻"}</span>
          <div><strong>{sitesStatus === "ready" ? `${sites.length.toLocaleString("ro-RO")} puncte documentate` : sitesStatus === "error" ? "Date indisponibile" : "Se încarcă punctele"}</strong><small>Sursă: {sourceName}{rejectedSites ? ` · ${rejectedSites.toLocaleString("ro-RO")} excluse` : ""}</small></div>
        </div>
      </section>

      {!surveyMode && <NoInterventionControl
        sectionLabel="Traseu FO"
        noIntervention={noIntervention}
        reason={noInterventionReason}
        onSelectionChange={setNoIntervention}
        onReasonChange={setNoInterventionReason}
      />}

      {!surveyMode && noIntervention ? (
        <section className="no-intervention-save-card">
          <span>—</span>
          <div><strong>Traseu FO fără intervenție</strong><p>Nu sunt necesare traseul pe hartă, materialele, lungimile sau fotografiile de execuție. Motivul introdus va apărea în raport.</p></div>
          <button className="primary-button" onClick={saveRoute}>Salvează secțiunea <span>→</span></button>
        </section>
      ) : <div className="fo-route-layout">
        <div className="fo-map-column">
          <section className={`fo-map-card ${mapFullscreen.fullscreen ? "map-fullscreen" : ""}`}>
            <div className="fo-map-head">
              <div><small>MOD ACTIV</small><strong>{modeLabel[mode]}</strong></div>
              <div className="fo-map-actions">
                <button className={mode === "client" ? "active" : ""} onClick={() => setMode("client")}>Client</button>
                <button className={mode === "route" ? "active" : ""} onClick={() => setMode("route")}><span>⌁</span> Trasează</button>
                <button className={mode === "undocumented" ? "active" : ""} onClick={() => setMode("undocumented")}>J fără cod</button>
                <button
                  className="fo-fullscreen-toggle"
                  onClick={mapFullscreen.toggleFullscreen}
                  aria-pressed={mapFullscreen.fullscreen}
                  aria-label={mapFullscreen.fullscreen ? "Închide harta pe tot ecranul" : "Deschide harta pe tot ecranul"}
                ><span>{mapFullscreen.fullscreen ? "×" : "⛶"}</span> {mapFullscreen.fullscreen ? "Închide" : "Ecran complet"}</button>
              </div>
            </div>

            <div
              className={`fo-map mode-${mode}`}
              role="application"
              aria-label="Hartă OpenStreetMap pentru trasarea cablului de fibră optică"
              onClick={handleMapClick}
              onPointerDown={mapGestures.onPointerDown}
              onPointerMove={mapGestures.onPointerMove}
              onPointerUp={mapGestures.onPointerUp}
              onPointerCancel={mapGestures.onPointerCancel}
              onWheel={mapGestures.onWheel}
            >
              <div className="fo-map-tiles" aria-hidden="true">
                {tiles.map((tile) => (
                  <img
                    key={tile.key}
                    src={`https://tile.openstreetmap.org/${tile.sourceZoom}/${tile.urlX}/${tile.urlY}.png`}
                    alt=""
                    draggable={false}
                    style={{
                      left: `${(tile.x / MAP_WIDTH) * 100}%`,
                      top: `${(tile.y / MAP_HEIGHT) * 100}%`,
                      width: `${(tile.size / MAP_WIDTH) * 100}%`,
                      height: `${(tile.size / MAP_HEIGHT) * 100}%`,
                    }}
                  />
                ))}
              </div>

              <svg className="fo-route-line" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
                {routeScreenPoints.length > 1 && (
                  <>
                    <polyline className="route-shadow" points={routeScreenPoints.map((point) => `${point.x},${point.y}`).join(" ")} />
                    <polyline className="route-cable" points={routeScreenPoints.map((point) => `${point.x},${point.y}`).join(" ")} />
                  </>
                )}
              </svg>

              {visibleSites.map(({ site, point }) => (
                <button
                  className={`fo-site-marker ${mapSiteMarkerClass(site.code)} ${endB?.id === site.id ? "selected" : ""}`}
                  style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }}
                  key={site.id}
                  title={`${site.code} · ${site.name}`}
                  aria-label={`Alege joncțiunea ${site.code}, ${site.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDocumentedEnd(site);
                  }}
                ><i /></button>
              ))}

              {routePoints.map((point, index) => {
                const screen = screenPoint(point, center, zoom);
                return <span className="fo-route-point" key={`${point.lat}-${point.lon}-${index}`} style={{ left: `${(screen.x / MAP_WIDTH) * 100}%`, top: `${(screen.y / MAP_HEIGHT) * 100}%` }}>{index + 1}</span>;
              })}

              {endA && (() => {
                const point = screenPoint(endA, center, zoom);
                return <span className="fo-placed-dot client-dot" aria-label="Punct client" style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }} />;
              })()}
              {endB && (() => {
                const point = screenPoint(endB, center, zoom);
                return <span className={`fo-placed-dot junction-dot ${endB.documented ? "" : "undocumented"}`} aria-label="Punct joncțiune" style={{ left: `${(point.x / MAP_WIDTH) * 100}%`, top: `${(point.y / MAP_HEIGHT) * 100}%` }} />;
              })()}

              <div className="fo-map-instruction"><span>{mode === "pan" ? "✥" : mode === "client" ? "A" : mode === "route" ? "⌁" : "B?"}</span>{mode === "pan" ? "Glisează harta · apropie două degete pentru zoom" : mode === "client" ? "Atinge pentru Client A · glisează sau folosește pinch zoom" : mode === "route" ? "Atinge pentru punct · glisează sau folosește pinch zoom" : "Atinge pentru joncțiune · glisează sau folosește pinch zoom"}</div>
              <div className="fo-route-live-distance" aria-live="polite"><small>LUNGIME TRASEU</small><strong>{formatLengthMeters(Math.round(routeDistance))}</strong></div>

              <button
                className={`fo-locate-button ${currentLocation ? "located" : ""}`}
                onClick={(event) => { event.stopPropagation(); locateCurrentPosition(); }}
                disabled={gpsLoading}
                aria-label="Identifică locația curentă și setează Client A"
              >
                <span className={gpsLoading ? "loading" : ""}>{gpsLoading ? "↻" : currentLocation ? "✓" : "⌖"}</span>
                <div><strong>{gpsLoading ? "Se caută poziția…" : currentLocation ? "Locație identificată" : "Locația mea"}</strong><small>{currentLocation ? `Precizie ±${Math.round(currentLocation.accuracy)} m` : "Setează automat Client A"}</small></div>
              </button>

              <div className="fo-zoom" onClick={(event) => event.stopPropagation()}>
                <button onClick={() => setZoom((current) => clamp(current + 1, 7, 25))} aria-label="Mărește harta">＋</button>
                <button onClick={() => setZoom((current) => clamp(current - 1, 7, 25))} aria-label="Micșorează harta">−</button>
              </div>
              <div className="fo-pan-pad" onClick={(event) => event.stopPropagation()}>
                <button onClick={() => panMap(0, -160)} aria-label="Mută harta spre nord">↑</button>
                <button onClick={() => panMap(-160, 0)} aria-label="Mută harta spre vest">←</button>
                <button onClick={fitRoute} aria-label="Centrează traseul">⌾</button>
                <button onClick={() => panMap(160, 0)} aria-label="Mută harta spre est">→</button>
                <button onClick={() => panMap(0, 160)} aria-label="Mută harta spre sud">↓</button>
              </div>
              <a className="fo-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>© OpenStreetMap contributors</a>
            </div>

          <MapSiteLegend />
            <div className="fo-map-footer">
              <button onClick={locateCurrentPosition} disabled={gpsLoading}><span>⌖</span>{gpsLoading ? "Se caută GPS…" : "Identifică locația curentă"}</button>
              <button onClick={() => setRoutePoints((current) => current.slice(0, -1))} disabled={!routePoints.length}><span>↶</span>Anulează ultimul punct</button>
              <button onClick={() => setRoutePoints([])} disabled={!routePoints.length}><span>⌫</span>Șterge traseul</button>
              <button onClick={() => resetRoute()}><span>↻</span>Reset complet</button>
            </div>
          </section>
        </div>

        <aside className="fo-route-side">
          <section className="fo-search-card">
            <div className="fo-side-title"><span>B</span><div><h2>Joncțiune documentată</h2><p>Alege un punct pe hartă sau caută în registru.</p></div></div>
            <label className="fo-site-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Introdu codul exact, ex. J2…" /></label>
            {search.length >= 2 && (
              <div className="fo-search-results">
                {searchResults.filter((site) => site.code.trim().toLocaleLowerCase("ro") === search.trim().toLocaleLowerCase("ro")).map((site) => (
                  <article className={endB?.id === site.id ? "selected" : ""} key={site.id}>
                    <button className="fo-exact-junction-name" onClick={() => setDocumentedEnd(site)}>
                      <strong>{site.code}</strong>
                      <b>Arată pe hartă</b>
                    </button>
                    <a href={googleMapsUrl(site)} target="_blank" rel="noreferrer" aria-label={`Deschide joncțiunea ${site.code} în Google Maps`}>Google Maps ↗</a>
                  </article>
                ))}
                {!searchResults.some((site) => site.code.trim().toLocaleLowerCase("ro") === search.trim().toLocaleLowerCase("ro")) && <p>Nicio joncțiune cu acest cod.</p>}
              </div>
            )}
            {endB?.documented && (
              <div className="fo-selected-junction">
                <div><small>JONCȚIUNE SELECTATĂ</small><strong>{endB.code} · {endB.name}</strong><span>{formatCoordinate(endB)}</span></div>
                <button onClick={() => { setCenter({ lat: endB.lat, lon: endB.lon }); setZoom((current) => Math.max(current, 18)); }}>Arată punctul</button>
                <a href={googleMapsUrl(endB)} target="_blank" rel="noreferrer">Google Maps ↗</a>
              </div>
            )}
            <button className="fo-undocumented-button" onClick={() => setMode("undocumented")}><span>＋</span><div><strong>Joncțiune nedocumentată</strong><small>Plasează manual capătul B pe hartă</small></div></button>
            {endB?.documented === false && (
              <fieldset className="fo-undocumented-type">
                <legend>TIP JONCȚIUNE NEDOCUMENTATĂ *</legend>
                <p>Punctul B este plasat. Alege situația din teren.</p>
                <div>
                  {(["existing", "new"] as const).map((junctionType) => (
                    <label className={undocumentedJunctionType === junctionType ? "selected" : ""} key={junctionType}>
                      <input
                        type="radio"
                        name="undocumented-junction-type"
                        value={junctionType}
                        checked={undocumentedJunctionType === junctionType}
                        onChange={() => setUndocumentedJunctionType(junctionType)}
                      />
                      <span>{junctionType === "existing" ? "EX" : "NOU"}</span>
                      <div>
                        <strong>{undocumentedJunctionLabels[junctionType]}</strong>
                        <small>{junctionType === "existing" ? "Era deja prezentă în teren" : "Instalată în această lucrare"}</small>
                      </div>
                      <i aria-hidden="true" />
                    </label>
                  ))}
                </div>
                <div className="fo-undocumented-network">
                  <span>REȚEA ORANGE *</span>
                  <p>Selectează rețeaua din care face parte joncțiunea.</p>
                  <div>
                    {(["mobile", "fixed"] as const).map((network) => (
                      <label className={undocumentedJunctionNetwork === network ? "selected" : ""} key={network}>
                        <input
                          type="radio"
                          name="undocumented-junction-network"
                          value={network}
                          checked={undocumentedJunctionNetwork === network}
                          onChange={() => setUndocumentedJunctionNetwork(network)}
                        />
                        <span>{network === "mobile" ? "MOB" : "FIX"}</span>
                        <div>
                          <strong>{undocumentedJunctionNetworkLabels[network]}</strong>
                          <small>{network === "mobile" ? "Rețeaua Orange Mobil" : "Rețeaua Orange Fixed"}</small>
                        </div>
                        <i aria-hidden="true" />
                      </label>
                    ))}
                  </div>
                </div>
              </fieldset>
            )}
          </section>

          <section className="fo-cable-card">
            <div className="fo-side-title"><span>FO</span><div><h2>Tip instalare și cablu</h2><p>Selectează toate metodele folosite și cablul instalat pentru fiecare.</p></div></div>
            <div className="fo-installation-list">
              {installationMethods.map((method) => {
                const item = installationCatalog[method];
                const selectedMethod = selectedInstallationMethods.includes(method);
                return (
                  <article className={selectedMethod ? "selected" : ""} key={method}>
                    <label className="fo-method-toggle">
                      <input type="checkbox" checked={selectedMethod} onChange={() => toggleInstallationMethod(method)} />
                      <span className="fo-method-symbol">{item.symbol}</span>
                      <div><strong>{item.title}</strong><small>{item.description}</small></div>
                      <i aria-hidden="true" />
                    </label>
                    {selectedMethod && (
                      <div className="fo-installation-fields">
                        <label className="fo-cable-input">
                          <span>TIP CABLU INSTALAT *</span>
                          <select value={cableTypes[method]} onChange={(event) => setCableTypes((current) => ({ ...current, [method]: event.target.value }))}>
                            <option value="">Selectează tipul cablului</option>
                            {[4, 12, 24, 48, 96].map((fibers) => <option key={fibers} value={`Cablu FO ${fibers}F`}>{fibers} fibre</option>)}
                          </select>
                        </label>
                        <label className="fo-length-input">
                          <span>LUNGIME *</span>
                          <div><input
                            value={installationLengths[method]}
                            onChange={(event) => setInstallationLengths((current) => ({ ...current, [method]: event.target.value }))}
                            inputMode="decimal"
                            aria-label={`Lungime instalată pentru ${item.title}, în metri`}
                            placeholder="0"
                          /><b>m</b></div>
                        </label>
                        {method === "aerial" && (
                          <div className="fo-aerial-materials">
                            <div className="fo-aerial-materials-title">
                              <span>MATERIALE INSTALARE AERIANĂ *</span>
                              <small>Introdu cantitatea folosită pentru fiecare material.</small>
                            </div>
                            <div className="fo-aerial-material-grid">
                              {aerialMaterials.map((material) => (
                                <label key={material}>
                                  <span>{aerialMaterialCatalog[material]}</span>
                                  <div>
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      inputMode="numeric"
                                      value={aerialMaterialQuantities[material]}
                                      onChange={(event) => setAerialMaterialQuantities((current) => ({
                                        ...current,
                                        [material]: event.target.value,
                                      }))}
                                      aria-label={`Cantitate ${aerialMaterialCatalog[material]}`}
                                      placeholder="0"
                                    />
                                    <b>buc.</b>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="fo-route-photo-card">
            <div className="fo-side-title"><span>PH</span><div><h2>Fotografii traseu</h2><p>Numărul obligatoriu este calculat din totalul cablului instalat.</p></div></div>
            <div className="fo-photo-rules" aria-label="Număr obligatoriu de fotografii în funcție de lungime">
              <span className={totalInstalledLength > 0 && totalInstalledLength <= 100 ? "active" : ""}><b>≤100 m</b><small>3 poze</small></span>
              <span className={totalInstalledLength > 100 && totalInstalledLength <= 200 ? "active" : ""}><b>101–200 m</b><small>5 poze</small></span>
              <span className={totalInstalledLength > 200 && totalInstalledLength <= 300 ? "active" : ""}><b>201–300 m</b><small>10 poze</small></span>
              <span className={totalInstalledLength > 300 ? "active" : ""}><b>&gt;300 m</b><small>15 poze</small></span>
            </div>
            <div className="fo-photo-progress">
              <div><span>POZE GEOLOCALIZATE</span><strong>{geotaggedRoutePhotos}/{requiredRoutePhotos || "—"}</strong></div>
              <i><b style={{ width: `${routePhotoProgress}%` }} /></i>
              <p>{requiredRoutePhotos ? missingRoutePhotos ? `Mai sunt necesare ${missingRoutePhotos}.` : "Cerința foto este completă." : "Completează lungimile pentru a calcula necesarul."}</p>
            </div>
            <label className={`fo-route-photo-upload ${!requiredRoutePhotos ? "disabled" : ""}`}>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                disabled={!requiredRoutePhotos}
                onChange={(event) => { captureRoutePhotos(event.target.files); event.currentTarget.value = ""; }}
              />
              <span>＋</span>
              <div><strong>Adaugă fotografii cu GPS</strong><small>Poți selecta sau fotografia mai multe cadre</small></div>
            </label>
            {routePhotos.length > 0 && (
              <div className="fo-route-photo-list">
                {routePhotos.map((photo, index) => (
                  <article className={photo.geotagged ? "valid" : ""} key={photo.id}>
                    <span>{photo.geotagged ? "✓" : "!"}</span>
                    <div><strong>{index + 1}. {photo.name}</strong><small>⌖ {photo.geo} · {photo.capturedAt}</small></div>
                    <button onClick={() => void removeRoutePhoto(photo)} aria-label={`Șterge fotografia ${photo.name}`}>×</button>
                  </article>
                ))}
              </div>
            )}
            <div className="fo-photo-geo-note"><span>⌖</span><p>Fotografiile fără coordonate GPS nu sunt incluse în numărul obligatoriu.</p></div>
          </section>

          <section className="fo-summary-card">
            <div className="summary-title"><span>⌁</span><div><h2>Fișa traseului</h2><p>{projectItem.id} · {projectItem.client}</p></div></div>
            <div className="fo-end-list">
              <article className={endA ? "complete" : ""}>
                <span>A</span>
                <div><small>CAPĂT A · CLIENT</small><strong>{endA?.name ?? "Poziție necompletată"}</strong><p>{endA ? formatCoordinate(endA) : "Folosește GPS sau plasează pe hartă"}</p></div>
                <b>{endA ? "✓" : "○"}</b>
              </article>
              <i />
              <article className={endB && undocumentedJunctionReady ? "complete" : ""}>
                <span>B</span>
                <div>
                  <small>{endB?.documented === false ? `CAPĂT B · ${undocumentedJunctionType ? undocumentedJunctionLabels[undocumentedJunctionType].toUpperCase() : "TIP NEALES"} · ${undocumentedJunctionNetwork ? undocumentedJunctionNetworkLabels[undocumentedJunctionNetwork].toUpperCase() : "REȚEA NEALEASĂ"}` : "CAPĂT B · JONCȚIUNE"}</small>
                  <strong>{endB ? `${endB.code} · ${endB.name}` : "Joncțiune neselectată"}</strong>
                  <p>{endB ? formatCoordinate(endB) : "Alege un marker sau plasează fără cod"}</p>
                </div>
                <b>{endB && undocumentedJunctionReady ? "✓" : "○"}</b>
              </article>
            </div>
            <div className={`fo-route-metrics ${surveyMode ? "survey-metrics" : ""}`}>
              <div><small>LUNGIME DESENATĂ</small><strong>{routeCoordinates.length > 1 ? formatDistance(routeDistance) : "—"}</strong></div>
              <div><small>PUNCTE INTERMEDIARE</small><strong>{routePoints.length}</strong></div>
              {!surveyMode && <div><small>TOTAL CABLU INSTALAT</small><strong>{totalInstalledLength ? formatLengthMeters(totalInstalledLength) : "—"}</strong></div>}
              {!surveyMode && <div><small>POZE TRASEU</small><strong>{geotaggedRoutePhotos}/{requiredRoutePhotos || "—"}</strong></div>}
            </div>
            {selectedInstallationMethods.length > 0 && (
              <div className="fo-cable-summary">
                <small>INSTALARE ȘI CABLU</small>
                {selectedInstallationMethods.map((method) => (
                  <div key={method}>
                    <span>{installationCatalog[method].symbol}</span>
                    <p>
                      <strong>{installationCatalog[method].title}</strong>
                      <b>{cableTypes[method] || "Tip cablu necompletat"} · {parseLengthMeters(installationLengths[method]) ? formatLengthMeters(parseLengthMeters(installationLengths[method])) : "lungime necompletată"}</b>
                      {method === "aerial" && (
                        <em>{aerialMaterials.map((material) => `${aerialMaterialCatalog[material]}: ${parseMaterialQuantity(aerialMaterialQuantities[material]) || "—"} buc.`).join(" · ")}</em>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <div className="fo-route-status">
              <span className={routeReady ? "ready" : ""}>{routeReady ? "✓" : "i"}</span>
              <p>
                <strong>{routeReady ? (surveyMode ? "Harta Survey este pregătită pentru salvare" : "Traseu pregătit pentru salvare") : !endA || !endB ? "Mai sunt necesare capetele A și B" : !undocumentedJunctionTypeReady ? "Clasifică joncțiunea nedocumentată" : !undocumentedJunctionNetworkReady ? "Selectează rețeaua joncțiunii" : !selectedInstallationMethods.length ? "Selectează tipul de instalare" : incompleteCableMethod ? "Completează tipul de cablu" : incompleteLengthMethod ? "Completează lungimea instalată" : incompleteAerialMaterial ? "Completează materialele instalării aeriene" : "Completează documentarea foto"}</strong>
                {routeReady ? (surveyMode ? "Clientul, traseul și joncțiunea sunt documentate." : "Capetele, traseul, cablurile, materialele, lungimile și fotografiile sunt documentate.") : !endA || !endB ? "Selectează punctele direct pe hartă." : !undocumentedJunctionTypeReady ? "Alege dacă punctul B este o joncțiune existentă sau nou instalată." : !undocumentedJunctionNetworkReady ? "Alege Orange Mobil sau Orange Fixed pentru punctul B." : !selectedInstallationMethods.length ? "Poți folosi una sau mai multe metode pe traseu." : incompleteCableMethod ? `Lipsește cablul pentru ${installationCatalog[incompleteCableMethod].title.toLowerCase()}.` : incompleteLengthMethod ? `Lipsește lungimea pentru ${installationCatalog[incompleteLengthMethod].title.toLowerCase()}.` : incompleteAerialMaterial ? `Lipsește cantitatea pentru ${aerialMaterialCatalog[incompleteAerialMaterial].toLowerCase()}.` : `Mai sunt necesare ${missingRoutePhotos} fotografii cu geolocație.`}
              </p>
            </div>
            <div className="record-actions"><button className="primary-button fo-save-route" onClick={saveRoute}>{surveyMode ? "Salvează harta Survey" : "Salvează traseul FO"} <span>→</span></button>{!surveyMode && (initialSummary || routePhotos.length > 0) && <button type="button" className="record-delete-button" onClick={() => void deleteSavedRoute()} disabled={deletingRoute}>{deletingRoute ? "Se șterge…" : "Șterge traseul FO"}</button>}</div>
          </section>
        </aside>
      </div>}
    </div>
  );
}
