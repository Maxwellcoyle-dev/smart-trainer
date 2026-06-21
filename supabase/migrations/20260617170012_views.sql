-- Weekly running mileage + ramp %
create view v_weekly_mileage as
with weekly as (
  select s.user_id,
         date_trunc('week', s.occurred_at)::date as week_start,
         sum(rd.distance_m) as distance_m,
         count(*) as n_runs
  from sessions s
  join run_details rd on rd.session_id = s.id
  where s.deleted_at is null and s.sport = 'run'
  group by 1,2
)
select *,
       lag(distance_m) over (partition by user_id order by week_start) as prev_distance_m,
       round(
         100.0 * (distance_m - lag(distance_m) over (partition by user_id order by week_start))
         / nullif(lag(distance_m) over (partition by user_id order by week_start), 0),
       1) as ramp_pct
from weekly;

-- Climbing grade pyramid (sends by grade, environment, month)
create view v_grade_pyramid as
select c.user_id,
       c.environment,
       g.discipline,
       c.grade_value,
       max(c.grade_label) as grade_label,
       count(*) filter (where c.sends > 0) as sends,
       count(*) as attempt_rows,
       date_trunc('month', s.occurred_at)::date as month
from climbs c
join sessions s on s.id = c.session_id and s.deleted_at is null
left join grades g on g.id = c.grade_id
where c.deleted_at is null
group by c.user_id, c.environment, g.discipline, c.grade_value, month;

-- Adherence: prescribed vs completed per plan week
create view v_adherence as
select pw.user_id,
       pw.id as plan_week_id,
       pw.start_date,
       count(ps.*) as prescribed,
       count(ps.*) filter (where ps.status = 'completed') as completed,
       count(ps.*) filter (where ps.status = 'skipped')   as skipped,
       round(100.0 * count(ps.*) filter (where ps.status = 'completed')
             / nullif(count(ps.*), 0), 0) as adherence_pct
from plan_weeks pw
left join prescribed_sessions ps on ps.plan_week_id = pw.id and ps.deleted_at is null
where pw.deleted_at is null
group by pw.user_id, pw.id, pw.start_date;

-- Per-body-part soreness trend
create view v_soreness_trend as
select se.user_id, se.body_part, se.side,
       ci.check_in_date,
       se.severity
from soreness_entries se
join check_ins ci on ci.id = se.check_in_id and ci.deleted_at is null
order by se.user_id, se.body_part, ci.check_in_date;

-- Strength PRs (max weight per exercise)
create view v_strength_prs as
select ss.user_id, ss.exercise_id,
       max(ss.exercise_name) as exercise_name,
       max(ss.weight_kg) as max_weight_kg
from strength_sets ss
where ss.deleted_at is null
group by ss.user_id, ss.exercise_id;
