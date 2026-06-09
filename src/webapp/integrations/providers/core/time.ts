const MS_PER_DAY = 86_400_000;

// All bucketing is UTC-day based for v1.
export const toDateStringUtc = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 10);

export const fromDateStringUtc = (date: string): number => Date.parse(`${date}T00:00:00.000Z`);

export const truncateToDayUtc = (epochMs: number): number =>
  Math.floor(epochMs / MS_PER_DAY) * MS_PER_DAY;

// Inclusive list of UTC day-start timestamps covering [start, end).
export const eachDayUtc = (start: number, end: number): number[] => {
  const days: number[] = [];
  for (let ts = truncateToDayUtc(start); ts < end; ts += MS_PER_DAY) {
    days.push(ts);
  }
  return days;
};
