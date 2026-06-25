-- P23: Rich climb logging — new enums + columns on climbs

-- ─── New enums ────────────────────────────────────────────────────────────────

create type climb_angle as enum ('slab', 'vertical', 'overhang', 'roof');

create type climb_character as enum (
  'powerful', 'endurance', 'technical', 'crimpy', 'dynamic'
);

create type climb_result as enum (
  'onsight', 'flash', 'redpoint', 'hung', 'dnf'
);

-- ─── Extend climbs ────────────────────────────────────────────────────────────

alter table climbs
  add column angle          climb_angle,
  add column character_tags climb_character[] not null default '{}',
  add column length_ft      smallint,
  add column effort         smallint check (effort between 1 and 10),
  add column result         climb_result,
  add column climb_notes    text,
  add column wall           text;

-- ─── Indexes for P24 analytics + autocomplete ─────────────────────────────────

create index idx_climbs_result
  on climbs(user_id, result)
  where deleted_at is null;

create index idx_climbs_angle
  on climbs(user_id, angle)
  where deleted_at is null and angle is not null;

create index idx_climbs_character_tags
  on climbs using gin(character_tags)
  where deleted_at is null;
