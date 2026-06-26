import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api.ts";
import {
  useCurrentPlan,
  useCreateGoal,
  useProfile,
  useSetAvailability,
  useGeneratePlan,
  useInjuryFlags,
  type Availability,
  type Goal,
} from "../lib/hooks.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STEPS = ["Goals", "Availability", "Injuries", "Review"] as const;

const GOAL_KINDS: Goal["kind"][] = ["event", "grade", "process", "metric"];
const SPORTS = ["run", "climb", "strength", "mobility", "cross_train"] as const;
const PER_SPORT = ["run", "climb", "strength"] as const;

const METRICS = ["distance", "grade", "pace", "duration", "adherence"] as const;
type Metric = (typeof METRICS)[number];

const DEFAULT_AVAILABILITY: Availability = {
  days_per_week: 5,
  hours_per_day: 1.5,
  blackout_dow: [],
  per_sport: {
    run: { max_days: 3, min_rest_days_between: 2 },
    climb: { max_days: 2, min_rest_days_between: 1, allow_back_to_back: true },
    strength: { max_days: 2, min_rest_days_between: 0 },
  },
  notes: "",
};

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((label, i) => (
        <div key={label} className="flex-1">
          <div
            className={`h-1.5 rounded-full ${i <= step ? "bg-accent" : "bg-surface2"}`}
          />
          <p
            className={`text-[10px] mt-1 uppercase tracking-wider ${
              i === step ? "text-accent" : "text-muted"
            }`}
          >
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1 uppercase tracking-wider">
        {label} <span className="text-text font-semibold normal-case">{value}{suffix}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const { data: planData } = useCurrentPlan();
  const { data: profile } = useProfile();
  const { data: flags } = useInjuryFlags();
  const createGoal = useCreateGoal();
  const setAvailability = useSetAvailability();
  const generate = useGeneratePlan();

  const goals = planData?.goals ?? [];

  // ── Goal draft ──
  const [gTitle, setGTitle] = useState("");
  const [gKind, setGKind] = useState<Goal["kind"]>("event");
  const [gSport, setGSport] = useState<string>("run");
  const [gDate, setGDate] = useState("");
  const [gPriority, setGPriority] = useState("1");
  const [gMetric, setGMetric] = useState<Metric>("distance");
  const [gValue, setGValue] = useState("");
  const [gUnit, setGUnit] = useState("");

  function addGoal() {
    const title = gTitle.trim();
    if (!title) return;
    const valueNum = Number(gValue);
    const target: Record<string, unknown> = {
      metric: gMetric,
      value: gValue.trim() && !Number.isNaN(valueNum) ? valueNum : gValue.trim(),
      ...(gUnit.trim() ? { unit: gUnit.trim() } : {}),
      ...(gDate ? { by_date: gDate } : {}),
    };
    createGoal.mutate(
      {
        kind: gKind,
        title,
        sport: gSport,
        target_date: gDate || null,
        priority: Number(gPriority) || 1,
        target,
      },
      {
        onSuccess: () => {
          setGTitle("");
          setGValue("");
          setGUnit("");
          setGDate("");
        },
      }
    );
  }

  // ── Availability draft ──
  const [avail, setAvail] = useState<Availability>(DEFAULT_AVAILABILITY);

  // Prefill from saved profile availability once it loads (if non-empty).
  useEffect(() => {
    const a = profile?.availability as Availability | undefined;
    if (a && typeof a.days_per_week === "number") {
      setAvail({ ...DEFAULT_AVAILABILITY, ...a, per_sport: { ...DEFAULT_AVAILABILITY.per_sport, ...a.per_sport } });
    }
  }, [profile]);

  function setSport(sport: string, patch: Partial<Availability["per_sport"][string]>) {
    setAvail((a) => ({
      ...a,
      per_sport: { ...a.per_sport, [sport]: { ...a.per_sport[sport], ...patch } },
    }));
  }

  function toggleBlackout(dow: number) {
    setAvail((a) => ({
      ...a,
      blackout_dow: a.blackout_dow.includes(dow)
        ? a.blackout_dow.filter((d) => d !== dow)
        : [...a.blackout_dow, dow].sort((x, y) => x - y),
    }));
  }

  function saveAvailabilityThen(next: () => void) {
    setAvailability.mutate(avail, { onSuccess: next });
  }

  // ── Injuries (read-only, from existing flags) ──
  const activeFlags = useMemo(
    () => (flags ?? []).filter((f) => f.status !== "resolved"),
    [flags]
  );
  const watchList = profile?.watch_list ?? [];

  // ── Navigation ──
  function next() {
    if (step === 1) {
      saveAvailabilityThen(() => setStep(2));
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function back() {
    if (step === 0) navigate("/plan");
    else setStep((s) => s - 1);
  }

  const generateNotReady =
    generate.isError && generate.error instanceof ApiError &&
    [404, 405, 501].includes((generate.error as ApiError).status);

  function doGenerate() {
    saveAvailabilityThen(() =>
      generate.mutate(
        {},
        {
          onSuccess: () => navigate("/plan"),
        }
      )
    );
  }

  return (
    <div className="p-4 space-y-5 max-w-xl mx-auto">
      <div className="pt-2 space-y-3">
        <h1 className="text-2xl font-bold">Build your plan</h1>
        <Stepper step={step} />
      </div>

      {/* ── Step 0: Goals ── */}
      {step === 0 && (
        <div className="space-y-4">
          <p className="text-muted text-sm">
            What are you training for? Add a goal with a timeline and a performance
            target — the engine builds phases backward from your most important dated goal.
          </p>

          {goals.length > 0 && (
            <div className="space-y-2">
              {goals.map((g) => (
                <div key={g.id} className="bg-surface2 rounded-xl px-3 py-2">
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-muted text-xs">
                    {g.kind}
                    {g.target_date ? ` · ${g.target_date}` : ""}
                    {g.sport ? ` · ${g.sport}` : ""} · priority {g.priority}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="bg-surface rounded-2xl p-4 space-y-3">
            <input
              type="text"
              value={gTitle}
              onChange={(e) => setGTitle(e.target.value)}
              placeholder="Goal (e.g. Trail half-marathon)"
              className="w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted"
            />
            <div className="flex gap-2">
              <select
                value={gKind}
                onChange={(e) => setGKind(e.target.value as Goal["kind"])}
                className="flex-1 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
              >
                {GOAL_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <select
                value={gSport}
                onChange={(e) => setGSport(e.target.value)}
                className="flex-1 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
              >
                {SPORTS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] text-muted mb-1 uppercase tracking-wider">By date</label>
                <input
                  type="date"
                  value={gDate}
                  onChange={(e) => setGDate(e.target.value)}
                  className="w-full bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
                />
              </div>
              <div className="w-24">
                <label className="block text-[10px] text-muted mb-1 uppercase tracking-wider">Priority</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={gPriority}
                  onChange={(e) => setGPriority(e.target.value)}
                  className="w-full bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-muted mb-1 uppercase tracking-wider">Performance target</label>
              <div className="flex gap-2">
                <select
                  value={gMetric}
                  onChange={(e) => setGMetric(e.target.value as Metric)}
                  className="flex-1 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
                >
                  {METRICS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={gValue}
                  onChange={(e) => setGValue(e.target.value)}
                  placeholder="value (e.g. 21097 or 5.12a)"
                  className="flex-1 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none placeholder:text-muted"
                />
                <input
                  type="text"
                  value={gUnit}
                  onChange={(e) => setGUnit(e.target.value)}
                  placeholder="unit"
                  className="w-20 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none placeholder:text-muted"
                />
              </div>
            </div>

            {createGoal.isError && (
              <p className="text-danger text-sm">{(createGoal.error as Error).message}</p>
            )}
            <button
              disabled={createGoal.isPending || !gTitle.trim()}
              onClick={addGoal}
              className="w-full py-3 rounded-xl bg-surface2 border border-border text-sm font-semibold disabled:opacity-50 active:opacity-80"
            >
              {createGoal.isPending ? "Adding…" : "+ Add goal"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 1: Availability ── */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-muted text-sm">
            How much can you realistically train? This becomes a fixed input to the
            plan — editing it later won't silently rewrite an active plan.
          </p>

          <div className="bg-surface rounded-2xl p-4 space-y-4">
            <Slider label="Days per week" value={avail.days_per_week} min={1} max={7} onChange={(v) => setAvail((a) => ({ ...a, days_per_week: v }))} />
            <Slider label="Hours per day" value={avail.hours_per_day} min={0.5} max={4} step={0.5} suffix="h" onChange={(v) => setAvail((a) => ({ ...a, hours_per_day: v }))} />

            <div>
              <p className="text-xs text-muted mb-2 uppercase tracking-wider">Never available</p>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleBlackout(i)}
                    className={`py-2 rounded-lg text-xs font-medium ${
                      avail.blackout_dow.includes(i)
                        ? "bg-danger/20 text-danger"
                        : "bg-surface2 text-muted"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {PER_SPORT.map((sport) => {
            const cfg = avail.per_sport[sport] ?? { max_days: 0, min_rest_days_between: 0 };
            return (
              <div key={sport} className="bg-surface rounded-2xl p-4 space-y-3">
                <p className="text-sm font-semibold capitalize">{sport}</p>
                <Slider label="Max days / week" value={cfg.max_days} min={0} max={7} onChange={(v) => setSport(sport, { max_days: v })} />
                <Slider label="Min rest days between" value={cfg.min_rest_days_between} min={0} max={4} onChange={(v) => setSport(sport, { min_rest_days_between: v })} />
                {sport === "climb" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!cfg.allow_back_to_back}
                      onChange={(e) => setSport(sport, { allow_back_to_back: e.target.checked })}
                      className="accent-accent w-4 h-4"
                    />
                    Allow back-to-back days
                  </label>
                )}
              </div>
            );
          })}

          <div className="bg-surface rounded-2xl p-4">
            <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Notes</label>
            <textarea
              value={avail.notes ?? ""}
              onChange={(e) => setAvail((a) => ({ ...a, notes: e.target.value }))}
              rows={2}
              placeholder="e.g. weekend lead-climbing trips; cross-training OK on run-rest days"
              className="w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none resize-none placeholder:text-muted"
            />
          </div>

          {setAvailability.isError && (
            <p className="text-danger text-sm">{(setAvailability.error as Error).message}</p>
          )}
        </div>
      )}

      {/* ── Step 2: Injuries ── */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-muted text-sm">
            These are already tracked. The plan caps load and weaves in prehab around
            them automatically — nothing to do here unless something's missing.
          </p>

          <div className="bg-surface rounded-2xl p-4 space-y-3">
            <p className="text-xs text-muted uppercase tracking-wider">Active flags</p>
            {activeFlags.length === 0 ? (
              <p className="text-muted text-sm">No active injury flags. 🎉</p>
            ) : (
              <div className="space-y-2">
                {activeFlags.map((f) => (
                  <div key={f.id} className="bg-surface2 rounded-xl px-3 py-2">
                    <p className="text-sm font-medium capitalize">
                      {f.body_part}{f.side && f.side !== "n/a" ? ` (${f.side})` : ""}
                      <span className="text-muted font-normal"> · {f.status}</span>
                    </p>
                    {f.narrative && <p className="text-muted text-xs">{f.narrative}</p>}
                  </div>
                ))}
              </div>
            )}

            {watchList.length > 0 && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wider mb-1">Watch list</p>
                <p className="text-sm">{watchList.join(", ")}</p>
              </div>
            )}

            {profile?.injury_history && (
              <div>
                <p className="text-xs text-muted uppercase tracking-wider mb-1">History</p>
                <p className="text-sm text-muted leading-relaxed">{profile.injury_history}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 3: Review ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-surface rounded-2xl p-4 space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Goals</p>
              {goals.length === 0 ? (
                <p className="text-muted">No goals yet — add at least one for a meaningful plan.</p>
              ) : (
                <ul className="space-y-1">
                  {goals.map((g) => (
                    <li key={g.id}>
                      {g.title}
                      <span className="text-muted">
                        {g.target_date ? ` · ${g.target_date}` : ""} · priority {g.priority}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Availability</p>
              <p className="text-muted">
                {avail.days_per_week} days/wk · {avail.hours_per_day}h/day ·{" "}
                {PER_SPORT.map((s) => `${s} ${avail.per_sport[s]?.max_days ?? 0}×`).join(" · ")}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Injuries</p>
              <p className="text-muted">
                {activeFlags.length} active flag{activeFlags.length === 1 ? "" : "s"}
                {watchList.length ? ` · watching ${watchList.join(", ")}` : ""}
              </p>
            </div>
          </div>

          <p className="text-muted text-xs leading-relaxed">
            Generating builds a full periodized plan and lands it as a single proposal
            you can review and approve — nothing is applied until you say so.
          </p>

          {generateNotReady ? (
            <p className="text-warning text-sm bg-surface2 rounded-xl px-3 py-2">
              Your goals and availability are saved, but this server build doesn't have
              the plan-generation endpoint yet. Try again once the latest server is deployed.
            </p>
          ) : generate.isError ? (
            <p className="text-danger text-sm">{(generate.error as Error).message}</p>
          ) : null}

          <button
            disabled={generate.isPending || setAvailability.isPending}
            onClick={doGenerate}
            className="w-full py-4 rounded-2xl bg-accent text-white font-semibold disabled:opacity-50 active:opacity-80"
          >
            {generate.isPending ? "Generating…" : "✨ Generate my plan"}
          </button>
        </div>
      )}

      {/* ── Footer nav ── */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={back}
          className="px-5 py-3 rounded-xl bg-surface2 text-sm font-semibold active:opacity-80"
        >
          {step === 0 ? "Cancel" : "Back"}
        </button>
        {step < STEPS.length - 1 && (
          <button
            onClick={next}
            disabled={setAvailability.isPending}
            className="flex-1 py-3 rounded-xl bg-accent text-white font-semibold disabled:opacity-50 active:opacity-80"
          >
            {step === 1 && setAvailability.isPending ? "Saving…" : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}
