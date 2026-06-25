-- P24: Climb progress analytics views

-- ─── v_climb_progression ──────────────────────────────────────────────────────
-- Highest grade sent per month, by discipline and environment.
-- "Sent" = result in (onsight, flash, redpoint) OR (result is null AND sends > 0).

create or replace view v_climb_progression as
select
  c.user_id,
  date_trunc('month', s.occurred_at)::date as month,
  c.environment,
  g.discipline,
  max(c.grade_value)                        as max_grade_value,
  (array_agg(c.grade_label order by c.grade_value desc))[1] as max_grade_label
from climbs c
join sessions s on s.id = c.session_id
left join grades g on g.id = c.grade_id
where c.deleted_at is null
  and s.deleted_at is null
  and (
    c.result in ('onsight', 'flash', 'redpoint')
    or (c.result is null and c.sends > 0)
  )
group by c.user_id, month, c.environment, g.discipline;

-- ─── v_climb_send_rate ────────────────────────────────────────────────────────
-- Sends ÷ attempts and result mix per month.

create or replace view v_climb_send_rate as
select
  c.user_id,
  date_trunc('month', s.occurred_at)::date as month,
  c.environment,
  count(*)                                  as total_climbs,
  sum(c.attempts)                           as total_attempts,
  sum(c.sends)                              as total_sends,
  round(
    sum(c.sends)::numeric / nullif(sum(c.attempts), 0) * 100,
    1
  )                                         as send_rate_pct,
  count(*) filter (where c.result = 'onsight')   as onsight_count,
  count(*) filter (where c.result = 'flash')     as flash_count,
  count(*) filter (where c.result = 'redpoint')  as redpoint_count,
  count(*) filter (where c.result = 'hung')      as hung_count,
  count(*) filter (where c.result = 'dnf')       as dnf_count,
  count(*) filter (where c.result is null)       as no_result_count
from climbs c
join sessions s on s.id = c.session_id
where c.deleted_at is null
  and s.deleted_at is null
group by c.user_id, month, c.environment;

-- ─── v_climb_volume ───────────────────────────────────────────────────────────
-- Climbs logged and total attempts per week (training load proxy).

create or replace view v_climb_volume as
select
  c.user_id,
  date_trunc('week', s.occurred_at)::date as week_start,
  count(distinct s.id)                    as sessions,
  count(*)                                as climbs,
  sum(c.attempts)                         as total_attempts
from climbs c
join sessions s on s.id = c.session_id
where c.deleted_at is null
  and s.deleted_at is null
group by c.user_id, week_start;

-- ─── v_climb_by_angle ────────────────────────────────────────────────────────
-- Send rate and climb count grouped by wall angle.

create or replace view v_climb_by_angle as
select
  c.user_id,
  c.angle,
  count(*)                                   as climb_count,
  sum(c.attempts)                            as total_attempts,
  sum(c.sends)                               as total_sends,
  round(
    sum(c.sends)::numeric / nullif(sum(c.attempts), 0) * 100,
    1
  )                                          as send_rate_pct
from climbs c
where c.deleted_at is null
  and c.angle is not null
group by c.user_id, c.angle;

-- ─── v_climb_by_character ─────────────────────────────────────────────────────
-- Send rate and climb count grouped by each character_tags value (unnested).

create or replace view v_climb_by_character as
select
  c.user_id,
  tag,
  count(*)                                   as climb_count,
  sum(c.attempts)                            as total_attempts,
  sum(c.sends)                               as total_sends,
  round(
    sum(c.sends)::numeric / nullif(sum(c.attempts), 0) * 100,
    1
  )                                          as send_rate_pct
from climbs c,
  unnest(c.character_tags) as tag
where c.deleted_at is null
group by c.user_id, tag;
