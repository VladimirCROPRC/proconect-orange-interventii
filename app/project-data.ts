import type { ProjectFieldDocumentation } from "./field-documentation";

export type ProjectActivityType = "Instalare" | "Intervenție" | "Intervenție Orange" | "Survey";
export type MediaConverterType = "" | "100 Mbps" | "1 Gbps" | "JumboFrame";
export type OrangeTopology = "" | "FO BB" | "FO Local" | "VHBB";
export type OrangeRouteType = "" | "Aerian" | "Subteran" | "Mixt";
export type OrangeInterventionType = "" | "FITT" | "IMO" | "PBM";

export type CpeCatalogItem = {
  name: string;
  requiresGrounding: boolean;
};

export type ProjectRecord = {
  id: string;
  activityType: ProjectActivityType;
  orderNumber?: string;
  foSectionName?: string;
  topology?: OrangeTopology;
  cableCapacity?: number;
  routeType?: OrangeRouteType;
  orangeInterventionType?: OrangeInterventionType;
  sla?: string;
  departureLocality?: string;
  county?: string;
  client: string;
  address: string;
  contact: string;
  phone: string;
  email: string;
  requirements: string;
  technician: string;
  cpe: string;
  cpeRequiresGrounding: boolean;
  sfp: boolean;
  mc: boolean;
  mcType: MediaConverterType;
  terminalBox: boolean;
  status: "Planificat" | "În desfășurare" | "De verificat" | "Finalizat";
  date: string;
  ipwo: string;
  splice: string;
};

export const initialProjects: ProjectRecord[] = [];

export const initialCpeCatalog: CpeCatalogItem[] = [];

export const initialFieldDocumentation: Record<string, ProjectFieldDocumentation> = {};
