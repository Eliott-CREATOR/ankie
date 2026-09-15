function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const part = parts.find((p) => p.type === type);
  if (!part) {
    throw new Error(`Intl.DateTimeFormat did not return a "${type}" part`);
  }
  return Number(part.value);
}

interface WallClock {
  wallClockAsUtcMs: number;
  year: number;
  month: number;
  day: number;
}

// `instant`'s wall-clock date/time in `timeZone`, reinterpreted as if it were itself a UTC
// timestamp — comparing this against `instant` gives that zone's UTC offset *at that instant*.
function wallClockAt(instant: number, timeZone: string): WallClock {
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
  const parts = formatter.formatToParts(new Date(instant));
  const year = datePart(parts, "year");
  const month = datePart(parts, "month");
  const day = datePart(parts, "day");
  const hour = datePart(parts, "hour");
  const minute = datePart(parts, "minute");
  const second = datePart(parts, "second");
  return {
    wallClockAsUtcMs: Date.UTC(year, month - 1, day, hour, minute, second),
    year,
    month,
    day,
  };
}

function offsetMsAt(instant: number, timeZone: string): number {
  return wallClockAt(instant, timeZone).wallClockAsUtcMs - instant;
}

// Local midnight via Intl only (docs/prompts/c3.md decision 4 — daily reset moves to local
// midnight instead of a fixed UTC offset). `now`'s wall clock in `timeZone` identifies the
// calendar date (unaffected by DST — Intl already accounts for it). Converting *that date's
// midnight* to a real instant needs the offset valid *at midnight*, not at `now`: on a DST
// transition date the two can differ, so the offset at `now` is only a first guess. Iterate —
// apply the guessed offset, read the real offset at the resulting instant, repeat — until the
// candidate stops moving; a timezone offset is piecewise constant, so this converges in at most
// two steps (B2, T-030).
export function startOfLocalDay(now: Date, timeZone: string): number {
  const nowMs = now.getTime();
  const { year, month, day } = wallClockAt(nowMs, timeZone);
  const utcMidnightOfSameDate = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  let candidate = utcMidnightOfSameDate - offsetMsAt(nowMs, timeZone);
  for (let i = 0; i < 3; i++) {
    const next = utcMidnightOfSameDate - offsetMsAt(candidate, timeZone);
    if (next === candidate) {
      break;
    }
    candidate = next;
  }
  return candidate;
}
