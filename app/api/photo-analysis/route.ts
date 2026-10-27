import { env } from "cloudflare:workers";
import { getAuthorizedProject, isManagementRole } from "../../project-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

type OpenAiEnvironment = {
  OPENAI_API_KEY?: string;
  OPENAI_VISION_MODEL?: string;
};

type PhotoAnalysis = {
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

const environment = env as unknown as OpenAiEnvironment;

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function outputText(payload: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
}

function validAnalysis(value: unknown): value is PhotoAnalysis {
  if (!value || typeof value !== "object") return false;
  const analysis = value as Partial<PhotoAnalysis>;
  return typeof analysis.visibleText === "string"
    && typeof analysis.summary === "string"
    && typeof analysis.incidentDescription === "string"
    && typeof analysis.remediationDescription === "string"
    && typeof analysis.junctionCode === "string"
    && typeof analysis.siteCode === "string"
    && typeof analysis.confidence === "number";
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Interpretarea fotografiilor WhatsApp este disponibilă numai coordonatorilor." }, { status: 403 });
    if (!environment.OPENAI_API_KEY) return Response.json({ error: "Secretul OPENAI_API_KEY nu este configurat în Cloudflare." }, { status: 503 });

    const form = await request.formData();
    const projectId = form.get("projectId");
    const context = form.get("context");
    const file = form.get("file");
    const junctionNumber = Number(form.get("junctionNumber") || 0);
    if (typeof projectId !== "string" || (context !== "assessment" && context !== "execution-junction") || !(file instanceof File)) {
      return Response.json({ error: "Datele fotografiei nu sunt complete." }, { status: 400 });
    }
    const project = await getAuthorizedProject(projectId, session.account);
    if (!project) return Response.json({ error: "Tichet indisponibil." }, { status: 404 });
    if (!file.type.startsWith("image/") || file.size <= 0 || file.size > 5_000_000) {
      return Response.json({ error: "Selectează o fotografie validă de maximum 5 MB." }, { status: 400 });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        latitude: { anyOf: [{ type: "number" }, { type: "null" }] },
        longitude: { anyOf: [{ type: "number" }, { type: "null" }] },
        capturedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
        visibleText: { type: "string" },
        summary: { type: "string" },
        incidentDescription: { type: "string" },
        remediationDescription: { type: "string" },
        junctionCode: { type: "string" },
        damageType: { type: "string", enum: ["", "FO cut", "Atenuare", "Echipament"] },
        cause: { type: "string", enum: ["", "Accident-Orice tip de accident (masina,etc.)", "Clima-Alunecari de teren, viituri, furtuna, etc…", "Defect-Defect cablu/cutie jonctiune, etc,…", "Lucrari infrastructura-Lucrari efectuate de companiile nationale", "Lucrari civile-Lucrari efectuate de persoane fizice", "Primarie-Decizii primarie de a taia cablul", "Vandalism-Furt"] },
        routeType: { type: "string", enum: ["", "Aerian", "Subteran", "Mixt"] },
        cableCapacity: { anyOf: [{ type: "number" }, { type: "null" }] },
        siteCode: { type: "string" },
        otdrLengthMeters: { anyOf: [{ type: "number" }, { type: "null" }] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["latitude", "longitude", "capturedAt", "visibleText", "summary", "incidentDescription", "remediationDescription", "junctionCode", "damageType", "cause", "routeType", "cableCapacity", "siteCode", "otdrLengthMeters", "confidence"],
    };

    const prompt = context === "assessment"
      ? "Analizează fotografia de constatare a unei avarii de fibră optică din România. Citește exact textul vizibil, în special marcajele GPS și data/ora. Transformă coordonatele DMS în grade zecimale. Propune completarea formularului numai din informații vizibile sau concluzii tehnice foarte clare; pentru informații incerte întoarce șir gol sau null. Nu inventa date."
      : `Analizează fotografia pentru joncțiunea ${junctionNumber || ""} a unei intervenții de fibră optică din România. Citește exact textul vizibil, în special marcajele GPS, data/ora și codul joncțiunii. Transformă coordonatele DMS în grade zecimale. Descrie succint lucrarea vizibilă, fără să inventezi date.`;

    const image = `data:${file.type};base64,${toBase64(await file.arrayBuffer())}`;
    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: environment.OPENAI_VISION_MODEL || "gpt-6-astra",
        store: false,
        max_output_tokens: 1200,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: image, detail: "high" },
          ],
        }],
        text: { format: { type: "json_schema", name: "orange_field_photo", strict: true, schema } },
      }),
    });
    const raw = await openAiResponse.text();
    if (!openAiResponse.ok) {
      console.error("OpenAI photo analysis failed:", openAiResponse.status, openAiResponse.headers.get("x-request-id") || "no-request-id");
      return Response.json({ error: "OpenAI nu a putut interpreta fotografia momentan." }, { status: 502 });
    }
    const payload = JSON.parse(raw) as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const text = outputText(payload);
    const analysis = text ? JSON.parse(text) as unknown : null;
    if (!validAnalysis(analysis)) return Response.json({ error: "Răspunsul OpenAI nu conține o interpretare validă." }, { status: 502 });
    return Response.json({ analysis }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Coordinator photo analysis error:", error instanceof Error ? error.message : "Unknown analysis failure");
    return Response.json({ error: "Fotografia nu a putut fi interpretată." }, { status: 503 });
  }
}
