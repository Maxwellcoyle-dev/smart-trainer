import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WeeklyMileage,
  GradePyramidRow,
  SorenessTrendRow,
  AdherenceRow,
  Proposal,
  ClimbProgressionRow,
  ClimbSendRateRow,
  ClimbVolumeRow,
  ClimbByAngleRow,
  ClimbByCharacterRow,
  Grade,
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
  location?: string | null;
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
    angle?: "slab" | "vertical" | "overhang" | "roof" | null;
    character_tags?: ("powerful" | "endurance" | "technical" | "crimpy" | "dynamic")[];
    length_ft?: number | null;
    effort?: number | null;
    result?: "onsight" | "flash" | "redpoint" | "hung" | "dnf" | null;
    climb_notes?: string | null;
    wall?: string | null;
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

export interface ClimbPlaces {
  gyms: string[];
  crags: string[];
  walls: string[];
}

export function useClimbPlaces() {
  return useQuery({
    queryKey: ["logs", "climb-places"],
    queryFn: () => api.get<ClimbPlaces>("/logs/climb/places"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useGrades() {
  return useQuery({
    queryKey: ["logs", "grades"],
    queryFn: () => api.get<Grade[]>("/logs/grades"),
    staleTime: 60 * 60 * 1000, // reference data — rarely changes
  });
}

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

// ─── Climb progress hooks (P24) ───────────────────────────────────────────────

export function useClimbProgression(months = 12, environment?: string) {
  const q = new URLSearchParams({ months: String(months) });
  if (environment) q.set("environment", environment);
  return useQuery({
    queryKey: ["metrics", "climb-progression", months, environment ?? "all"],
    queryFn: () => api.get<ClimbProgressionRow[]>(`/metrics/climb/progression?${q}`),
  });
}

export function useClimbSendRate(months = 12, environment?: string) {
  const q = new URLSearchParams({ months: String(months) });
  if (environment) q.set("environment", environment);
  return useQuery({
    queryKey: ["metrics", "climb-send-rate", months, environment ?? "all"],
    queryFn: () => api.get<ClimbSendRateRow[]>(`/metrics/climb/send-rate?${q}`),
  });
}

export function useClimbVolume(weeks = 16) {
  return useQuery({
    queryKey: ["metrics", "climb-volume", weeks],
    queryFn: () => api.get<ClimbVolumeRow[]>(`/metrics/climb/volume?weeks=${weeks}`),
  });
}

export function useClimbByAngle() {
  return useQuery({
    queryKey: ["metrics", "climb-by-angle"],
    queryFn: () => api.get<ClimbByAngleRow[]>(`/metrics/climb/by-angle`),
  });
}

export function useClimbByCharacter() {
  return useQuery({
    queryKey: ["metrics", "climb-by-character"],
    queryFn: () => api.get<ClimbByCharacterRow[]>(`/metrics/climb/by-character`),
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

export interface PlanWeek {
  id: string;
  week_index: number;
  start_date: string | null;
  prescribed_sessions: { id: string; sport: string; day_of_week: number; status: string }[];
}
export interface Phase {
  id: string;
  name: string;
  type: string;
  plan_weeks: PlanWeek[];
}
export interface CurrentPlan {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  phases: Phase[];
}

export interface Goal {
  id: string;
  kind: "event" | "grade" | "process" | "metric";
  title: string;
  sport: string | null;
  target_date: string | null;
  priority: number;
  status: string;
  notes: string | null;
}

export function useCurrentPlan() {
  return useQuery({
    queryKey: ["plan", "current"],
    queryFn: () => api.get<{ plan: CurrentPlan | null; goals: Goal[] }>("/plan/current"),
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      kind: Goal["kind"];
      title: string;
      sport?: string | null;
      target_date?: string | null;
      priority?: number;
      notes?: string | null;
    }) => api.post<Goal>("/plan/goals", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
  });
}

export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; status?: string; priority?: number; notes?: string | null }) =>
      api.patch<Goal>(`/plan/goals/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Goal>(`/plan/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; start_date: string; n_weeks: number; intent?: string | null }) =>
      api.post("/plan/create", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
  });
}

export function useFillWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planWeekId: string) =>
      api.post("/plan/fill-week", { plan_week_id: planWeekId, mode: "propose" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["plan"] });
    },
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
