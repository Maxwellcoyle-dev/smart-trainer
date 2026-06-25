import { z } from "zod";

// ─── Enums (mirror 0002_enums.sql) ───────────────────────────────────────────

export const SportTypeSchema = z.enum([
  "run", "climb", "strength", "mobility", "rest", "cross_train",
]);
export type SportType = z.infer<typeof SportTypeSchema>;

export const SessionSourceSchema = z.enum(["manual", "import", "seed"]);
export type SessionSource = z.infer<typeof SessionSourceSchema>;

export const PlanStatusSchema = z.enum(["draft", "active", "completed", "abandoned"]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PhaseTypeSchema = z.enum(["base", "build", "peak", "taper", "recovery", "custom"]);
export type PhaseType = z.infer<typeof PhaseTypeSchema>;

export const PrescribedStatusSchema = z.enum([
  "planned", "completed", "partial", "skipped", "modified",
]);
export type PrescribedStatus = z.infer<typeof PrescribedStatusSchema>;

export const GoalKindSchema = z.enum(["event", "grade", "process", "metric"]);
export type GoalKind = z.infer<typeof GoalKindSchema>;

export const GoalStatusSchema = z.enum(["active", "achieved", "missed", "abandoned"]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const ClimbStyleSchema = z.enum(["sport", "boulder", "top_rope", "trad", "auto"]);
export type ClimbStyle = z.infer<typeof ClimbStyleSchema>;

export const ClimbEnvironmentSchema = z.enum(["indoor", "outdoor"]);
export type ClimbEnvironment = z.infer<typeof ClimbEnvironmentSchema>;

export const ClimbAngleSchema = z.enum(["slab", "vertical", "overhang", "roof"]);
export type ClimbAngle = z.infer<typeof ClimbAngleSchema>;

export const ClimbCharacterSchema = z.enum([
  "powerful", "endurance", "technical", "crimpy", "dynamic",
]);
export type ClimbCharacter = z.infer<typeof ClimbCharacterSchema>;

export const ClimbResultSchema = z.enum(["onsight", "flash", "redpoint", "hung", "dnf"]);
export type ClimbResult = z.infer<typeof ClimbResultSchema>;

export const RunSurfaceSchema = z.enum(["trail", "road", "track", "treadmill", "mixed"]);
export type RunSurface = z.infer<typeof RunSurfaceSchema>;

export const BodyPartSchema = z.enum([
  "calf", "achilles", "knee", "shoulder", "elbow", "finger", "wrist", "hip",
  "ankle", "foot", "hamstring", "quad", "lower_back", "upper_back", "neck", "other",
]);
export type BodyPart = z.infer<typeof BodyPartSchema>;

export const BodySideSchema = z.enum(["left", "right", "bilateral", "na"]);
export type BodySide = z.infer<typeof BodySideSchema>;

export const InjuryStatusSchema = z.enum(["watch", "active", "rehab", "resolved"]);
export type InjuryStatus = z.infer<typeof InjuryStatusSchema>;

export const WriteSourceSchema = z.enum(["manual", "app_coach", "desktop_mcp", "hook"]);
export type WriteSource = z.infer<typeof WriteSourceSchema>;

export const ProposalStatusSchema = z.enum([
  "pending", "approved", "rejected", "superseded", "expired",
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant", "tool", "system"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const AiJobStatusSchema = z.enum([
  "queued", "running", "succeeded", "failed", "skipped",
]);
export type AiJobStatus = z.infer<typeof AiJobStatusSchema>;

// ─── Profile ──────────────────────────────────────────────────────────────────

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  birth_date: z.string().nullable(),
  height_cm: z.number().nullable(),
  units: z.string(),
  injury_history: z.string().nullable(),
  equipment: z.record(z.string(), z.unknown()),
  watch_list: z.array(BodyPartSchema),
  preferences: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Profile = z.infer<typeof ProfileSchema>;

// ─── Goals ────────────────────────────────────────────────────────────────────

export const GoalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  kind: GoalKindSchema,
  sport: SportTypeSchema.nullable(),
  title: z.string(),
  target_date: z.string().nullable(),
  target: z.record(z.string(), z.unknown()),
  priority: z.number().int(),
  status: GoalStatusSchema,
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const CreateGoalInputSchema = z.object({
  kind: GoalKindSchema,
  title: z.string().min(1),
  sport: SportTypeSchema.nullable().optional(),
  target_date: z.string().nullable().optional(),
  target: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateGoalInput = z.infer<typeof CreateGoalInputSchema>;

export const UpdateGoalInputSchema = z.object({
  title: z.string().min(1).optional(),
  sport: SportTypeSchema.nullable().optional(),
  target_date: z.string().nullable().optional(),
  target: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
  status: GoalStatusSchema.optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateGoalInput = z.infer<typeof UpdateGoalInputSchema>;

// ─── Planning structure ───────────────────────────────────────────────────────

export const PlanSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  status: PlanStatusSchema,
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  intent: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PhaseSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  phase_index: z.number().int(),
  name: z.string(),
  type: PhaseTypeSchema,
  intent: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const PlanWeekSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  phase_id: z.string().uuid(),
  week_index: z.number().int(),
  start_date: z.string().nullable(),
  theme: z.string().nullable(),
  targets: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type PlanWeek = z.infer<typeof PlanWeekSchema>;

export const PrescribedSessionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  plan_week_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  scheduled_date: z.string().nullable(),
  sport: SportTypeSchema,
  order_in_day: z.number().int(),
  prescription: z.record(z.string(), z.unknown()),
  status: PrescribedStatusSchema,
  logged_session_id: z.string().uuid().nullable(),
  injury_flag_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type PrescribedSession = z.infer<typeof PrescribedSessionSchema>;

// ─── Week skeleton ────────────────────────────────────────────────────────────

export const WeekSkeletonSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type WeekSkeleton = z.infer<typeof WeekSkeletonSchema>;

export const SkeletonSlotSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  skeleton_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  sport: SportTypeSchema,
  order_in_day: z.number().int(),
  hint: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SkeletonSlot = z.infer<typeof SkeletonSlotSchema>;

// ─── Reference tables ─────────────────────────────────────────────────────────

export const GradeSchema = z.object({
  id: z.string().uuid(),
  system: z.string(),
  label: z.string(),
  grade_value: z.number().int(),
  discipline: z.string(),
});
export type Grade = z.infer<typeof GradeSchema>;

export const ExerciseSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  category: z.string().nullable(),
  cues: z.string().nullable(),
  target_tissue: z.array(BodyPartSchema),
  is_seed: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

// ─── Sessions (execution side) ────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  sport: SportTypeSchema,
  occurred_at: z.string(),
  duration_s: z.number().int().nullable(),
  session_rpe: z.number().int().min(1).max(10).nullable(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  source: SessionSourceSchema,
  prescribed_session_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const RunDetailsSchema = z.object({
  session_id: z.string().uuid(),
  user_id: z.string().uuid(),
  distance_m: z.number().int().positive(),   // meters
  surface: RunSurfaceSchema,
  elevation_gain_m: z.number().int().nullable(),
  avg_hr: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RunDetails = z.infer<typeof RunDetailsSchema>;

export const ClimbSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  session_id: z.string().uuid(),
  grade_id: z.string().uuid().nullable(),
  grade_label: z.string().nullable(),
  grade_value: z.number().int().nullable(),
  style: ClimbStyleSchema,
  environment: ClimbEnvironmentSchema,
  attempts: z.number().int().min(1),
  sends: z.number().int().min(0),
  route_name: z.string().nullable(),
  crag: z.string().nullable(),
  order_in_session: z.number().int(),
  // P23 fields
  angle: ClimbAngleSchema.nullable(),
  character_tags: z.array(ClimbCharacterSchema),
  length_ft: z.number().int().nullable(),
  effort: z.number().int().min(1).max(10).nullable(),
  result: ClimbResultSchema.nullable(),
  climb_notes: z.string().nullable(),
  wall: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Climb = z.infer<typeof ClimbSchema>;

export const StrengthSetSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  session_id: z.string().uuid(),
  exercise_id: z.string().uuid().nullable(),
  exercise_name: z.string().nullable(),
  set_index: z.number().int(),
  reps: z.number().int().nullable(),
  weight_kg: z.number().nullable(),
  rpe: z.number().int().min(1).max(10).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type StrengthSet = z.infer<typeof StrengthSetSchema>;

// ─── Wellness ─────────────────────────────────────────────────────────────────

export const CheckInSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  check_in_date: z.string(),
  sleep_hours: z.number().nullable(),
  sleep_quality: z.number().int().min(1).max(5).nullable(),
  bodyweight_kg: z.number().nullable(),
  mood: z.number().int().min(1).max(5).nullable(),
  readiness: z.number().int().min(1).max(10).nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type CheckIn = z.infer<typeof CheckInSchema>;

export const SorenessEntrySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  check_in_id: z.string().uuid(),
  body_part: BodyPartSchema,
  side: BodySideSchema,
  severity: z.number().int().min(0).max(10),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SorenessEntry = z.infer<typeof SorenessEntrySchema>;

export const InjuryFlagSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  body_part: BodyPartSchema,
  side: BodySideSchema,
  status: InjuryStatusSchema,
  severity: z.number().int().min(0).max(10).nullable(),
  onset_date: z.string(),
  resolved_date: z.string().nullable(),
  narrative: z.string().nullable(),
  origin: WriteSourceSchema,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type InjuryFlag = z.infer<typeof InjuryFlagSchema>;

// ─── AI & Audit ───────────────────────────────────────────────────────────────

export const AdaptationDiffSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  op: z.enum(["create", "update", "delete", "replace_subtree"]),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  fields: z.array(z.string()),
});
export type AdaptationDiff = z.infer<typeof AdaptationDiffSchema>;

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  source: WriteSourceSchema,
  action_type: z.string(),
  diff: AdaptationDiffSchema,
  rationale: z.string().nullable(),
  status: ProposalStatusSchema,
  thread_id: z.string().uuid().nullable(),
  job_run_id: z.string().uuid().nullable(),
  expires_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export const AdaptationLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  source: WriteSourceSchema,
  action_type: z.string(),
  diff: AdaptationDiffSchema,
  rationale: z.string().nullable(),
  proposal_id: z.string().uuid().nullable(),
  thread_id: z.string().uuid().nullable(),
  job_run_id: z.string().uuid().nullable(),
  reverts_log_id: z.string().uuid().nullable(),
  reverted_at: z.string().nullable(),
  applied_at: z.string(),
  created_at: z.string(),
});
export type AdaptationLog = z.infer<typeof AdaptationLogSchema>;

export const CoachMessageSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  thread_id: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string().nullable(),
  tool_calls: z.array(z.unknown()),
  model: z.string().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  created_at: z.string(),
});
export type CoachMessage = z.infer<typeof CoachMessageSchema>;

// ─── Derived / computed types (views) ─────────────────────────────────────────

export interface WeeklyMileage {
  user_id: string;
  week_start: string;
  distance_m: number;
  n_runs: number;
  prev_distance_m: number | null;
  ramp_pct: number | null;
}

export interface GradePyramidRow {
  user_id: string;
  environment: ClimbEnvironment;
  discipline: string | null;
  grade_value: number;
  grade_label: string;
  sends: number;
  attempt_rows: number;
  month: string;
}

export interface AdherenceRow {
  user_id: string;
  plan_week_id: string;
  start_date: string;
  prescribed: number;
  completed: number;
  skipped: number;
  adherence_pct: number;
}

export interface SorenessTrendRow {
  user_id: string;
  body_part: BodyPart;
  side: BodySide;
  check_in_date: string;
  severity: number;
}

// ─── Climb progress views (P24) ──────────────────────────────────────────────

export interface ClimbProgressionRow {
  user_id: string;
  month: string;
  environment: ClimbEnvironment;
  discipline: string | null;
  max_grade_value: number;
  max_grade_label: string | null;
}

export interface ClimbSendRateRow {
  user_id: string;
  month: string;
  environment: ClimbEnvironment;
  total_climbs: number;
  total_attempts: number;
  total_sends: number;
  send_rate_pct: number | null;
  onsight_count: number;
  flash_count: number;
  redpoint_count: number;
  hung_count: number;
  dnf_count: number;
  no_result_count: number;
}

export interface ClimbVolumeRow {
  user_id: string;
  week_start: string;
  sessions: number;
  climbs: number;
  total_attempts: number;
}

export interface ClimbByAngleRow {
  user_id: string;
  angle: ClimbAngle;
  climb_count: number;
  total_attempts: number;
  total_sends: number;
  send_rate_pct: number | null;
}

export interface ClimbByCharacterRow {
  user_id: string;
  tag: ClimbCharacter;
  climb_count: number;
  total_attempts: number;
  total_sends: number;
  send_rate_pct: number | null;
}

// ─── Composite input types (used by logging forms + action layer) ─────────────

export interface LogRunInput {
  occurred_at: string;
  duration_s: number;
  distance_m: number;          // meters
  surface: RunSurface;
  elevation_gain_m?: number | null;
  session_rpe?: number | null;
  location?: string | null;
  notes?: string | null;
  prescribed_session_id?: string | null;
}

export interface ClimbInput {
  grade_label: string;
  grade_value?: number | null;
  grade_id?: string | null;
  style: ClimbStyle;
  environment: ClimbEnvironment;
  attempts: number;
  sends: number;
  route_name?: string | null;
  crag?: string | null;
  order_in_session?: number;
  // P23 fields
  angle?: ClimbAngle | null;
  character_tags?: ClimbCharacter[];
  length_ft?: number | null;
  effort?: number | null;
  result?: ClimbResult | null;
  climb_notes?: string | null;
  wall?: string | null;
}

export interface LogClimbSessionInput {
  occurred_at: string;
  duration_s?: number | null;
  session_rpe?: number | null;
  location?: string | null;
  notes?: string | null;
  prescribed_session_id?: string | null;
  climbs: ClimbInput[];
}

export interface StrengthSetInput {
  exercise_id?: string | null;
  exercise_name: string;
  set_index: number;
  reps?: number | null;
  weight_kg?: number | null;
  rpe?: number | null;
}

export interface LogStrengthInput {
  occurred_at: string;
  duration_s?: number | null;
  session_rpe?: number | null;
  notes?: string | null;
  prescribed_session_id?: string | null;
  sets: StrengthSetInput[];
}

export interface SorenessInput {
  body_part: BodyPart;
  side?: BodySide;
  severity: number;
}

export interface LogCheckInInput {
  check_in_date: string;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  bodyweight_kg?: number | null;
  mood?: number | null;
  readiness?: number | null;
  notes?: string | null;
  soreness: SorenessInput[];
}

export interface SkeletonSlotInput {
  day_of_week: number;  // 0 = Mon
  sport: SportType;
  order_in_day?: number;
  hint?: string | null;
}

export type WriteMode = "apply" | "propose";
