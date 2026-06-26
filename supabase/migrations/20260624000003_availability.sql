-- G1 Intake (design §3, §8): training availability.
--
-- Stored as a default on the profile and *snapshotted* into the plan at
-- generation time, so editing availability later does not silently rewrite an
-- active plan. Additive only — new JSONB columns, no data migration.
--
-- Shape (see core AvailabilitySchema):
--   { days_per_week, hours_per_day, blackout_dow:[0..6],
--     per_sport: { run|climb|strength|...: { max_days, min_rest_days_between,
--                                            allow_back_to_back? } },
--     notes }

alter table profiles add column availability jsonb not null default '{}'::jsonb;
alter table plans    add column availability jsonb not null default '{}'::jsonb;

comment on column profiles.availability is
  'Default training availability (design §3). Snapshotted into plans.availability at generation time.';
comment on column plans.availability is
  'Availability snapshot taken when this plan was generated (immutable input to the periodization engine).';
