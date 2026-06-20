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
