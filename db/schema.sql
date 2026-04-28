DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS orgs;

CREATE TABLE orgs (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          text PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  full_name   text NOT NULL,
  org_id      text NOT NULL REFERENCES orgs(id),
  role        text NOT NULL CHECK (role IN ('ADMIN', 'ANALYST', 'SUPPORT')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_org_idx ON users(org_id);

CREATE TABLE transactions (
  id          text PRIMARY KEY,
  org_id      text NOT NULL REFERENCES orgs(id),
  amount      numeric(12, 2) NOT NULL,
  type        text NOT NULL CHECK (type IN ('sale', 'refund')),
  region      text NOT NULL CHECK (region IN ('NA', 'EU', 'APAC')),
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX txn_org_date_idx ON transactions(org_id, occurred_at DESC);
