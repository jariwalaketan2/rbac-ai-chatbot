INSERT INTO orgs (id, name) VALUES
  ('acme',   'Acme Inc'),
  ('globex', 'Globex Corp');

INSERT INTO users (id, email, full_name, org_id, role) VALUES
  ('u-alice',   'admin@acme.com',     'Alice Anderson', 'acme',   'ADMIN'),
  ('u-ben',     'analyst@acme.com',   'Ben Brooks',     'acme',   'ANALYST'),
  ('u-carol',   'support@acme.com',   'Carol Chen',     'acme',   'SUPPORT'),
  ('u-david',   'admin@globex.com',   'David Diaz',     'globex', 'ADMIN'),
  ('u-emma',    'analyst@globex.com', 'Emma Evans',     'globex', 'ANALYST'),
  ('u-frank',   'support@globex.com', 'Frank Foster',   'globex', 'SUPPORT');

-- Acme transactions (today = 2026-04-28; current Q = Q2 2026, last Q = Q1 2026)
INSERT INTO transactions (id, org_id, amount, type, region, occurred_at) VALUES
  ('t-acme-01', 'acme', 1500.00, 'sale',   'NA',   '2026-01-15T10:00:00Z'),
  ('t-acme-02', 'acme', 2200.00, 'sale',   'EU',   '2026-02-03T11:30:00Z'),
  ('t-acme-03', 'acme',  800.00, 'refund', 'NA',   '2026-02-12T09:15:00Z'),
  ('t-acme-04', 'acme', 3500.00, 'sale',   'APAC', '2026-03-22T14:45:00Z'),
  ('t-acme-05', 'acme', 1100.00, 'sale',   'NA',   '2026-04-05T08:20:00Z'),
  ('t-acme-06', 'acme', 2800.00, 'sale',   'EU',   '2026-04-18T16:00:00Z'),
  ('t-acme-07', 'acme',  450.00, 'refund', 'EU',   '2026-04-22T13:10:00Z'),
  ('t-acme-08', 'acme', 5200.00, 'sale',   'APAC', '2025-12-08T12:00:00Z'),
  ('t-acme-09', 'acme', 1900.00, 'sale',   'NA',   '2025-11-15T10:30:00Z'),
  ('t-acme-10', 'acme', 3100.00, 'sale',   'EU',   '2025-09-20T15:20:00Z'),
  ('t-acme-11', 'acme', 2400.00, 'sale',   'APAC', '2025-08-11T11:00:00Z'),
  ('t-acme-12', 'acme',  950.00, 'refund', 'NA',   '2025-07-04T09:00:00Z');

-- Globex transactions
INSERT INTO transactions (id, org_id, amount, type, region, occurred_at) VALUES
  ('t-glob-01', 'globex', 4500.00, 'sale',   'APAC', '2026-01-10T08:00:00Z'),
  ('t-glob-02', 'globex', 6200.00, 'sale',   'NA',   '2026-02-22T13:45:00Z'),
  ('t-glob-03', 'globex', 1200.00, 'refund', 'APAC', '2026-03-15T10:00:00Z'),
  ('t-glob-04', 'globex', 8800.00, 'sale',   'EU',   '2026-04-02T09:30:00Z'),
  ('t-glob-05', 'globex', 5500.00, 'sale',   'APAC', '2026-04-17T14:00:00Z'),
  ('t-glob-06', 'globex',  700.00, 'refund', 'EU',   '2026-04-25T11:15:00Z'),
  ('t-glob-07', 'globex', 3300.00, 'sale',   'NA',   '2025-12-19T16:30:00Z'),
  ('t-glob-08', 'globex', 7100.00, 'sale',   'APAC', '2025-11-05T12:45:00Z'),
  ('t-glob-09', 'globex', 4400.00, 'sale',   'EU',   '2025-10-12T15:00:00Z'),
  ('t-glob-10', 'globex', 2900.00, 'sale',   'NA',   '2025-08-28T10:20:00Z');
