-- Imported activities (roadmap phase 2, step 1): raw payloads + dedupe.
-- Source seam for FIT/TCX/GPX file uploads now, Strava/Garmin webhooks later.

create table session_imports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null,                    -- 'file_upload' | 'strava' | 'garmin'
  external_id text not null,                    -- provider activity id; file sha-256 for uploads
  session_id  uuid references sessions(id) on delete set null,
  status      text not null default 'imported', -- 'imported' | 'duplicate'
  raw         jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create unique index idx_session_imports_dedupe
  on session_imports(user_id, provider, external_id);
create index idx_session_imports_user
  on session_imports(user_id, created_at desc);

alter table session_imports enable row level security;
create policy p_session_imports on session_imports
  using (user_id = auth.uid()) with check (user_id = auth.uid());
