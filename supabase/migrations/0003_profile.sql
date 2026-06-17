create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  birth_date      date,
  height_cm       numeric(5,1),
  units           text not null default 'metric',
  injury_history  text,
  equipment       jsonb not null default '{}'::jsonb,
  watch_list      body_part[] not null default '{}',
  preferences     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- Auto-create profile on signup
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
