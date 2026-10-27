export type ManualDateTimeParts = { date: string; time: string };

export function isoDateToRomanian(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

export function romanianDateToIso(value: string) {
  const match = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(value.trim());
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function validManualTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

export function combineRomanianDateTime(date: string, time: string) {
  const isoDate = romanianDateToIso(date);
  const normalizedTime = time.trim();
  return isoDate && validManualTime(normalizedTime) ? `${isoDate}T${normalizedTime}` : "";
}

function bucharestParts(timestamp: number): ManualDateTimeParts {
  const parts = new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("day")}.${value("month")}.${value("year")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

export function timestampToRomanianDateTime(timestamp: number | undefined): ManualDateTimeParts {
  return timestamp && Number.isFinite(timestamp) ? bucharestParts(timestamp) : { date: "", time: "" };
}

export function projectDateTimeToRomanian(value: string | undefined): ManualDateTimeParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/.exec(value?.trim() ?? "");
  return match
    ? { date: `${match[3]}.${match[2]}.${match[1]}`, time: match[4] && match[5] ? `${match[4]}:${match[5]}` : "" }
    : { date: "", time: "" };
}

export function romanianDateTimeToTimestamp(date: string, time: string) {
  const combined = combineRomanianDateTime(date, time);
  if (!combined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(combined)!;
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let timestamp = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = bucharestParts(timestamp);
    const actualDate = romanianDateToIso(actual.date);
    const actualMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(actualDate);
    const actualTime = /^(\d{2}):(\d{2})$/.exec(actual.time);
    if (!actualMatch || !actualTime) return null;
    const represented = Date.UTC(Number(actualMatch[1]), Number(actualMatch[2]) - 1, Number(actualMatch[3]), Number(actualTime[1]), Number(actualTime[2]));
    timestamp += desired - represented;
  }
  const rendered = bucharestParts(timestamp);
  return rendered.date === date.trim().replace(/[\/-]/g, ".").replace(/^(\d)(\.)/, "0$1$2").replace(/\.(\d)\./, ".0$1.")
    && rendered.time === time.trim()
    ? timestamp
    : null;
}
