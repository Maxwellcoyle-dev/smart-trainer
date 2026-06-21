create table exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  category      text,
  cues          text,
  target_tissue body_part[] not null default '{}',
  is_seed       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_exercises_updated before update on exercises
  for each row execute function set_updated_at();

create table grades (
  id          uuid primary key default gen_random_uuid(),
  system      text not null,
  label       text not null,
  grade_value smallint not null,
  discipline  text not null,
  unique (system, label)
);
create index idx_grades_value on grades(discipline, grade_value);
