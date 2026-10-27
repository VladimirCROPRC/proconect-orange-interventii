export type OrangeMailPreview = {
  messageId: string;
  ticketId: string;
  flow: "FITT" | "IMO";
  subject: string;
  receivedAt: string;
  siteA: string;
  siteB: string;
  foSection: string;
  locality: string;
  county: string;
  severity: string;
  etr: string;
  incidentDescription: string;
};

function field(body: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)\\s*${escaped}\\s*:*\\s*([^\\n\\r]*)`, "im").exec(body)?.[1]?.trim() ?? "";
}

function normalizeSubject(value: string) {
  return value.replace(/^(?:(?:RE|FW|FWD)\s*:\s*)+/i, "").trim();
}

function fittOdbCode(body: string) {
  return (/\bODB\s*:\s*([A-Z0-9][A-Z0-9_-]*)/i.exec(body)?.[1] ?? "").toUpperCase();
}

function fittSiteCode(value: string) {
  const normalized = value.trim().toUpperCase();
  return normalized.replace(/^(?:OLT\d*|EDFA[^-]*)-+/i, "");
}

export function parseOrangeMail(message: { id?: string; subject?: string; receivedDateTime?: string; body?: { content?: string }; bodyPreview?: string }): OrangeMailPreview | null {
  const originalSubject = String(message.subject ?? "").trim();
  const subject = normalizeSubject(originalSubject);
  const body = String(message.body?.content ?? message.bodyPreview ?? "").replace(/\r\n?/g, "\n");
  const ticket = /\b(FITT|IMO)\d{5,}\b/i.exec(`${subject}\n${body}`);
  if (!ticket) return null;
  const ticketId = ticket[0].toUpperCase();
  const flow = ticket[1].toUpperCase() as "FITT" | "IMO";

  if (flow === "FITT") {
    const locality = field(body, "Locality").replace(/\s*\((?:LOC|UAT)\)\s*$/i, "").trim();
    const oltEdfaName = field(body, "OLT/EDFA name");
    const odbCode = fittOdbCode(body);
    return {
      messageId: String(message.id ?? ""), ticketId, flow, subject,
      receivedAt: String(message.receivedDateTime ?? ""),
      siteA: fittSiteCode(oltEdfaName), siteB: "",
      foSection: odbCode || oltEdfaName, locality,
      county: "",
      severity: field(body, "Severity"), etr: field(body, "ETR"),
      incidentDescription: field(body, "Incident description"),
    };
  }

  const endpoints = /\b([A-Z]{2,5}\d{3,})\s*<>\s*([A-Z]{2,5}\d{3,})\b/i.exec(subject);
  return {
    messageId: String(message.id ?? ""), ticketId, flow, subject,
    receivedAt: String(message.receivedDateTime ?? ""),
    siteA: endpoints?.[1]?.toUpperCase() ?? "", siteB: endpoints?.[2]?.toUpperCase() ?? "",
    foSection: originalSubject || subject, locality: "", county: "", severity: "", etr: "",
    incidentDescription: subject.replace(/\s*\/{2,}\s*IMO\d+.*$/i, "").trim(),
  };
}
