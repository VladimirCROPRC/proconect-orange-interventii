export type StoredProjectFile = {
  id: string;
  projectId: string;
  section: string;
  category: string;
  name: string;
  contentType: string;
  size: number;
  geo: string;
  capturedAt: number;
  uploadedBy: string;
  url: string;
};

const fieldPhotoSections = new Set(["safety", "client", "route", "splices", "site", "intervention-assessment", "intervention-execution"]);

async function getPhotoGeolocation() {
  if (typeof window === "undefined" || !window.isSecureContext || !navigator.geolocation) {
    return "GPS indisponibil";
  }

  return new Promise<string>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
        resolve(`${position} · ±${Math.round(coords.accuracy)} m`);
      },
      () => resolve("GPS indisponibil"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

async function loadPhoto(file: File): Promise<{
  image: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const image = await createImageBitmap(file);
      return {
        image,
        width: image.width,
        height: image.height,
        release: () => image.close(),
      };
    } catch {
      // Some mobile browsers expose createImageBitmap but cannot decode every camera image.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Fotografia nu a putut fi deschisă pentru marcaj."));
      element.src = objectUrl;
    });

    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function stampFieldPhoto(file: File, geo: string, capturedAt: number) {
  const source = await loadPhoto(file);
  const canvas = document.createElement("canvas");
  const longestSide = Math.max(source.width, source.height);
  // Mobile camera files can exceed the request-body limit before reaching the Worker.
  // 2048 px retains enough detail for field evidence while keeping uploads reliable.
  const scale = Math.min(1, 2048 / longestSide);
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    source.release();
    throw new Error("Fotografia nu a putut fi marcată cu data, ora și locația.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source.image, 0, 0, canvas.width, canvas.height);
  source.release();

  const fontSize = Math.max(16, Math.min(68, Math.round(canvas.width * 0.028)));
  const padding = Math.max(14, Math.round(fontSize * 0.8));
  const lineHeight = Math.round(fontSize * 1.5);
  const bannerHeight = Math.min(canvas.height, padding * 2 + lineHeight * 2);
  const bannerTop = canvas.height - bannerHeight;
  const capturedAtLabel = new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(capturedAt));

  context.fillStyle = "rgba(12, 23, 45, 0.82)";
  context.fillRect(0, bannerTop, canvas.width, bannerHeight);
  context.fillStyle = "#7eb5ff";
  context.fillRect(padding, bannerTop + padding, Math.max(3, Math.round(fontSize * 0.12)), lineHeight * 2 - Math.round(fontSize * 0.2));

  const textLeft = padding + Math.round(fontSize * 0.55);
  const maxTextWidth = Math.max(1, canvas.width - textLeft - padding);
  context.textBaseline = "top";
  context.fillStyle = "#ffffff";
  context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.fillText(`DATA: ${capturedAtLabel}`, textLeft, bannerTop + padding, maxTextWidth);
  context.fillText(`GPS: ${geo}`, textLeft, bannerTop + padding + lineHeight, maxTextWidth);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("Fotografia nu a putut fi marcată cu data, ora și locația."));
      },
      "image/jpeg",
      0.8,
    );
  });

  const filename = /\.jpe?g$/i.test(file.name)
    ? file.name
    : `${file.name.replace(/\.[^.]+$/, "") || "fotografie"}.jpg`;

  return new File([blob], filename, { type: "image/jpeg", lastModified: capturedAt });
}

export async function uploadProjectFile(input: {
  projectId: string;
  section: string;
  category: string;
  file: File;
  geo?: string;
}): Promise<StoredProjectFile> {
  const isFieldPhoto = fieldPhotoSections.has(input.section) && input.file.type.startsWith("image/");
  const geo = isFieldPhoto ? input.geo?.trim() || await getPhotoGeolocation() : input.geo;
  const file = isFieldPhoto ? await stampFieldPhoto(input.file, geo || "GPS indisponibil", Date.now()) : input.file;

  const form = new FormData();
  form.set("projectId", input.projectId);
  form.set("section", input.section);
  form.set("category", input.category);
  form.set("file", file, file.name);
  if (geo) form.set("geo", geo);

  const response = await fetch("/api/files", { method: "POST", credentials: "same-origin", body: form });
  const responseText = await response.text();
  let payload: { file?: StoredProjectFile; error?: string } = {};
  try {
    payload = responseText ? JSON.parse(responseText) as typeof payload : {};
  } catch {
    if (response.status === 413 || /payload too large/i.test(responseText)) {
      throw new Error("Fotografia este prea mare pentru încărcare. Reîncearcă după ce aplicația o comprimă sau selectează o fotografie mai mică.");
    }
    throw new Error(`Fișierul nu a putut fi încărcat (HTTP ${response.status}).`);
  }
  if (!response.ok || !payload.file) {
    if (response.status === 413) throw new Error("Fotografia este prea mare pentru încărcare.");
    throw new Error(payload.error || "Fișierul nu a putut fi încărcat.");
  }
  return payload.file;
}

export async function fetchProjectFiles(projectId: string, section?: string): Promise<StoredProjectFile[]> {
  const params = new URLSearchParams({ projectId });
  if (section) params.set("section", section);
  const response = await fetch(`/api/files?${params.toString()}`, { credentials: "same-origin", cache: "no-store" });
  const payload = (await response.json()) as { files?: StoredProjectFile[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "Fișierele nu sunt disponibile.");
  return payload.files ?? [];
}

export async function deleteProjectFile(fileId: string) {
  const response = await fetch("/api/files", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Fișierul nu a putut fi șters.");
}

export function formatCapturedAt(timestamp: number) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
