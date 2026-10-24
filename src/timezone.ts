// Routines and daily spending caps use whole-day arithmetic (every day is 24 hours),
// so only timezones with a fixed UTC offset (no daylight saving time) are supported.
const offsetCache = new Map<string, number>();

function utcOffsetMsAt(timezone: string, timestamp: number): number {
  const offsetName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(timestamp)
    .find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT" means UTC; otherwise the format is "GMT+06:00" or "GMT-03:30".
  const offsetMatch = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetName);
  if (!offsetMatch) {
    return 0;
  }
  const offsetMinutes = Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]);
  return (offsetMatch[1] === '-' ? -1 : 1) * offsetMinutes * 60000;
}

export function fixedUtcOffsetMs(timezone: string): number {
  const cachedOffset = offsetCache.get(timezone);
  if (cachedOffset !== undefined) {
    return cachedOffset;
  }
  let januaryOffset: number;
  let julyOffset: number;
  try {
    januaryOffset = utcOffsetMsAt(timezone, Date.UTC(2026, 0, 1));
    julyOffset = utcOffsetMsAt(timezone, Date.UTC(2026, 6, 1));
  } catch {
    throw new Error(`Unknown timezone: ${timezone}; use an IANA name such as UTC or Asia/Tokyo`);
  }
  if (januaryOffset !== julyOffset) {
    throw new Error(`${timezone} uses daylight saving time; only fixed-offset timezones are supported`);
  }
  offsetCache.set(timezone, januaryOffset);
  return januaryOffset;
}

// The calendar date (YYYY-MM-DD) of a timestamp in the given timezone.
export function localDay(timestamp: number, timezone: string): string {
  return new Date(timestamp + fixedUtcOffsetMs(timezone)).toISOString().slice(0, 10);
}
