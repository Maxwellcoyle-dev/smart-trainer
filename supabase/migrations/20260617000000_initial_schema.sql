-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── Profiles ─────────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text default 'America/Los_Angeles',
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "own profile" on profiles using (auth.uid() = id);

-- ─── Goals ────────────────────────────────────────────────────────────────────

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null check (type in ('event', 'fitness')),
  sport text not null check (sport in ('run', 'climb', 'strength', 'rest')),
  description text not null,
  target_date date,
  target_metric jsonb,
  priority int not null default 2 check (priority between 1 and 3),
  status text not null default 'active' check (status in ('active', 'achieved', 'dropped')),
  created_at timestamptz default now()
);

alter table goals enable row level security;
create policy "own goals" on goals using (auth.uid() = user_id);

-- ─── Plans ────────────────────────────────────────────────────────────────────

create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz default now()
);

alter table plans enable row level security;
create policy "own plans" on plans using (auth.uid() = user_id);

create table phases (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  name text not null,
  type text not null check (type in ('base', 'build', 'peak', 'recovery')),
  start_date date not null,
  end_date date not null,
  notes text
);

alter table phases enable row level security;
create policy "own phases" on phases using (
  exists (select 1 from plans p where p.id = phases.plan_id and p.user_id = auth.uid())
);

create table weeks (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid not null references phases(id) on delete cascade,
  week_number int not null,
  start_date date not null
);

alter table weeks enable row level security;
create policy "own weeks" on weeks using (
  exists (
    select 1 from phases ph
    join plans p on p.id = ph.plan_id
    where ph.id = weeks.phase_id and p.user_id = auth.uid()
  )
);

create table prescribed_sessions (
  id uuid primary key default gen_random_uuid(),
  week_id uuid not null references weeks(id) on delete cascade,
  day text not null check (day in ('mon','tue','wed','thu','fri','sat','sun')),
  sport text not null check (sport in ('run','climb','strength','rest')),
  prescription jsonb not null default '{}',
  notes text
);

alter table prescribed_sessions enable row level security;
create policy "own prescribed_sessions" on prescribed_sessions using (
  exists (
    select 1 from weeks w
    join phases ph on ph.id = w.phase_id
    join plans p on p.id = ph.plan_id
    where w.id = prescribed_sessions.week_id and p.user_id = auth.uid()
  )
);

-- ─── Week skeleton ────────────────────────────────────────────────────────────

create table week_skeletons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  slots jsonb not null default '{}',
  updated_at timestamptz default now()
);

alter table week_skeletons enable row level security;
create policy "own skeleton" on week_skeletons using (auth.uid() = user_id);

-- ─── Run logs ─────────────────────────────────────────────────────────────────

create table run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  logged_at timestamptz not null,
  distance_km numeric(6,2) not null,
  duration_seconds int not null,
  pace_per_km numeric(6,2) not null,
  surface text not null check (surface in ('trail','road','track','treadmill')),
  rpe int check (rpe between 1 and 10),
  notes text,
  prescribed_session_id uuid references prescribed_sessions(id) on delete set null
);

alter table run_logs enable row level security;
create policy "own run_logs" on run_logs using (auth.uid() = user_id);
create index on run_logs (user_id, logged_at desc);

-- ─── Climb sessions ───────────────────────────────────────────────────────────

create table climb_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  logged_at timestamptz not null,
  rpe int check (rpe between 1 and 10),
  notes text,
  prescribed_session_id uuid references prescribed_sessions(id) on delete set null
);

alter table climb_sessions enable row level security;
create policy "own climb_sessions" on climb_sessions using (auth.uid() = user_id);
create index on climb_sessions (user_id, logged_at desc);

create table climbs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references climb_sessions(id) on delete cascade,
  grade text not null,
  style text not null check (style in ('sport','boulder','tr','trad')),
  attempts int not null default 1,
  sends int not null default 1,
  indoor boolean not null default true,
  route_name text
);

alter table climbs enable row level security;
create policy "own climbs" on climbs using (
  exists (select 1 from climb_sessions cs where cs.id = climbs.session_id and cs.user_id = auth.uid())
);

-- ─── Strength logs ────────────────────────────────────────────────────────────

create table strength_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  logged_at timestamptz not null,
  notes text,
  prescribed_session_id uuid references prescribed_sessions(id) on delete set null
);

alter table strength_logs enable row level security;
create policy "own strength_logs" on strength_logs using (auth.uid() = user_id);
create index on strength_logs (user_id, logged_at desc);

create table strength_sets (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references strength_logs(id) on delete cascade,
  exercise text not null,
  reps int not null,
  weight_kg numeric(6,2),
  rpe int check (rpe between 1 and 10)
);

alter table strength_sets enable row level security;
create policy "own strength_sets" on strength_sets using (
  exists (select 1 from strength_logs sl where sl.id = strength_sets.log_id and sl.user_id = auth.uid())
);

-- ─── Check-ins ────────────────────────────────────────────────────────────────

create table check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  logged_at timestamptz not null,
  sleep_hours numeric(4,1),
  soreness jsonb not null default '{}',
  bodyweight_kg numeric(5,1),
  mood int check (mood between 1 and 5),
  readiness int check (readiness between 1 and 5),
  notes text
);

alter table check_ins enable row level security;
create policy "own check_ins" on check_ins using (auth.uid() = user_id);
create index on check_ins (user_id, logged_at desc);

-- ─── Injury flags ─────────────────────────────────────────────────────────────

create table injury_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  body_part text not null check (body_part in ('calf','knee','shoulder','hip','ankle','back','elbow','wrist')),
  status text not null default 'monitoring' check (status in ('monitoring','active','resolved')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table injury_flags enable row level security;
create policy "own injury_flags" on injury_flags using (auth.uid() = user_id);

-- ─── Proposals ───────────────────────────────────────────────────────────────

create table proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('app-coach','desktop-mcp')),
  action text not null,
  payload jsonb not null default '{}',
  rationale text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);

alter table proposals enable row level security;
create policy "own proposals" on proposals using (auth.uid() = user_id);
create index on proposals (user_id, status, created_at desc);

-- ─── Adaptation log ───────────────────────────────────────────────────────────

create table adaptation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('app-coach','desktop-mcp','manual')),
  action text not null,
  diff jsonb not null default '{}',
  rationale text,
  status text not null check (status in ('proposed','applied')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table adaptation_logs enable row level security;
create policy "own adaptation_logs" on adaptation_logs using (auth.uid() = user_id);
create index on adaptation_logs (user_id, created_at desc);

-- ─── Trigger: auto-create profile on signup ───────────────────────────────────

create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
