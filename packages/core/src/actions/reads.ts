import { SupabaseClient } from "../db.js";
import type {
  Profile,
  Goal,
  Plan,
  Phase,
  PlanWeek,
  PrescribedSession,
  WeekSkeleton,
  SkeletonSlot,
  Session,
  RunDetails,
  Climb,
  StrengthSet,
  CheckIn,
  SorenessEntry,
  InjuryFlag,
  Proposal,
  AdaptationLog,
  WeeklyMileage,
  GradePyramidRow,
  AdherenceRow,
  SorenessTrendRow,
} from "../types.js";

export async function getProfile(db: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getGoals(
  db: SupabaseClient,
  userId: string,
  status = "active"
): Promise<Goal[]> {
  const { data, error } = await db
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", status)
    .is("deleted_at", null)
    .order("priority");
  if (error) throw error;
  return data ?? [];
}

export async function getCurrentPlan(
  db: SupabaseClient,
  userId: string
): Promise<(Plan & { phases: (Phase & { plan_weeks: (PlanWeek & { prescribed_sessions: PrescribedSession[] })[] })[] }) | null> {
  const { data, error } = await db
    .from("plans")
    .select(`
      *,
      phases (
        *,
        plan_weeks (
          *,
          prescribed_sessions ( * )
        )
      )
    `)
    .eq("user_id", userId)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getWeekSkeleton(
  db: SupabaseClient,
  userId: string
): Promise<(WeekSkeleton & { skeleton_slots: SkeletonSlot[] }) | null> {
  const { data, error } = await db
    .from("week_skeletons")
    .select("*, skeleton_slots(*)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface SessionsResult {
  sessions: (Session & {
    run_details?: RunDetails | null;
    climbs?: Climb[];
    strength_sets?: StrengthSet[];
  })[];
}

export async function getSessions(
  db: SupabaseClient,
  userId: string,
  opts: { from: string; to: string; sport?: string }
): Promise<SessionsResult> {
  let q = db
    .from("sessions")
    .select(`
      *,
      run_details (*),
      climbs (*),
      strength_sets (*)
    `)
    .eq("user_id", userId)
    .gte("occurred_at", opts.from)
    .lte("occurred_at", opts.to)
    .is("deleted_at", null)
    .order("occurred_at");

  if (opts.sport) q = q.eq("sport", opts.sport);

  const { data, error } = await q;
  if (error) throw error;
  return { sessions: data ?? [] };
}

export async function getCheckins(
  db: SupabaseClient,
  userId: string,
  opts: { from: string; to: string }
): Promise<(CheckIn & { soreness_entries: SorenessEntry[] })[]> {
  const { data, error } = await db
    .from("check_ins")
    .select("*, soreness_entries(*)")
    .eq("user_id", userId)
    .gte("check_in_date", opts.from.slice(0, 10))
    .lte("check_in_date", opts.to.slice(0, 10))
    .is("deleted_at", null)
    .order("check_in_date");
  if (error) throw error;
  return data ?? [];
}

export async function getInjuryFlags(
  db: SupabaseClient,
  userId: string
): Promise<InjuryFlag[]> {
  const { data, error } = await db
    .from("injury_flags")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "resolved")
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function getPendingProposals(
  db: SupabaseClient,
  userId: string
): Promise<Proposal[]> {
  const { data, error } = await db
    .from("proposals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function getAdaptationLog(
  db: SupabaseClient,
  userId: string,
  limit = 50
): Promise<AdaptationLog[]> {
  const { data, error } = await db
    .from("adaptation_logs")
    .select("*")
    .eq("user_id", userId)
    .order("applied_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── Metric views ─────────────────────────────────────────────────────────────

export async function getWeeklyMileage(
  db: SupabaseClient,
  userId: string,
  weeks = 12
): Promise<WeeklyMileage[]> {
  const from = new Date(Date.now() - weeks * 7 * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("v_weekly_mileage")
    .select("*")
    .eq("user_id", userId)
    .gte("week_start", from)
    .order("week_start");
  if (error) throw error;
  return data ?? [];
}

export async function getGradePyramid(
  db: SupabaseClient,
  userId: string,
  opts?: { environment?: string; months?: number }
): Promise<GradePyramidRow[]> {
  const months = opts?.months ?? 3;
  const from = new Date(Date.now() - months * 30 * 86400_000).toISOString().slice(0, 10);
  let q = db
    .from("v_grade_pyramid")
    .select("*")
    .eq("user_id", userId)
    .gte("month", from);
  if (opts?.environment) q = q.eq("environment", opts.environment);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getAdherence(
  db: SupabaseClient,
  userId: string
): Promise<AdherenceRow[]> {
  const { data, error } = await db
    .from("v_adherence")
    .select("*")
    .eq("user_id", userId)
    .order("start_date", { ascending: false })
    .limit(12);
  if (error) throw error;
  return data ?? [];
}

export async function getSorenessTrend(
  db: SupabaseClient,
  userId: string,
  days = 30
): Promise<SorenessTrendRow[]> {
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("v_soreness_trend")
    .select("*")
    .eq("user_id", userId)
    .gte("check_in_date", from);
  if (error) throw error;
  return data ?? [];
}
