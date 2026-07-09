create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.buyer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Default profile',
  max_purchase_budget integer,
  monthly_budget integer not null,
  down_payment integer not null,
  loan_term_months integer not null,
  apr numeric(5,2) not null,
  payment_method text,
  purchase_condition text,
  expected_annual_mileage integer,
  fuel_price numeric(5,2) not null,
  insurance_budget integer not null,
  min_year integer,
  max_mileage integer,
  max_price integer,
  min_condition integer,
  fuel_economy_importance integer,
  reliability_importance integer,
  performance_importance integer,
  cargo_need text,
  family_size integer,
  drivetrain_preference text,
  transmission_preference text,
  body_style text,
  climate text,
  resale_value_importance integer,
  modification_plans text,
  advanced_features_importance integer,
  safety_priority text,
  score_weights jsonb,
  min_mpg integer,
  custom_requirements text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_makes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.vehicle_models (
  id uuid primary key default gen_random_uuid(),
  make_id uuid not null references public.vehicle_makes(id) on delete cascade,
  name text not null,
  body_type text,
  created_at timestamptz not null default now(),
  unique (make_id, name)
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  make_id uuid references public.vehicle_makes(id) on delete set null,
  model_id uuid references public.vehicle_models(id) on delete set null,
  make text not null,
  model text not null,
  year integer not null,
  body_type text not null,
  fuel_type text not null,
  drivetrain text not null,
  transmission text,
  reliability_score integer,
  safety_score integer,
  performance_score integer,
  cargo_score integer,
  resale_score integer,
  feature_score integer,
  typical_mpg integer,
  typical_insurance integer,
  typical_maintenance integer,
  typical_depreciation integer,
  common_issues jsonb,
  ownership_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_external_sources (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  source text not null,
  source_vehicle_id text,
  raw_payload jsonb not null,
  normalized_overlay jsonb,
  fetched_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  source text not null,
  source_listing_id text,
  vin text,
  make text,
  model text,
  year integer,
  mileage integer not null,
  price integer not null,
  condition integer not null,
  location text,
  url text,
  raw_payload jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.score_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  label text not null,
  source_file_name text,
  imported_at timestamptz not null default now()
);

create table if not exists public.vehicle_score_overlays (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.score_imports(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  make text not null,
  model text not null,
  year integer,
  reliability_score integer,
  safety_score integer,
  insurance_monthly integer,
  maintenance_monthly integer,
  depreciation_annual integer,
  mpg integer,
  common_issues jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.comparison_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buyer_profile_id uuid references public.buyer_profiles(id) on delete set null,
  listing_id uuid references public.listings(id) on delete set null,
  custom_vehicle jsonb,
  notes text,
  status text not null default 'saved',
  created_at timestamptz not null default now()
);

create table if not exists public.recommendation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buyer_profile_id uuid references public.buyer_profiles(id) on delete set null,
  criteria jsonb not null,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.recommendation_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.recommendation_sessions(id) on delete cascade,
  listing_id uuid references public.listings(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  score integer not null,
  score_breakdown jsonb,
  weighted_contributions jsonb,
  reasons jsonb not null,
  watchouts jsonb not null,
  ownership_estimates jsonb,
  similar_alternatives jsonb,
  buying_tips jsonb,
  rank integer not null
);

alter table public.profiles enable row level security;
alter table public.buyer_profiles enable row level security;
alter table public.comparison_items enable row level security;
alter table public.recommendation_sessions enable row level security;
alter table public.recommendation_results enable row level security;
alter table public.score_imports enable row level security;
alter table public.vehicle_score_overlays enable row level security;

create policy "Users can read their profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users manage buyer profiles"
  on public.buyer_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage comparison items"
  on public.comparison_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage recommendation sessions"
  on public.recommendation_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage score imports"
  on public.score_imports for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage score overlays"
  on public.vehicle_score_overlays for all
  using (
    exists (
      select 1 from public.score_imports
      where score_imports.id = vehicle_score_overlays.import_id
      and score_imports.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.score_imports
      where score_imports.id = vehicle_score_overlays.import_id
      and score_imports.user_id = auth.uid()
    )
  );
