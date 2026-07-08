/**
 * Activity ingestion (roadmap phase 2): normalized imported activities →
 * sessions with source='import'. Provider-agnostic — FIT/TCX/GPX uploads,
 * Strava, and Garmin all funnel through here.
 *
 * Dedupe, two layers:
 *   1. Exact: unique (user_id, provider, external_id) on session_imports.
 *   2. Fuzzy: an existing session of the same sport whose start time is within
 *      ±OVERLAP_WINDOW_MIN of the import (catches "logged manually, then
 *      imported the watch file").
 */
import { z } from "zod";
import type { SupabaseClient } from "../db.js";
import { SportTypeSchema } from "../types.js";

export const ImportedActivitySchema = z.object({
  provider: z.enum(["file_upload", "strava", "garmin"]),
  external_id: z.string().min(1),
  sport: SportTypeSchema,
  occurred_at: z.string(), // ISO
  duration_s: z.number().int().positive().nullable(),
  distance_m: z.number().int().positive().nullable().optional(),
  elevation_gain_m: z.number().int().nullable().optional(),
  avg_hr: z.number().int().min(20).max(250).nullable().optional(),
  title: z.string().nullable().optional(),
  /** Trimmed provider payload kept for reprocessing/debugging. */
  raw: z.record(z.string(), z.unknown()).default({}),
});
export type ImportedActivity = z.infer<typeof ImportedActivitySchema>;

export interface IngestResult {
  status: "imported" | "duplicate";
  session_id: string | null;
  /** Which dedupe layer fired, when status='duplicate'. */
  duplicate_of?: "external_id" | "overlapping_session";
}

export const OVERLAP_WINDOW_MIN = 20;

/** Pure: do two session start times overlap within the dedupe window? */
export function isOverlapping(aISO: string, bISO: string, windowMin = OVERLAP_WINDOW_MIN): boolean {
  const ms = Math.abs(new Date(aISO).getTime() - new Date(bISO).getTime());
  return ms <= windowMin * 60_000;
}

export async function ingestImportedActivity(
  db: SupabaseClient,
  userId: string,
  activity: ImportedActivity
): Promise<IngestResult> {
  // Layer 1: exact external-id dedupe.
  const { data: existing, error: exErr } = await db
    .from("session_imports")
    .select("id, session_id")
    .eq("user_id", userId)
    .eq("provider", activity.provider)
    .eq("external_id", activity.external_id)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing) {
    return { status: "duplicate", session_id: existing.session_id, duplicate_of: "external_id" };
  }

  // Layer 2: fuzzy time-window dedupe against existing sessions.
  const from = new Date(new Date(activity.occurred_at).getTime() - OVERLAP_WINDOW_MIN * 60_000).toISOString();
  const to = new Date(new Date(activity.occurred_at).getTime() + OVERLAP_WINDOW_MIN * 60_000).toISOString();
  const { data: nearby, error: nbErr } = await db
    .from("sessions")
    .select("id, occurred_at")
    .eq("user_id", userId)
    .eq("sport", activity.sport)
    .is("deleted_at", null)
    .gte("occurred_at", from)
    .lte("occurred_at", to)
    .limit(1);
  if (nbErr) throw nbErr;

  if (nearby && nearby.length > 0) {
    const { error } = await db.from("session_imports").insert({
      user_id: userId,
      provider: activity.provider,
      external_id: activity.external_id,
      session_id: nearby[0].id,
      status: "duplicate",
      raw: activity.raw,
    });
    if (error) throw error;
    return { status: "duplicate", session_id: nearby[0].id, duplicate_of: "overlapping_session" };
  }

  // Create the session.
  const { data: session, error: sErr } = await db
    .from("sessions")
    .insert({
      user_id: userId,
      sport: activity.sport,
      occurred_at: activity.occurred_at,
      duration_s: activity.duration_s,
      notes: activity.title ?? null,
      source: "import",
    })
    .select()
    .single();
  if (sErr) throw sErr;

  if (activity.sport === "run" && activity.distance_m) {
    const { error: rdErr } = await db.from("run_details").insert({
      session_id: session.id,
      user_id: userId,
      distance_m: activity.distance_m,
      surface: "road", // unknown from file; user can edit later
      elevation_gain_m: activity.elevation_gain_m ?? null,
      avg_hr: activity.avg_hr ?? null,
    });
    if (rdErr) throw rdErr;
  }

  const { error: siErr } = await db.from("session_imports").insert({
    user_id: userId,
    provider: activity.provider,
    external_id: activity.external_id,
    session_id: session.id,
    status: "imported",
    raw: activity.raw,
  });
  if (siErr) throw siErr;

  return { status: "imported", session_id: session.id };
}
