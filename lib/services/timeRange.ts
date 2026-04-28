export type TimeRangePreset =
  | 'LAST_QUARTER'
  | 'CURRENT_QUARTER'
  | 'YEAR_TO_DATE'
  | 'ALL_TIME'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'LAST_12_MONTHS'
  | 'CUSTOM';

export type TimeRange = {
  preset: TimeRangePreset;
  from?: string;
  to?: string;
};

export type ResolvedRange = { from: Date | null; to: Date | null };

const DAY = 24 * 60 * 60 * 1000;

export function resolveTimeRange(tr: TimeRange, now: Date = new Date()): ResolvedRange {
  switch (tr.preset) {
    case 'ALL_TIME':
      return { from: null, to: null };

    case 'CUSTOM': {
      if (!tr.from || !tr.to) {
        throw new Error('CUSTOM time range requires both `from` and `to`');
      }
      return { from: new Date(tr.from), to: new Date(tr.to) };
    }

    case 'YEAR_TO_DATE':
      return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to: now };

    case 'CURRENT_QUARTER': {
      const q = Math.floor(now.getUTCMonth() / 3);
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1)),
      };
    }

    case 'LAST_QUARTER': {
      let year = now.getUTCFullYear();
      let q = Math.floor(now.getUTCMonth() / 3) - 1;
      if (q < 0) {
        q = 3;
        year -= 1;
      }
      return {
        from: new Date(Date.UTC(year, q * 3, 1)),
        to: new Date(Date.UTC(year, q * 3 + 3, 1)),
      };
    }

    case 'LAST_30_DAYS':
      return { from: new Date(now.getTime() - 30 * DAY), to: now };

    case 'LAST_90_DAYS':
      return { from: new Date(now.getTime() - 90 * DAY), to: now };

    case 'LAST_12_MONTHS':
      return { from: new Date(now.getTime() - 365 * DAY), to: now };

    default: {
      const _exhaustive: never = tr.preset;
      throw new Error(`Unknown time-range preset: ${_exhaustive}`);
    }
  }
}
