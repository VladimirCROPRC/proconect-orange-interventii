"use client";

export type CoordinatorPhotoAnalysis = {
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | null;
  visibleText: string;
  summary: string;
  incidentDescription: string;
  remediationDescription: string;
  junctionCode: string;
  damageType: "" | "FO cut" | "Atenuare" | "Echipament";
  cause: "" | "Accident-Orice tip de accident (masina,etc.)" | "Clima-Alunecari de teren, viituri, furtuna, etc…" | "Defect-Defect cablu/cutie jonctiune, etc,…" | "Lucrari infrastructura-Lucrari efectuate de companiile nationale" | "Lucrari civile-Lucrari efectuate de persoane fizice" | "Primarie-Decizii primarie de a taia cablul" | "Vandalism-Furt";
  routeType: "" | "Aerian" | "Subteran" | "Mixt";
  cableCapacity: number | null;
  siteCode: string;
  otdrLengthMeters: number | null;
  confidence: number;
};

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Fotografia nu a putut fi pregătită pentru interpretare."));
      element.src = url;
    });
    const landscape = image.naturalWidth >= image.naturalHeight;
    const maximumWidth = landscape ? 1024 : 768;
    const maximumHeight = landscape ? 768 : 1024;
    const scale = Math.min(1, maximumWidth / image.naturalWidth, maximumHeight / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Fotografia nu a putut fi pregătită pentru interpretare.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("Fotografia nu a putut fi pregătită pentru interpretare.")),
      "image/jpeg",
      0.82,
    ));
    return new File([blob], "coordinator-photo.jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function analyzeCoordinatorPhoto(input: {
  projectId: string;
  file: File;
  context: "assessment" | "execution-junction";
  junctionNumber?: number;
}) {
  const prepared = await loadImage(input.file);
  const form = new FormData();
  form.set("projectId", input.projectId);
  form.set("context", input.context);
  form.set("file", prepared, prepared.name);
  if (input.junctionNumber) form.set("junctionNumber", String(input.junctionNumber));
  const response = await fetch("/api/photo-analysis", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const payload = await response.json() as { analysis?: CoordinatorPhotoAnalysis; error?: string };
  if (!response.ok || !payload.analysis) throw new Error(payload.error || "Fotografia nu a putut fi interpretată.");
  return payload.analysis;
}

export function analysisCoordinates(analysis: CoordinatorPhotoAnalysis) {
  if (typeof analysis.latitude !== "number" || typeof analysis.longitude !== "number") {
    throw new Error("OpenAI nu a identificat coordonate GPS lizibile în fotografie.");
  }
  if (!Number.isFinite(analysis.latitude) || !Number.isFinite(analysis.longitude) || Math.abs(analysis.latitude) > 90 || Math.abs(analysis.longitude) > 180) {
    throw new Error("Coordonatele identificate în fotografie nu sunt valide.");
  }
  return {
    lat: analysis.latitude,
    lon: analysis.longitude,
    geo: `${analysis.latitude.toFixed(6)}, ${analysis.longitude.toFixed(6)} · extras din fotografie`,
  };
}

export function analysisCapturedAt(analysis: CoordinatorPhotoAnalysis) {
  const timestamp = analysis.capturedAt ? Date.parse(analysis.capturedAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
