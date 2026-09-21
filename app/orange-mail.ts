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

export function parseOrangeMail(message: { id?: string; subject?: string; receivedDateTime?: string; body?: { content?: string }; bodyPreview?: string }): OrangeMailPreview | null {
  const subject = normalizeSubject(String(message.subject ?? ""));
  const body = String(message.body?.content ?? message.bodyPreview ?? "").replace(/\r\n?/g, "\n");
  const ticket = /\b(FITT|IMO)\d{5,}\b/i.exec(`${subject}\n${body}`);
  if (!ticket) return null;
  const ticketId = ticket[0].toUpperCase();
  const flow = ticket[1].toUpperCase() as "FITT" | "IMO";

  if (flow === "FITT") {
    const locality = field(body, "Locality").replace(/\s*\(LOC\)\s*$/i, "").trim();
    const countyValue = field(body, "County");
    return {
      messageId: String(message.id ?? ""), ticketId, flow, subject,
      receivedAt: String(message.receivedDateTime ?? ""),
      siteA: field(body, "OLT/EDFA name"), siteB: "",
      foSection: field(body, "OLT/EDFA name"), locality,
      county: countyValue ? `${countyValue.replace(/\s+County$/i, "")} County` : "",
      severity: field(body, "Severity"), etr: field(body, "ETR"),
      incidentDescription: field(body, "Incident description"),
    };
  }

  const endpoints = /\b([A-Z]{2,5}\d{3,})\s*<>\s*([A-Z]{2,5}\d{3,})\b/i.exec(subject);
  const section = /\bFO\s+[A-Z0-9_-]+\s+to\s+[A-Z0-9_-]+\b/i.exec(body)?.[0] ?? "";
  return {
    messageId: String(message.id ?? ""), ticketId, flow, subject,
    receivedAt: String(message.receivedDateTime ?? ""),
    siteA: endpoints?.[1]?.toUpperCase() ?? "", siteB: endpoints?.[2]?.toUpperCase() ?? "",
    foSection: section, locality: "", county: "", severity: "", etr: "",
    incidentDescription: subject.replace(/\s*\/{2,}\s*IMO\d+.*$/i, "").trim(),
  };
}
