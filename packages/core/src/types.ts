import { z } from "zod";

// ─── Planning side ────────────────────────────────────────────────────────────

export const SportSlotSchema = z.enum(["run", "climb", "strength", "rest"]);
export type SportSlot = z.infer<typeof SportSlotSchema>;

export const DayOfWeekSchema = z.enum([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;

export const WeekSkeletonSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  slots: z.record(DayOfWeekSchema, SportSlotSchema.nullable()),
  updated_at: z.string().datetime(),
});
export type WeekSkeleton = z.infer<typeof WeekSkeletonSchema>;

export const GoalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  type: z.enum(["event", "fitness"]),
  sport: SportSlotSchema,
  description: z.string(),
  target_date: z.string().nullable(),
  target_metric: z.record(z.string(), z.unknown()).nullable(),
  priority: z.number().int().min(1).max(3),
  status: z.enum(["active", "achieved", "dropped"]),
  created_at: z.string().datetime(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const PrescribedSessionSchema = z.object({
  id: z.string().uuid(),
  week_id: z.string().uuid(),
  day: DayOfWeekSchema,
  sport: SportSlotSchema,
  prescription: z.record(z.string(), z.unknown()),
  notes: z.string().nullable(),
});
export type PrescribedSession = z.infer<typeof PrescribedSessionSchema>;

export const PhaseSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  name: z.string(),
  type: z.enum(["base", "build", "peak", "recovery"]),
  start_date: z.string(),
  end_date: z.string(),
  notes: z.string().nullable(),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const PlanSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  status: z.enum(["active", "archived"]),
  created_at: z.string().datetime(),
});
export type Plan = z.infer<typeof PlanSchema>;

// ─── Execution side ───────────────────────────────────────────────────────────

export const RunLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  logged_at: z.string().datetime(),
  distance_km: z.number().positive(),
  duration_seconds: z.number().int().positive(),
  pace_per_km: z.number().positive(),
  surface: z.enum(["trail", "road", "track", "treadmill"]),
  rpe: z.number().int().min(1).max(10).nullable(),
  notes: z.string().nullable(),
  prescribed_session_id: z.string().uuid().nullable(),
});
export type RunLog = z.infer<typeof RunLogSchema>;

export const ClimbSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  grade: z.string(),
  style: z.enum(["sport", "boulder", "tr", "trad"]),
  attempts: z.number().int().min(1),
  sends: z.number().int().min(0),
  indoor: z.boolean(),
  route_name: z.string().nullable(),
});
export type Climb = z.infer<typeof ClimbSchema>;

export const ClimbSessionSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  logged_at: z.string().datetime(),
  rpe: z.number().int().min(1).max(10).nullable(),
  notes: z.string().nullable(),
  prescribed_session_id: z.string().uuid().nullable(),
  climbs: z.array(ClimbSchema),
});
export type ClimbSession = z.infer<typeof ClimbSessionSchema>;

export const SetSchema = z.object({
  id: z.string().uuid(),
  log_id: z.string().uuid(),
  exercise: z.string(),
  reps: z.number().int().positive(),
  weight_kg: z.number().nonnegative().nullable(),
  rpe: z.number().int().min(1).max(10).nullable(),
});
export type Set = z.infer<typeof SetSchema>;

export const StrengthLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  logged_at: z.string().datetime(),
  notes: z.string().nullable(),
  prescribed_session_id: z.string().uuid().nullable(),
  sets: z.array(SetSchema),
});
export type StrengthLog = z.infer<typeof StrengthLogSchema>;

export const BodyPartSchema = z.enum([
  "calf",
  "knee",
  "shoulder",
  "hip",
  "ankle",
  "back",
  "elbow",
  "wrist",
]);
export type BodyPart = z.infer<typeof BodyPartSchema>;

export const CheckInSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  logged_at: z.string().datetime(),
  sleep_hours: z.number().min(0).max(24).nullable(),
  soreness: z.record(BodyPartSchema, z.number().int().min(0).max(5)),
  bodyweight_kg: z.number().positive().nullable(),
  mood: z.number().int().min(1).max(5).nullable(),
  readiness: z.number().int().min(1).max(5).nullable(),
  notes: z.string().nullable(),
});
export type CheckIn = z.infer<typeof CheckInSchema>;

export const InjuryFlagSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  body_part: BodyPartSchema,
  status: z.enum(["monitoring", "active", "resolved"]),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type InjuryFlag = z.infer<typeof InjuryFlagSchema>;

// ─── Audit ────────────────────────────────────────────────────────────────────

export const AdaptationLogSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  source: z.enum(["app-coach", "desktop-mcp", "manual"]),
  action: z.string(),
  diff: z.record(z.string(), z.unknown()),
  rationale: z.string().nullable(),
  status: z.enum(["proposed", "approved", "rejected", "applied"]),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable(),
});
export type AdaptationLog = z.infer<typeof AdaptationLogSchema>;

// ─── Proposal queue ───────────────────────────────────────────────────────────

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  source: z.enum(["app-coach", "desktop-mcp"]),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string().nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
  created_at: z.string().datetime(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// ─── Metrics (derived, computed server-side) ──────────────────────────────────

export interface WeeklyMetrics {
  week_start: string;
  run_km: number;
  run_km_prev: number;
  ramp_pct: number;
  climb_sessions: number;
  strength_sessions: number;
  prescribed_sessions: number;
  completed_sessions: number;
  adherence_pct: number;
}

export interface GradePyramidEntry {
  grade: string;
  style: string;
  sends: number;
  attempts: number;
}

export interface SorenessTrend {
  body_part: BodyPart;
  readings: { date: string; score: number }[];
}
