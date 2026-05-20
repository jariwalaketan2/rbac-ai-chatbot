import { sql } from '../db/client';
import type { Context, Role } from '../auth/context';
import { PAGE_SIZE } from './transactions';

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
  totalCount: number;
  count: number;
  hasMore: boolean;
  rows: UserRow[];
};

export async function listUsers(
  args: ListUsersArgs,
  ctx: Context,
): Promise<UserList> {
  const role = args.role ?? null;

  const raw = (await sql(
    `SELECT id, email, full_name, role, COUNT(*) OVER() AS total_count
     FROM users
     WHERE org_id = $1 AND ($2::text IS NULL OR role = $2)
     ORDER BY email
     LIMIT $3`,
    [ctx.orgId, role, PAGE_SIZE + 1],
  )) as Array<{ id: string; email: string; full_name: string; role: Role; total_count: number }>;

  const totalCount = raw.length > 0 ? Number(raw[0].total_count) : 0;
  const hasMore = raw.length > PAGE_SIZE;
  const rows = hasMore ? raw.slice(0, PAGE_SIZE) : raw;

  return {
    orgId: ctx.orgId,
    filters: { role },
    totalCount,
    count: rows.length,
    hasMore,
    rows: rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
    })),
  };
}
