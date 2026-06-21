import type { BodyPart } from "../types.js";

export const SORENESS_FLAG_THRESHOLD = 5;

/** A soreness reading should raise/update a flag when the part is in scope
 *  (watch-list, or all parts if the list is empty) and severity meets the
 *  threshold. Mirrors the logic inlined in logCheckIn. */
export function shouldRaiseFlag(
  bodyPart: BodyPart,
  severity: number,
  watchList: BodyPart[],
  threshold: number = SORENESS_FLAG_THRESHOLD
): boolean {
  const inScope = watchList.length === 0 || watchList.includes(bodyPart);
  return inScope && severity >= threshold;
}

// ─── Recovery policy ──────────────────────────────────────────────────────────

/** Soreness at or below this value counts as "clear" for recovery purposes. */
export const SORENESS_RESOLVE_THRESHOLD = 2;

/** How many consecutive clear check-ins are needed to step a flag down one level. */
export const RESOLVE_AFTER_CLEAR_CHECKINS = 3;

/**
 * Count how many of the most-recent consecutive check-ins are "clear"
 * (severity <= resolveThreshold). The array must be ordered newest-first;
 * a missing entry for the body part should be represented as severity 0.
 * Returns a count capped at requiredClear.
 */
export function recoveryProgress(
  recentSeverities: number[],
  resolveThreshold: number = SORENESS_RESOLVE_THRESHOLD,
  requiredClear: number = RESOLVE_AFTER_CLEAR_CHECKINS
): number {
  let count = 0;
  for (const sev of recentSeverities) {
    if (sev > resolveThreshold) break;
    count++;
    if (count >= requiredClear) break;
  }
  return count;
}

/**
 * Step an injury flag status down one level toward resolved.
 * Transition table:
 *   rehab  → watch
 *   active → watch
 *   watch  → resolved  (resolved_date is set to checkInDate)
 *   resolved → resolved (terminal; no-op)
 *
 * Returns the new status and resolved_date (if transitioning to resolved).
 */
export function stepFlagDown(
  currentStatus: string,
  checkInDate: string
): { status: string; resolved_date: string | null } {
  if (currentStatus === "rehab" || currentStatus === "active") {
    return { status: "watch", resolved_date: null };
  }
  if (currentStatus === "watch") {
    return { status: "resolved", resolved_date: checkInDate };
  }
  return { status: currentStatus, resolved_date: null };
}
