export type AuditEvent = {
  userId: string;
  orgId: string;
  tool: string;
  args: unknown;
  allowed: boolean;
  reason?: string;
  durationMs?: number;
};

export function audit(event: AuditEvent): void {
  console.log(
    JSON.stringify({
      kind: 'audit',
      ts: new Date().toISOString(),
      ...event,
    }),
  );
}
