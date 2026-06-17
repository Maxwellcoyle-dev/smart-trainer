create table goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        goal_kind not null,
  sport       sport_type,
  title       text not null,
  target_date date,
  target      jsonb not null default '{}'::jsonb,
  priority    smallint not null default 1,
  status      goal_status not null default 'active',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index idx_goals_user_status on goals(user_id, status) where deleted_at is null;
create trigger trg_goals_updated before update on goals
  for each row execute function set_updated_at();
