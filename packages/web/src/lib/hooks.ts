import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WeeklyMileage,
  GradePyramidRow,
  SorenessTrendRow,
  AdherenceRow,
  Proposal,
} from "@smart-trainer/core";
import { api } from "./api.ts";

// ─── Mutation payloads (mirror packages/server/src/routes/*.ts zod bodies) ────

export interface RunPayload {
  occurred_at: string;
  duration_s: number;
  distance_m: number;
  surface: "trail" | "road" | "track" | "treadmill" | "mixed";
  elevation_gain_m?: number | null;
  session_rpe?: number | null;
  notes?: string | null;
  prescribed_session_id?: string | null;
}

export interface ClimbPayload {
  occurred_at: string;
  duration_s?: number | null;
  session_rpe?: number | null;
  notes?: string | null;
  prescribed_session_id?: string | null;
  climbs: {
    grade_label: string;
    grade_value?: number | null;
    grade_id?: string | null;
    style: "sport" | "boulder" | "top_rope" | "trad" | "auto";
    environment: "indoor" | "outdoor";
    attempts: number;
    sends: number;
    route_name?: string | null;
    crag?: string | null;
    order_in_session?: number;
  }[];
}

export interface StrengthPayload {
  occurred_at: string;
  duration_s?: number | null;
  session_rpe?: number | null;
  notes?: string | null;
  prescribed_session_id?: string | null;
  sets: {
    exercise_id?: string | null;
    exercise_name: string;
    set_index: number;
    reps?: number | null;
    weight_kg?: number | null;
    rpe?: number | null;
  }[];
}

export interface CheckInPayload {
  check_in_date: string;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  bodyweight_kg?: number | null;
  mood?: number | null;
  readiness?: number | null;
  notes?: string | null;
  soreness: { body_part: string; side?: string; severity: number }[];
}

export interface SkeletonSlotPayload {
  day_of_week: number;
  sport: "run" | "climb" | "strength" | "mobility" | "rest" | "cross_train";
  order_in_day?: number;
  hint?: string | null;
}

// ─── Logging mutations ────────────────────────────────────────────────────────

const METRIC_KEYS = [["metrics"], ["plan"], ["home"]];

function useLoggingMutation<TPayload>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: TPayload) => api.post(path, payload),
    onSuccess: () => {
      METRIC_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    },
  });
}

export const useLogRun = () => useLoggingMutation<RunPayload>("/logs/run");
export const useLogClimb = () => useLoggingMutation<ClimbPayload>("/logs/climb");
export const useLogStrength = () => useLoggingMutation<StrengthPayload>("/logs/strength");
export const useLogCheckIn = () => useLoggingMutation<CheckInPayload>("/logs/checkin");

export function useSaveSkeleton() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; slots: SkeletonSlotPayload[] }) =>
      api.put("/plan/skeleton", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
  });
}

// ─── Metric queries ───────────────────────────────────────────────────────────

export function useWeeklyMileage(weeks = 12) {
  return useQuery({
    queryKey: ["metrics", "weekly-mileage", weeks],
    queryFn: () => api.get<WeeklyMileage[]>(`/metrics/weekly-mileage?weeks=${weeks}`),
  });
}

export interface PyramidResponse {
  rows: GradePyramidRow[];
  aggregated: Record<
    string,
    { grade_label: string; grade_value: number; sends: number; attempts: number }[]
  >;
}

export function useGradePyramid(months = 3, environment?: string) {
  const q = new URLSearchParams({ months: String(months) });
  if (environment) q.set("environment", environment);
  return useQuery({
    queryKey: ["metrics", "grade-pyramid", months, environment ?? "all"],
    queryFn: () => api.get<PyramidResponse>(`/metrics/grade-pyramid?${q.toString()}`),
  });
}

export function useSorenessTrend(days = 30) {
  return useQuery({
    queryKey: ["metrics", "soreness-trend", days],
    queryFn: () => api.get<SorenessTrendRow[]>(`/metrics/soreness-trend?days=${days}`),
  });
}

export function useAdherence() {
  return useQuery({
    queryKey: ["metrics", "adherence"],
    queryFn: () => api.get<AdherenceRow[]>(`/metrics/adherence`),
  });
}

// ─── Plan / skeleton queries ──────────────────────────────────────────────────

export interface SkeletonResponse {
  id: string;
  name: string;
  is_active: boolean;
  skeleton_slots: {
    id: string;
    day_of_week: number;
    sport: string;
    order_in_day: number;
    hint: string | null;
  }[];
}

export function useSkeleton() {
  return useQuery({
    queryKey: ["plan", "skeleton"],
    queryFn: () => api.get<SkeletonResponse | null>("/plan/skeleton"),
  });
}

export interface InjuryFlag {
  id: string;
  body_part: string;
  side: string;
  status: string;
  severity: number | null;
  narrative: string | null;
}

export interface LatestCheckin {
  check_in_date: string;
  readiness: number | null;
  mood: number | null;
  sleep_hours: number | null;
  soreness_entries: { body_part: string; side?: string; severity: number }[];
}

export function useInjuryFlags() {
  return useQuery({
    queryKey: ["wellness", "injury-flags"],
    queryFn: () => api.get<InjuryFlag[]>("/wellness/injury-flags"),
  });
}

export function useLatestCheckin() {
  return useQuery({
    queryKey: ["home", "latest-checkin"],
    queryFn: () => api.get<LatestCheckin | null>("/wellness/latest-checkin"),
  });
}

export function usePendingProposals() {
  return useQuery({
    queryKey: ["proposals"],
    queryFn: () => api.get<Proposal[]>("/proposals"),
  });
}

export function useResolveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: "approved" | "rejected" }) =>
      api.post(`/proposals/${id}/resolve`, { resolution }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["plan"] });
      qc.invalidateQueries({ queryKey: ["metrics"] });
    },
  });
}

export function useCurrentPlan() {
  return useQuery({
    queryKey: ["plan", "current"],
    queryFn: () => api.get<{ plan: unknown; goals: unknown[] }>("/plan/current"),
  });
}

// ─── Coach ────────────────────────────────────────────────────────────────────

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  content: { type: string; text?: string }[];
}

export function useCoachChat() {
  return useMutation({
    mutationFn: async (messages: CoachMessage[]) => {
      const res = await api.post<AnthropicResponse>("/coach/chat", { messages });
      const text = res.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
      return text || "(no response)";
    },
  });
}
