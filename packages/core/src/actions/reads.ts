import { SupabaseClient } from "../db.js";
import type {
  Goal,
  Plan,
  WeekSkeleton,
  RunLog,
  ClimbSession,
  StrengthLog,
  CheckIn,
  InjuryFlag,
  Proposal,
  AdaptationLog,
} from "../types.js";

export async function getProfile(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function getGoals(db: SupabaseClient, userId: string): Promise<Goal[]> {
  const { data, error } = await db
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("priority");
  if (error) throw error;
  return data ?? [];
}

export async function getCurrentPlan(db: SupabaseClient, userId: string): Promise<Plan | null> {
  const { data, error } = await db
    .from("plans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getWeekSkeleton(db: SupabaseClient, userId: string): Promise<WeekSkeleton | null> {
  const { data, error } = await db
    .from("week_skeletons")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSessions(
  db: SupabaseClient,
  userId: string,
  opts: { from: string; to: string; sport?: "run" | "climb" | "strength" }
) {
  const results: {
    runs: RunLog[];
    climbs: ClimbSession[];
    strength: StrengthLog[];
  } = { runs: [], climbs: [], strength: [] };

  if (!opts.sport || opts.sport === "run") {
    const { data, error } = await db
      .from("run_logs")
      .select("*")
      .eq("user_id", userId)
      .gte("logged_at", opts.from)
      .lte("logged_at", opts.to)
      .order("logged_at");
    if (error) throw error;
    results.runs = data ?? [];
  }

  if (!opts.sport || opts.sport === "climb") {
    const { data, error } = await db
      .from("climb_sessions")
      .select("*, climbs(*)")
      .eq("user_id", userId)
      .gte("logged_at", opts.from)
      .lte("logged_at", opts.to)
      .order("logged_at");
    if (error) throw error;
    results.climbs = data ?? [];
  }

  if (!opts.sport || opts.sport === "strength") {
    const { data, error } = await db
      .from("strength_logs")
      .select("*, sets(*)")
      .eq("user_id", userId)
      .gte("logged_at", opts.from)
      .lte("logged_at", opts.to)
      .order("logged_at");
    if (error) throw error;
    results.strength = data ?? [];
  }

  return results;
}

export async function getCheckins(
  db: SupabaseClient,
  userId: string,
  opts: { from: string; to: string }
): Promise<CheckIn[]> {
  const { data, error } = await db
    .from("check_ins")
    .select("*")
    .eq("user_id", userId)
    .gte("logged_at", opts.from)
    .lte("logged_at", opts.to)
    .order("logged_at");
  if (error) throw error;
  return data ?? [];
}

export async function getInjuryFlags(db: SupabaseClient, userId: string): Promise<InjuryFlag[]> {
  const { data, error } = await db
    .from("injury_flags")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "resolved")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function getPendingProposals(db: SupabaseClient, userId: string): Promise<Proposal[]> {
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
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
