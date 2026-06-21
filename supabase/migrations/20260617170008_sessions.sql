-- Base session table (spine for all workout types)
create table sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  sport                 sport_type not null,
  occurred_at           timestamptz not null,
  duration_s            integer,
  session_rpe           smallint check (session_rpe between 1 and 10),
  location              text,
  notes                 text,
  source                session_source not null default 'manual',
  prescribed_session_id uuid references prescribed_sessions(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create index idx_sessions_user_time on sessions(user_id, occurred_at desc) where deleted_at is null;
create index idx_sessions_sport on sessions(user_id, sport, occurred_at desc) where deleted_at is null;
create trigger trg_sessions_updated before update on sessions
  for each row execute function set_updated_at();

-- Run: 1:1 with a run session (pace is derived — duration_s / distance_m, never stored)
create table run_details (
  session_id       uuid primary key references sessions(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  distance_m       integer not null,         -- meters
  surface          run_surface not null default 'road',
  elevation_gain_m integer,
  avg_hr           smallint,                 -- [v1-seam] import only
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_run_details_updated before update on run_details
  for each row execute function set_updated_at();

-- Climb: many per session (grade pyramid raw data)
create table climbs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  session_id       uuid not null references sessions(id) on delete cascade,
  grade_id         uuid references grades(id),
  grade_label      text,           -- denormalized for display/offline
  grade_value      smallint,       -- denormalized ordinal for fast pyramid math
  style            climb_style not null default 'sport',
  environment      climb_environment not null default 'indoor',
  attempts         smallint not null default 1,
  sends            smallint not null default 0,
  route_name       text,
  crag             text,
  order_in_session smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index idx_climbs_session on climbs(session_id) where deleted_at is null;
create index idx_climbs_pyramid on climbs(user_id, environment, grade_value) where deleted_at is null;
create trigger trg_climbs_updated before update on climbs
  for each row execute function set_updated_at();

-- Strength: many sets per session
create table strength_sets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  session_id    uuid not null references sessions(id) on delete cascade,
  exercise_id   uuid references exercises(id) on delete set null,
  exercise_name text,             -- denormalized fallback
  set_index     smallint not null default 0,
  reps          smallint,
  weight_kg     numeric(6,2),
  rpe           smallint check (rpe between 1 and 10),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_sets_session on strength_sets(session_id) where deleted_at is null;
create index idx_sets_exercise on strength_sets(user_id, exercise_id, created_at desc) where deleted_at is null;
create trigger trg_strength_sets_updated before update on strength_sets
  for each row execute function set_updated_at();
