create table coach_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,
  channel    write_source not null default 'app_coach',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_threads_updated before update on coach_threads
  for each row execute function set_updated_at();

create table coach_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  thread_id     uuid not null references coach_threads(id) on delete cascade,
  role          message_role not null,
  content       text,
  tool_calls    jsonb not null default '[]'::jsonb,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);
create index idx_messages_thread on coach_messages(thread_id, created_at);

create table ai_job_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  hook           text not null,
  trigger_event  text,
  status         ai_job_status not null default 'queued',
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd_est   numeric(8,4),
  input_ref      jsonb not null default '{}'::jsonb,
  output_summary text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index idx_jobruns_user_time on ai_job_runs(user_id, created_at desc);

create table proposals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      write_source not null,
  action_type text not null,
  diff        jsonb not null,
  rationale   text,
  status      proposal_status not null default 'pending',
  thread_id   uuid references coach_threads(id) on delete set null,
  job_run_id  uuid references ai_job_runs(id) on delete set null,
  expires_at  timestamptz,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_proposals_pending on proposals(user_id, status) where status = 'pending';
create trigger trg_proposals_updated before update on proposals
  for each row execute function set_updated_at();

-- Append-only ledger; reverted_at is the only field ever updated
create table adaptation_logs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  source         write_source not null,
  action_type    text not null,
  diff           jsonb not null,
  rationale      text,
  proposal_id    uuid references proposals(id) on delete set null,
  thread_id      uuid references coach_threads(id) on delete set null,
  job_run_id     uuid references ai_job_runs(id) on delete set null,
  reverts_log_id uuid references adaptation_logs(id) on delete set null,
  reverted_at    timestamptz,
  applied_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index idx_adaptlog_user_time on adaptation_logs(user_id, applied_at desc);
