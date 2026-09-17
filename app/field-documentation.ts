export type RouteMethod = "aerial" | "duct" | "tray" | "facade";

export type RouteSegmentSummary = {
  method: RouteMethod;
  label: string;
  cableType: string;
  lengthMeters: number;
};

export type RouteFieldSummary = {
  noIntervention?: boolean;
  noInterventionReason?: string;
  segments: RouteSegmentSummary[];
  totalLengthMeters: number;
  junction: {
    label: string;
    documented: boolean;
    kind: "documented" | "existing" | "new";
    network?: "mobile" | "fixed";
  };
  aerialMaterials: {
    boat: number;
    stainlessClamp: number;
    hook: number;
    armorod: number;
  };
  endpoints?: {
    a: { id: string; code: string; name: string; detail: string; documented: boolean; lat: number; lon: number };
    b: { id: string; code: string; name: string; detail: string; documented: boolean; lat: number; lon: number };
  };
  routePoints?: Array<{ lat: number; lon: number }>;
};

export type SpliceConnection = {
  siteBuffer: string;
  siteFiber: string;
  clientBuffer: string;
  clientFiber: string;
};

export type SpliceFieldSummary = {
  noIntervention?: boolean;
  noInterventionReason?: string;
  count: number;
  junctions: Array<{
    label: string;
    documented: boolean;
    kind: "documented" | "existing" | "new";
  }>;
  records?: Array<{
    id: string;
    projectId: string;
    junction: { id: string; code: string; name: string; region: string; documented: boolean; lat: number; lon: number };
    junctionKind: "" | "existing" | "new";
    network: "" | "mobile" | "fixed";
    siteCableType?: string;
    clientCableType?: string;
    spliceMode?: "fiber" | "end-to-end";
    spliceCount?: number;
    connections?: SpliceConnection[];
    siteBuffer: string;
    siteFiber: string;
    clientBuffer: string;
    clientFiber: string;
    photos: Record<"open" | "closed" | "placed", string>;
  }>;
};

export type ClientSfpType = "SFP 1Gb A SC" | "SFP 1Gb A LC" | "SFP 10Gb A LC";
export type SiteSfpType = "SFP 1Gb B SC" | "SFP 1Gb B LC" | "SFP 10Gb B LC";
export type FieldMediaConverterType = "100 Mbps" | "1 Gbps" | "JumboFrame";

export type SiteFieldSummary = {
  noIntervention?: boolean;
  noInterventionReason?: string;
  odf: string;
  odfPort: string;
  etn: string;
  etnPort: string;
  mediaConverterInstalled?: boolean;
  mediaConverterType?: FieldMediaConverterType | "";
  sfpInstalled?: boolean;
  sfpType?: SiteSfpType | "";
  photos?: Record<"odfPort" | "etn" | "overview", string>;
};

export type ClientFieldSummary = {
  noIntervention?: boolean;
  noInterventionReason?: string;
  clientHasNoGroundingSystem?: boolean;
  service: "Internet" | "VPN" | "Internet+OL" | "OL";
  equipment: string[];
  sfpQuantity?: number;
  sfpType?: ClientSfpType | "";
};

export type InterventionDamageType = "FO cut" | "Atenuare" | "Echipament";

export type InterventionCause =
  | "Accident-Orice tip de accident (masina,etc.)"
  | "Clima-Alunecari de teren, viituri, furtuna, etc…"
  | "Defect-Defect cablu/cutie jonctiune, etc,…"
  | "Lucrari infrastructura-Lucrari efectuate de companiile nationale"
  | "Lucrari civile-Lucrari efectuate de persoane fizice"
  | "Primarie-Decizii primarie de a taia cablul"
  | "Vandalism-Furt";

export type InterventionAssessmentSummary = {
  damageType: InterventionDamageType;
  cause?: InterventionCause;
  damageLocation?: { lat: number; lon: number; placedAt?: number };
  photoCount: number;
  geotaggedPhotoCount: number;
  documentedAt: number;
};

export type InterventionActivityType = "fo-installation" | "junction-installation" | "chamber-installation" | "diagnostics" | "splice-repair";

export type InterventionJunction = {
  id: string;
  code: string;
  name: string;
  region: string;
  lat: number;
  lon: number;
  documented: boolean;
  kind: "documented" | "existing" | "new";
  network?: "mobile" | "fixed";
};

export type InterventionExecutionActivity = {
  id: string;
  type: InterventionActivityType;
  junction?: InterventionJunction;
  endpointA?: InterventionJunction;
  endpointB?: InterventionJunction;
  routePoints?: Array<{ lat: number; lon: number }>;
  cableType?: string;
  cableLengthMeters?: number;
  photoCount: number;
  requiredPhotoCount: number;
  documentedAt: number;
};

export type InterventionMaterialSelection = {
  source: "orange" | "proconect";
  code: string;
  description: string;
  unit: string;
  quantity: number;
};

export type InterventionExecutionSummary = {
  activities: InterventionExecutionActivity[];
  materials?: InterventionMaterialSelection[];
  documentedAt: number;
};

export type InterventionDocumentationSummary = {
  report: string;
  validatedAt: number;
  validatedBy: string;
};

export function requiredInterventionCablePhotos(lengthMeters: number) {
  if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) return 0;
  if (lengthMeters <= 100) return 3;
  if (lengthMeters <= 200) return 5;
  if (lengthMeters <= 300) return 10;
  return 15;
}

export type InterventionFieldSummary = {
  assessment?: InterventionAssessmentSummary;
  execution?: InterventionExecutionSummary;
  documentation?: InterventionDocumentationSummary;
};

export type ProjectFieldDocumentation = {
  client?: ClientFieldSummary;
  route?: RouteFieldSummary;
  splices?: SpliceFieldSummary;
  site?: SiteFieldSummary;
  intervention?: InterventionFieldSummary;
};
