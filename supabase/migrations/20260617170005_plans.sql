create table plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  status      plan_status not null default 'draft',
  start_date  date,
  end_date    date,
  intent      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_plans_updated before update on plans
  for each row execute function set_updated_at();

create table plan_goals (
  plan_id uuid not null references plans(id) on delete cascade,
  goal_id uuid not null references goals(id) on delete cascade,
  primary key (plan_id, goal_id)
);

create table phases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  plan_id     uuid not null references plans(id) on delete cascade,
  phase_index smallint not null,
  name        text not null,
  type        phase_type not null default 'custom',
  intent      text,
  start_date  date,
  end_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (plan_id, phase_index)
);
create trigger trg_phases_updated before update on phases
  for each row execute function set_updated_at();

create table plan_weeks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  phase_id    uuid not null references phases(id) on delete cascade,
  week_index  smallint not null,
  start_date  date,
  theme       text,
  targets     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (phase_id, week_index)
);
create trigger trg_plan_weeks_updated before update on plan_weeks
  for each row execute function set_updated_at();

-- prescribed_sessions: sessions/injury_flags FKs added in 0009b after those tables exist
create table prescribed_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  plan_week_id      uuid not null references plan_weeks(id) on delete cascade,
  day_of_week       smallint not null check (day_of_week between 0 and 6),
  scheduled_date    date,
  sport             sport_type not null,
  order_in_day      smallint not null default 0,
  prescription      jsonb not null default '{}'::jsonb,
  status            prescribed_status not null default 'planned',
  logged_session_id uuid,           -- FK to sessions added in 0009b
  injury_flag_id    uuid,           -- FK to injury_flags added in 0009b
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index idx_presc_week on prescribed_sessions(plan_week_id) where deleted_at is null;
create index idx_presc_date on prescribed_sessions(user_id, scheduled_date) where deleted_at is null;
create trigger trg_presc_updated before update on prescribed_sessions
  for each row execute function set_updated_at();
