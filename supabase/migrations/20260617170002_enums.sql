-- All enum types
create type sport_type        as enum ('run','climb','strength','mobility','rest','cross_train');
create type session_source    as enum ('manual','import','seed');
create type plan_status       as enum ('draft','active','completed','abandoned');
create type phase_type        as enum ('base','build','peak','taper','recovery','custom');
create type prescribed_status as enum ('planned','completed','partial','skipped','modified');
create type goal_kind         as enum ('event','grade','process','metric');
create type goal_status       as enum ('active','achieved','missed','abandoned');
create type climb_style       as enum ('sport','boulder','top_rope','trad','auto');
create type climb_environment as enum ('indoor','outdoor');
create type run_surface       as enum ('trail','road','track','treadmill','mixed');
create type body_part         as enum (
  'calf','achilles','knee','shoulder','elbow','finger','wrist','hip',
  'ankle','foot','hamstring','quad','lower_back','upper_back','neck','other');
create type body_side         as enum ('left','right','bilateral','na');
create type injury_status     as enum ('watch','active','rehab','resolved');
create type write_source      as enum ('manual','app_coach','desktop_mcp','hook');
create type proposal_status   as enum ('pending','approved','rejected','superseded','expired');
create type review_scope      as enum ('session','week','phase','goal','adhoc');
create type message_role      as enum ('user','assistant','tool','system');
create type ai_job_status     as enum ('queued','running','succeeded','failed','skipped');
