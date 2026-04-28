import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from '@neondatabase/serverless';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const schema = readFileSync(join(process.cwd(), 'db/schema.sql'), 'utf8');
  const seed = readFileSync(join(process.cwd(), 'db/seed.sql'), 'utf8');

  console.log('Applying schema…');
  await pool.query(schema);
  console.log('Seeding data…');
  await pool.query(seed);

  const orgs = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM orgs ORDER BY id',
  );
  const users = await pool.query<{ count: string }>('SELECT COUNT(*) FROM users');
  const txns = await pool.query<{ count: string }>('SELECT COUNT(*) FROM transactions');

  console.log('---');
  console.log('Orgs:', orgs.rows.map((r) => `${r.id} (${r.name})`).join(', '));
  console.log('Users:', users.rows[0].count);
  console.log('Transactions:', txns.rows[0].count);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
