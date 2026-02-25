create extension if not exists "pgcrypto";

create table if not exists markets (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  state text not null,
  property_type text not null default 'all',
  median_sale_price numeric,
  median_price_per_sqft numeric,
  avg_dom integer,
  yoy_change_percent numeric,
  last_updated timestamptz not null default now(),
  source_url text not null,
  unique(city, state, property_type)
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  answers_json jsonb not null,
  lead_label text not null,
  readiness_percent integer not null,
  transaction_plan jsonb,
  notes text
);

create table if not exists saved_markets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  city text not null,
  state text not null,
  property_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_id uuid references clients(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb
);
