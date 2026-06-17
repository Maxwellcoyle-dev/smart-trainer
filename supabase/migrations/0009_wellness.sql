create table check_ins (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  check_in_date   date not null,
  sleep_hours     numeric(3,1),
  sleep_quality   smallint check (sleep_quality between 1 and 5),
  bodyweight_kg   numeric(5,2),
  mood            smallint check (mood between 1 and 5),
  readiness       smallint check (readiness between 1 and 10),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (user_id, check_in_date)
);
create index idx_checkins_user_date on check_ins(user_id, check_in_date desc) where deleted_at is null;
create trigger trg_checkins_updated before update on check_ins
  for each row execute function set_updated_at();

create table soreness_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  check_in_id uuid not null references check_ins(id) on delete cascade,
  body_part   body_part not null,
  side        body_side not null default 'na',
  severity    smallint not null check (severity between 0 and 10),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_soreness_part on soreness_entries(user_id, body_part, created_at desc);
create trigger trg_soreness_updated before update on soreness_entries
  for each row execute function set_updated_at();

create table injury_flags (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  body_part     body_part not null,
  side          body_side not null default 'na',
  status        injury_status not null default 'watch',
  severity      smallint check (severity between 0 and 10),
  onset_date    date not null default current_date,
  resolved_date date,
  narrative     text,
  origin        write_source not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_injury_open on injury_flags(user_id, status)
  where deleted_at is null and status <> 'resolved';
create trigger trg_injury_updated before update on injury_flags
  for each row execute function set_updated_at();
