-- P24 fix: derive discipline from style instead of joining grades on grade_id.
-- Grades are now a static in-app list, so climbs no longer carry a grade_id FK.
-- discipline is fully determined by style (boulder vs rope), which is stored on
-- the climb row, so the grades join is no longer needed for v_climb_progression.

create or replace view v_climb_progression as
select
  c.user_id,
  date_trunc('month', s.occurred_at)::date as month,
  c.environment,
  case when c.style = 'boulder' then 'boulder' else 'rope' end as discipline,
  max(c.grade_value)                        as max_grade_value,
  (array_agg(c.grade_label order by c.grade_value desc))[1] as max_grade_label
from climbs c
join sessions s on s.id = c.session_id
where c.deleted_at is null
  and s.deleted_at is null
  and (
    c.result in ('onsight', 'flash', 'redpoint')
    or (c.result is null and c.sends > 0)
  )
group by c.user_id, month, c.environment, discipline;

alter view v_climb_progression set (security_invoker = on);
