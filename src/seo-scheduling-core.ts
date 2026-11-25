export type Recurrence =
  | { frequency: "ONCE"; at: string }
  | { frequency: "DAILY"; hour: number; minute: number; startAt?: string; endAt?: string }
  | { frequency: "WEEKLY"; hour: number; minute: number; weekdays: number[]; startAt?: string; endAt?: string }
  | { frequency: "MONTHLY"; hour: number; minute: number; dayOfMonth: number; startAt?: string; endAt?: string };

function parts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(values.map(({ type, value }) => [type, value]));
}
function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let i = 0; i < 4; i += 1) {
    const local = parts(new Date(candidate), timezone);
    const represented = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute));
    const correction = desired - represented;
    if (correction === 0) break;
    candidate += correction;
  }
  return new Date(candidate);
}
function localDateStamp(year: number, month: number, day: number) { return Date.UTC(year, month - 1, day); }

/** Returns the next schedule occurrence strictly after `after`, in the schedule's IANA timezone. */
export function nextSeoOccurrence(after: Date, timezone: string, recurrence: Recurrence): Date | null {
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new Error("Choose a valid IANA timezone."); }
  if (recurrence.frequency === "ONCE") {
    const once = recurrence.at ? new Date(recurrence.at) : null;
    return once && Number.isFinite(once.getTime()) && once > after ? once : null;
  }
  const startAt = "startAt" in recurrence && recurrence.startAt ? new Date(recurrence.startAt) : after;
  if (!Number.isFinite(startAt.getTime())) throw new Error("Schedule start time is invalid.");
  const threshold = new Date(Math.max(after.getTime(), startAt.getTime() - 1));
  const startDate = parts(threshold, timezone);
  const start = new Date(Date.UTC(Number(startDate.year), Number(startDate.month) - 1, Number(startDate.day)));
  const end = recurrence.endAt ? new Date(recurrence.endAt) : new Date(after.getTime() + 370 * 86_400_000);
  for (let offset = 0; offset <= 370; offset += 1) {
    const date = new Date(start.getTime() + offset * 86_400_000);
    const year = date.getUTCFullYear(); const month = date.getUTCMonth() + 1; const day = date.getUTCDate();
    const weekday = date.getUTCDay() || 7;
    if (recurrence.frequency === "WEEKLY" && !(recurrence.weekdays ?? []).includes(weekday)) continue;
    if (recurrence.frequency === "MONTHLY" && day !== (recurrence.dayOfMonth ?? 1)) continue;
    const candidate = localToUtc(year, month, day, recurrence.hour, recurrence.minute, timezone);
    if (candidate <= threshold || candidate > end) continue;
    return candidate;
  }
  return null;
}

export function scheduleOccurrenceKey(scheduleId: string, scheduledAt: Date) {
  return `${scheduleId}:${scheduledAt.toISOString()}`;
}

export function seoOccurrencesBetween(from: Date, to: Date, timezone: string, recurrence: Recurrence, limit = 100): Date[] {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new Error("Choose a valid calendar date range.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 366) throw new Error("Calendar occurrence limit must be between 1 and 366.");
  const occurrences: Date[] = [];
  let cursor = new Date(from.getTime() - 1);
  while (occurrences.length < limit) {
    const next = nextSeoOccurrence(cursor, timezone, recurrence);
    if (!next || next > to) break;
    occurrences.push(next);
    cursor = next;
  }
  return occurrences;
}
