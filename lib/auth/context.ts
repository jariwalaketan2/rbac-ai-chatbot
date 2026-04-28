import { sql } from '../db/client';

export type Role = 'ADMIN' | 'ANALYST' | 'SUPPORT';

export type Context = {
  userId: string;
  orgId: string;
  email: string;
  fullName: string;
  role: Role;
  permissions: string[];
};

const rolePermissions: Record<Role, string[]> = {
  ADMIN: ['READ_REVENUE', 'READ_USERS'],
  ANALYST: ['READ_REVENUE'],
  SUPPORT: ['READ_USERS'],
};

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  org_id: string;
  role: Role;
};

export async function buildContextFromUserId(
  userId: string,
): Promise<Context | null> {
  const rows = (await sql(
    `SELECT id, email, full_name, org_id, role FROM users WHERE id = $1`,
    [userId],
  )) as UserRow[];

  if (rows.length === 0) return null;

  const u = rows[0];
  return {
    userId: u.id,
    orgId: u.org_id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    permissions: rolePermissions[u.role],
  };
}

export type DemoUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  orgId: string;
  orgName: string;
};

export async function listDemoUsers(): Promise<DemoUser[]> {
  const rows = (await sql(
    `SELECT u.id, u.email, u.full_name, u.role, u.org_id, o.name AS org_name
     FROM users u
     JOIN orgs o ON o.id = u.org_id
     ORDER BY u.org_id, u.role`,
  )) as Array<UserRow & { org_name: string }>;

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    orgId: r.org_id,
    orgName: r.org_name,
  }));
}
