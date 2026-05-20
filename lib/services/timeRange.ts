export type TimeRange = {
  from?: string;
  to?: string;
};

export type ResolvedRange = { from: Date | null; to: Date | null };

export function resolveTimeRange(tr: TimeRange): ResolvedRange {
  return {
    from: tr.from ? new Date(tr.from) : null,
    to:   tr.to   ? new Date(tr.to)   : null,
  };
}
