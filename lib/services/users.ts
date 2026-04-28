import { sql } from '../db/client';
import type { Context, Role } from '../auth/context';

export type GetUserDetailsArgs = { email: string };

export type GetUserDetailsResult =
  | { found: false; message: string }
  | {
      found: true;
      user: {
        id: string;
        email: string;
        fullName: string;
        role: Role;
        orgId: string;
      };
    };

export async function getUserDetails(
  args: GetUserDetailsArgs,
  ctx: Context,
): Promise<GetUserDetailsResult> {
  const rows = (await sql(
    `SELECT id, email, full_name, role, org_id
     FROM users
     WHERE org_id = $1 AND lower(email) = lower($2)`,
    [ctx.orgId, args.email],
  )) as Array<{
    id: string;
    email: string;
    full_name: string;
    role: Role;
    org_id: string;
  }>;

  // ABAC: identical "not found" shape whether the user exists in another org or
  // doesn't exist at all. Never reveal cross-tenant existence.
  if (rows.length === 0) {
    return { found: false, message: 'No matching user in your organization.' };
  }

  const u = rows[0];
  return {
    found: true,
    user: {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      role: u.role,
      orgId: u.org_id,
    },
  };
}

export type ListUsersArgs = { role?: Role };

export type UserRow = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
};

export type UserList = {
  orgId: string;
  filters: { role: Role | null };
  count: number;
  rows: UserRow[];
};

export async function listUsers(
  args: ListUsersArgs,
  ctx: Context,
): Promise<UserList> {
  const role = args.role ?? null;

  const rows = (await sql(
    `SELECT id, email, full_name, role
     FROM users
     WHERE org_id = $1 AND ($2::text IS NULL OR role = $2)
     ORDER BY email`,
    [ctx.orgId, role],
  )) as Array<{ id: string; email: string; full_name: string; role: Role }>;

  return {
    orgId: ctx.orgId,
    filters: { role },
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
    })),
  };
}
