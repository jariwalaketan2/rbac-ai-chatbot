export type RefusalReason = 'OUT_OF_SCOPE' | 'NEED_CLARIFICATION' | 'NO_DATA';

export function refusalText(
  reason: RefusalReason,
  ctx: { availableTools: string[] },
  details?: { missing?: string; details?: string },
): string {
  const dataTools = ctx.availableTools.filter(
    (t) => t !== 'finalize' && t !== 'respondWithoutData',
  );

  switch (reason) {
    case 'OUT_OF_SCOPE': {
      const suffix = details?.details ? ` (${details.details})` : '';
      const capability =
        dataTools.length > 0
          ? `With your current role I can answer questions using: ${dataTools.join(', ')}.`
          : 'Your current role has no data tools available.';
      return `I can't help with that.${suffix} ${capability}`;
    }

    case 'NEED_CLARIFICATION': {
      const what = details?.missing
        ? ` (specifically: ${details.missing})`
        : '';
      return `I need a bit more info${what}. Could you clarify and resend?`;
    }

    case 'NO_DATA':
      return 'No matching data found in your organization for that query.';
  }
}
