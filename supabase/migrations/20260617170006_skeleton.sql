create table week_skeletons (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'My Week',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- Only one active skeleton per user
create unique index uniq_active_skeleton on week_skeletons(user_id)
  where is_active and deleted_at is null;
create trigger trg_skeleton_updated before update on week_skeletons
  for each row execute function set_updated_at();

create table skeleton_slots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  skeleton_id  uuid not null references week_skeletons(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  sport        sport_type not null,
  order_in_day smallint not null default 0,
  hint         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (skeleton_id, day_of_week, order_in_day)
);
create trigger trg_skeleton_slots_updated before update on skeleton_slots
  for each row execute function set_updated_at();
