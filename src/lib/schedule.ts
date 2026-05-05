const SHANGHAI_TIMEZONE = "Asia/Shanghai";
const SUMMARY_SLOTS_MINUTES = [7 * 60, 12 * 60, 19 * 60] as const;
const PREFETCH_LEAD_MINUTES = 15;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function getShanghaiDatePrefix(now: Date, dayOffset = 0): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const shifted = new Date(now.getTime() + dayOffset * DAY_MS);
  const parts = Object.fromEntries(formatter.formatToParts(shifted).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildShanghaiSlotDate(now: Date, minutes: number, dayOffset = 0): Date {
  const prefix = getShanghaiDatePrefix(now, dayOffset);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return new Date(`${prefix}T${pad(hour)}:${pad(minute)}:00+08:00`);
}

function nextScheduledSummarySlot(lastSummaryAt: string | undefined, now: Date): Date {
  const last = lastSummaryAt ? new Date(lastSummaryAt) : undefined;
  const anchor = last && !Number.isNaN(last.getTime()) ? last : undefined;
  for (const slot of SUMMARY_SLOTS_MINUTES) {
    const candidate = buildShanghaiSlotDate(now, slot);
    if (!anchor || anchor.getTime() < candidate.getTime()) {
      return candidate;
    }
  }
  return buildShanghaiSlotDate(now, SUMMARY_SLOTS_MINUTES[0], 1);
}

export function shouldStartScheduledSummaryRun(lastSummaryAt: string | undefined, now = new Date()): boolean {
  const target = nextScheduledSummarySlot(lastSummaryAt, now);
  return now.getTime() >= target.getTime() - PREFETCH_LEAD_MINUTES * 60 * 1000;
}

export function getScheduledSummaryLabel(): string {
  return "07:00 / 12:00 / 19:00 (Asia/Shanghai)";
}
