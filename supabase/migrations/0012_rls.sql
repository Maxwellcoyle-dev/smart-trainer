-- Enable RLS and create policies on every domain table

-- profiles
alter table profiles enable row level security;
create policy p_profiles on profiles
  using (id = auth.uid()) with check (id = auth.uid());

-- goals
alter table goals enable row level security;
create policy p_goals on goals
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- plans
alter table plans enable row level security;
create policy p_plans on plans
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- plan_goals (no user_id — proxy through plan)
alter table plan_goals enable row level security;
create policy p_plan_goals on plan_goals
  using (exists (select 1 from plans p where p.id = plan_goals.plan_id and p.user_id = auth.uid()));

-- phases
alter table phases enable row level security;
create policy p_phases on phases
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- plan_weeks
alter table plan_weeks enable row level security;
create policy p_plan_weeks on plan_weeks
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- prescribed_sessions
alter table prescribed_sessions enable row level security;
create policy p_prescribed_sessions on prescribed_sessions
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- week_skeletons
alter table week_skeletons enable row level security;
create policy p_week_skeletons on week_skeletons
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- skeleton_slots
alter table skeleton_slots enable row level security;
create policy p_skeleton_slots on skeleton_slots
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- exercises
alter table exercises enable row level security;
create policy p_exercises on exercises
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- grades: shared reference — readable by all authenticated, no client writes
alter table grades enable row level security;
create policy p_grades_read on grades for select using (auth.role() = 'authenticated');

-- sessions
alter table sessions enable row level security;
create policy p_sessions on sessions
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- run_details
alter table run_details enable row level security;
create policy p_run_details on run_details
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- climbs
alter table climbs enable row level security;
create policy p_climbs on climbs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- strength_sets
alter table strength_sets enable row level security;
create policy p_strength_sets on strength_sets
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- check_ins
alter table check_ins enable row level security;
create policy p_check_ins on check_ins
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- soreness_entries
alter table soreness_entries enable row level security;
create policy p_soreness_entries on soreness_entries
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- injury_flags
alter table injury_flags enable row level security;
create policy p_injury_flags on injury_flags
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- coach_threads
alter table coach_threads enable row level security;
create policy p_coach_threads on coach_threads
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- coach_messages
alter table coach_messages enable row level security;
create policy p_coach_messages on coach_messages
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_job_runs
alter table ai_job_runs enable row level security;
create policy p_ai_job_runs on ai_job_runs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- proposals
alter table proposals enable row level security;
create policy p_proposals on proposals
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- adaptation_logs
alter table adaptation_logs enable row level security;
create policy p_adaptation_logs on adaptation_logs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Views use security_invoker so base-table RLS applies automatically
alter view v_weekly_mileage  set (security_invoker = on);
alter view v_grade_pyramid   set (security_invoker = on);
alter view v_adherence       set (security_invoker = on);
alter view v_soreness_trend  set (security_invoker = on);
alter view v_strength_prs    set (security_invoker = on);
