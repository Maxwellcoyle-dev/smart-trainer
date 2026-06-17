-- Add forward-reference FKs now that sessions and injury_flags exist
alter table prescribed_sessions
  add constraint fk_presc_session
    foreign key (logged_session_id) references sessions(id) on delete set null,
  add constraint fk_presc_injury
    foreign key (injury_flag_id) references injury_flags(id) on delete set null;
