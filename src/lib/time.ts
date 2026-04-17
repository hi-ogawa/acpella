// TODO: review slop.
// (temporal polyfill?)

export function formatZonedDateTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(date);

  const year = getPart(parts, "year");
  const month = getPart(parts, "month");
  const day = getPart(parts, "day");
  const hour = getPart(parts, "hour");
  const minute = getPart(parts, "minute");
  const second = getPart(parts, "second");
  const timeZoneName = getPart(parts, "timeZoneName");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${formatOffset(timeZoneName)}`;
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((item) => item.type === type);
  if (!part) {
    throw new Error(`Missing date time part: ${type}`);
  }
  return part.value;
}

function formatOffset(timeZoneName: string): string {
  if (timeZoneName === "GMT") {
    return "+00:00";
  }
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(timeZoneName);
  if (!match) {
    throw new Error(`Unsupported timezone offset: ${timeZoneName}`);
  }
  const [, sign, hours, minutes = "00"] = match;
  return `${sign}${hours.padStart(2, "0")}:${minutes}`;
}
