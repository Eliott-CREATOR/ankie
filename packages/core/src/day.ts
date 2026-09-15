function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const part = parts.find((p) => p.type === type);
  if (!part) {
    throw new Error(`Intl.DateTimeFormat did not return a "${type}" part`);
  }
  return Number(part.value);
}

// Local midnight via Intl only (docs/prompts/c3.md decision 4 — daily reset moves to local
// midnight instead of a fixed UTC offset). Reads `now`'s wall-clock date/time in `timeZone`,
// works out that zone's current UTC offset by comparing those same numbers reinterpreted as UTC
// against the real UTC instant, then shifts local midnight (built in UTC terms) by that offset
// to get the correct real instant.
export function startOfLocalDay(now: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);

  const year = datePart(parts, "year");
  const month = datePart(parts, "month");
  const day = datePart(parts, "day");
  const hour = datePart(parts, "hour");
  const minute = datePart(parts, "minute");
  const second = datePart(parts, "second");

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = wallClockAsUtc - now.getTime();
  const utcMidnightOfSameDate = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  return utcMidnightOfSameDate - offsetMs;
}
