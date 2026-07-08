import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SportType, AdaptationDiff } from "@smart-trainer/core";
import { ProposalDiff } from "../components/plan/ProposalDiff.tsx";
import type { Goal } from "../lib/hooks.ts";
import {
  useSkeleton,
  useSaveSkeleton,
  usePendingProposals,
  useResolveProposal,
  useCurrentPlan,
  useCreatePlan,
  useFillWeek,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useFeasibility,
} from "../lib/hooks.ts";

/** Next Monday in YYYY-MM-DD (sensible default plan start). */
function nextMonday(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const add = ((8 - day) % 7) || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GOAL_KINDS: Goal["kind"][] = ["event", "grade", "process", "metric"];

const SPORTS: { value: SportType | null; label: string; color: string }[] = [
  { value: null, label: "Rest", color: "text-muted" },
  { value: "run", label: "Run", color: "text-blue-400" },
  { value: "climb", label: "Climb", color: "text-green-400" },
  { value: "strength", label: "Strength", color: "text-orange-400" },
  { value: "mobility", label: "Mobility", color: "text-purple-400" },
];

interface SlotDraft {
  day_of_week: number;
  sport: SportType;
  hint: string;
}

export function PlanPage() {
  const navigate = useNavigate();
  const { data: skeleton } = useSkeleton();
  const saveSkeleton = useSaveSkeleton();
  const { data: proposals } = usePendingProposals();
  const resolveProposal = useResolveProposal();
  const { data: planData } = useCurrentPlan();
  const { data: feasibility } = useFeasibility();
  const createPlan = useCreatePlan();
  const fillWeek = useFillWeek();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  const plan = planData?.plan ?? null;
  const goals = planData?.goals ?? [];
  const planWeeks = plan?.phases?.flatMap((ph) => ph.plan_weeks) ?? [];

  const [goalTitle, setGoalTitle] = useState("");
  const [goalKind, setGoalKind] = useState<Goal["kind"]>("event");
  const [goalDate, setGoalDate] = useState("");
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  function submitGoal() {
    const title = goalTitle.trim();
    if (!title) return;
    createGoal.mutate(
      { kind: goalKind, title, target_date: goalDate || null },
      { onSuccess: () => { setGoalTitle(""); setGoalDate(""); } }
    );
  }

  function startEdit(g: Goal) {
    setEditingGoalId(g.id);
    setEditTitle(g.title);
  }

  function saveEdit(id: string) {
    const title = editTitle.trim();
    if (!title) return;
    updateGoal.mutate({ id, title }, { onSuccess: () => setEditingGoalId(null) });
  }

  const [planName, setPlanName] = useState("");
  const [planWeeksCount, setPlanWeeksCount] = useState("8");

  function submitPlan() {
    const name = planName.trim() || "Training plan";
    const n = Math.max(1, parseInt(planWeeksCount || "8", 10));
    createPlan.mutate(
      { name, start_date: nextMonday(), n_weeks: n },
      { onSuccess: () => setPlanName("") }
    );
  }

  // day_of_week → sport (null = rest/empty)
  const [slots, setSlots] = useState<(SportType | null)[]>(Array(7).fill(null));
  const [editing, setEditing] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  // Prefill from the saved active skeleton once it loads.
  useEffect(() => {
    if (!skeleton?.skeleton_slots) return;
    const next: (SportType | null)[] = Array(7).fill(null);
    for (const s of skeleton.skeleton_slots) {
      next[s.day_of_week] = s.sport as SportType;
    }
    setSlots(next);
  }, [skeleton]);

  function pick(day: number, sport: SportType | null) {
    setSlots((s) => s.map((x, i) => (i === day ? sport : x)));
    setEditing(null);
  }

  const slotInputs: SlotDraft[] = slots
    .map((sport, i) => (sport ? { day_of_week: i, sport, hint: "" } : null))
    .filter(Boolean) as SlotDraft[];

  function save() {
    saveSkeleton.mutate(
      { slots: slotInputs.map(({ day_of_week, sport }) => ({ day_of_week, sport })) },
      {
        onSuccess: () => {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold pt-2">Plan</h1>

      {/* Generate-a-plan CTA → intake wizard */}
      <button
        onClick={() => navigate("/setup")}
        className="w-full bg-gradient-to-r from-accent to-accent2 rounded-2xl p-4 text-left active:opacity-90"
      >
        <p className="text-white font-semibold">✨ Generate a plan</p>
        <p className="text-white/80 text-xs mt-0.5">
          Set goals + availability and let the engine periodize it for you
        </p>
      </button>

      {/* G5: event-feasibility banner — only when the dated goal is in doubt */}
      {feasibility && (feasibility.status === "at_risk" || feasibility.status === "infeasible") && (
        <div
          className={`rounded-2xl p-4 border ${
            feasibility.status === "infeasible"
              ? "bg-danger/10 border-danger/40"
              : "bg-orange-500/10 border-orange-500/40"
          }`}
        >
          <p className="text-xs uppercase tracking-wider mb-1 text-muted">
            {feasibility.status === "infeasible" ? "⛔ Event date not feasible" : "⚠️ Event date at risk"}
          </p>
          <p className="text-sm font-medium">
            {feasibility.goal_title} · {feasibility.target_date}
          </p>
          <p className="text-muted text-xs mt-1 leading-relaxed">{feasibility.note}</p>
        </div>
      )}

      {/* Week skeleton editor */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-3">Week skeleton</p>
        <div className="space-y-2">
          {DAYS.map((day, i) => {
            const sport = slots[i] ?? null;
            const info = SPORTS.find((s) => s.value === sport) ?? SPORTS[0];
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm w-8 text-muted">{day}</span>
                <button
                  type="button"
                  onClick={() => setEditing(editing === i ? null : i)}
                  className={`flex-1 text-left px-3 py-2 rounded-lg bg-surface2 text-sm font-medium ${info.color}`}
                >
                  {info.label}
                </button>
              </div>
            );
          })}
        </div>

        {editing !== null && (
          <div className="mt-3 grid grid-cols-5 gap-2">
            {SPORTS.map((s) => (
              <button
                key={String(s.value)}
                type="button"
                onClick={() => pick(editing, s.value)}
                className={`py-2 rounded-lg bg-surface text-sm font-medium ${s.color} active:opacity-70`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {saveSkeleton.isError && (
          <p className="text-danger text-sm mt-3">{(saveSkeleton.error as Error).message}</p>
        )}

        <button
          disabled={saveSkeleton.isPending}
          className={`mt-4 w-full py-3 rounded-xl font-semibold text-white active:opacity-80 disabled:opacity-50 ${
            saved ? "bg-success" : "bg-accent"
          }`}
          onClick={save}
        >
          {saved
            ? "✓ Saved!"
            : saveSkeleton.isPending
              ? "Saving…"
              : `Save skeleton (${slotInputs.length} slots)`}
        </button>
      </div>

      {/* Current plan */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-3">Current plan</p>

        {!plan ? (
          <div className="space-y-3">
            <p className="text-muted text-sm">No active plan. Create one to schedule weeks and fill them from your skeleton.</p>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="Plan name (e.g. Fall trail half)"
              className="w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted"
            />
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted">Weeks</label>
              <input
                type="number"
                min="1"
                max="52"
                value={planWeeksCount}
                onChange={(e) => setPlanWeeksCount(e.target.value)}
                className="w-20 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
              />
              <span className="text-xs text-muted">starts {nextMonday()}</span>
            </div>
            {createPlan.isError && (
              <p className="text-danger text-sm">{(createPlan.error as Error).message}</p>
            )}
            <button
              disabled={createPlan.isPending}
              onClick={submitPlan}
              className="w-full py-3 rounded-xl bg-accent text-white font-semibold disabled:opacity-50 active:opacity-80"
            >
              {createPlan.isPending ? "Creating…" : "Create plan"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{plan.name}</p>
            <p className="text-muted text-xs">
              {planWeeks.length} weeks{plan.start_date ? ` · from ${plan.start_date}` : ""}
            </p>
            <div className="space-y-2 pt-1">
              {planWeeks
                .sort((a, b) => a.week_index - b.week_index)
                .map((w) => {
                  const filling = fillWeek.isPending && fillWeek.variables === w.id;
                  return (
                    <div key={w.id} className="flex items-center gap-3 bg-surface2 rounded-xl px-3 py-2">
                      <span className="text-sm flex-1">
                        Week {w.week_index + 1}
                        {w.start_date ? <span className="text-muted"> · {w.start_date}</span> : null}
                        <span className="text-muted"> · {w.prescribed_sessions.length} sessions</span>
                      </span>
                      <button
                        disabled={filling}
                        onClick={() => fillWeek.mutate(w.id)}
                        className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50 active:opacity-80"
                      >
                        {filling ? "…" : "Fill from skeleton"}
                      </button>
                    </div>
                  );
                })}
            </div>
            {fillWeek.isError && (
              <p className="text-danger text-sm">{(fillWeek.error as Error).message}</p>
            )}
            <p className="text-muted text-xs pt-1">
              "Fill from skeleton" proposes the week's sessions — approve them below.
            </p>
          </div>
        )}
      </div>

      {/* Goals */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-3">Goals</p>

        {goals.length > 0 && (
          <div className="space-y-2 mb-4">
            {goals.map((g) => (
              <div key={g.id} className="bg-surface2 rounded-xl px-3 py-2 space-y-1">
                {editingGoalId === g.id ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(g.id); if (e.key === "Escape") setEditingGoalId(null); }}
                      className="flex-1 bg-surface rounded-lg px-2 py-1 text-sm outline-none"
                    />
                    <button
                      onClick={() => saveEdit(g.id)}
                      disabled={updateGoal.isPending}
                      className="px-3 py-1 rounded-lg bg-accent text-white text-xs font-semibold disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingGoalId(null)} className="px-2 py-1 text-xs text-muted">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.title}</p>
                      <p className="text-muted text-xs">
                        {g.kind}{g.target_date ? ` · ${g.target_date}` : ""}{g.sport ? ` · ${g.sport}` : ""} · priority {g.priority}
                      </p>
                    </div>
                    <button onClick={() => startEdit(g)} className="text-muted text-xs px-2 py-1 rounded-lg hover:bg-surface active:opacity-70">
                      Edit
                    </button>
                    <button
                      onClick={() => deleteGoal.mutate(g.id)}
                      disabled={deleteGoal.isPending && deleteGoal.variables === g.id}
                      className="text-danger text-xs px-2 py-1 rounded-lg hover:bg-surface active:opacity-70 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add goal form */}
        <div className="space-y-2">
          <input
            type="text"
            value={goalTitle}
            onChange={(e) => setGoalTitle(e.target.value)}
            placeholder="Goal title (e.g. Run a sub-4h marathon)"
            className="w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted"
          />
          <div className="flex gap-2">
            <select
              value={goalKind}
              onChange={(e) => setGoalKind(e.target.value as Goal["kind"])}
              className="flex-1 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
            >
              {GOAL_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <input
              type="date"
              value={goalDate}
              onChange={(e) => setGoalDate(e.target.value)}
              className="flex-1 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
            />
          </div>
          {createGoal.isError && (
            <p className="text-danger text-sm">{(createGoal.error as Error).message}</p>
          )}
          <button
            disabled={createGoal.isPending || !goalTitle.trim()}
            onClick={submitGoal}
            className="w-full py-3 rounded-xl bg-accent text-white font-semibold disabled:opacity-50 active:opacity-80"
          >
            {createGoal.isPending ? "Adding…" : "Add goal"}
          </button>
        </div>
      </div>

      {/* Pending proposals */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-3">Pending proposals</p>
        {!proposals || proposals.length === 0 ? (
          <p className="text-muted text-sm">No pending proposals</p>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => {
              const isLoading = resolveProposal.isPending && resolveProposal.variables?.id === p.id;
              return (
                <div key={p.id} className="bg-surface2 rounded-xl p-3 space-y-2">
                  <span className="text-sm font-medium">{p.action_type}</span>
                  {p.diff && (
                    <ProposalDiff diff={p.diff as AdaptationDiff | AdaptationDiff[]} />
                  )}
                  {p.rationale && (
                    <p className="text-muted text-xs leading-relaxed">{p.rationale}</p>
                  )}
                  {resolveProposal.isError && resolveProposal.variables?.id === p.id && (
                    <p className="text-danger text-xs">{(resolveProposal.error as Error).message}</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      disabled={isLoading}
                      onClick={() => resolveProposal.mutate({ id: p.id, resolution: "approved" })}
                      className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50 active:opacity-80"
                    >
                      {isLoading ? "…" : "Approve"}
                    </button>
                    <button
                      disabled={isLoading}
                      onClick={() => resolveProposal.mutate({ id: p.id, resolution: "rejected" })}
                      className="flex-1 py-2 rounded-lg bg-surface text-sm font-semibold border border-border disabled:opacity-50 active:opacity-80"
                    >
                      {isLoading ? "…" : "Reject"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
