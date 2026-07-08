import { useState } from "react";
import {
  useSessionHistory,
  useUpdateSession,
  useDeleteSession,
  type HistorySession,
  type HistoryClimb,
  type UpdateSessionPayload,
} from "../../lib/hooks.ts";
import { RpeSlider, Field, localDateStr } from "../logging/shared.tsx";
import { gradesForDiscipline } from "../../lib/grades.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SPORT_LABEL: Record<string, string> = {
  run: "Run", climb: "Climb", strength: "Strength",
  mobility: "Mobility", cross_train: "Cross",
};

const SPORT_COLOR: Record<string, string> = {
  run: "bg-green-900 text-green-200",
  climb: "bg-blue-900 text-blue-200",
  strength: "bg-purple-900 text-purple-200",
  mobility: "bg-surface2 text-muted",
  cross_train: "bg-surface2 text-muted",
};

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Keep the original timestamp when the date is unchanged; midday local otherwise. */
function occurredAtForEdit(newDate: string, originalIso: string): string {
  if (newDate === toLocalDate(originalIso)) return originalIso;
  const [y, m, d] = newDate.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

function fmtPace(distanceM: number, durationS: number | null): string | null {
  if (!durationS || !distanceM) return null;
  const s = durationS / (distanceM / 1000);
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}/km`;
}

function summary(s: HistorySession): string {
  if (s.sport === "run" && s.run_details) {
    const km = (s.run_details.distance_m / 1000).toFixed(1);
    const pace = fmtPace(s.run_details.distance_m, s.duration_s);
    return `${km} km${pace ? ` · ${pace}` : ""}`;
  }
  if (s.sport === "climb") {
    const climbs = (s.climbs ?? []).filter((c) => !("deleted_at" in c) || (c as { deleted_at?: string | null }).deleted_at == null);
    if (climbs.length === 0) return "No climbs";
    const sent = climbs.filter((c) => c.sends > 0 && c.grade_value != null);
    const top = (sent.length > 0 ? sent : climbs)
      .reduce((a, b) => ((b.grade_value ?? -1) > (a.grade_value ?? -1) ? b : a));
    return `${climbs.length} climb${climbs.length === 1 ? "" : "s"}${top.grade_label ? ` · top ${top.grade_label}` : ""}`;
  }
  if (s.sport === "strength") {
    const n = (s.strength_sets ?? []).filter((x) => !("deleted_at" in x) || (x as { deleted_at?: string | null }).deleted_at == null).length;
    return `${n} set${n === 1 ? "" : "s"}`;
  }
  return "";
}

const RESULTS = ["onsight", "flash", "redpoint", "hung", "dnf"] as const;

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({ session, onDone }: { session: HistorySession; onDone: () => void }) {
  const update = useUpdateSession();
  const [date, setDate] = useState(toLocalDate(session.occurred_at));
  const [rpe, setRpe] = useState(session.session_rpe ?? 6);
  const [location, setLocation] = useState(session.location ?? "");
  const [notes, setNotes] = useState(session.notes ?? "");

  // Run fields
  const rd = session.run_details;
  const [distanceKm, setDistanceKm] = useState(rd ? (rd.distance_m / 1000).toString() : "");
  const [durationMin, setDurationMin] = useState(
    session.duration_s != null ? (session.duration_s / 60).toFixed(0) : ""
  );
  const [elevGain, setElevGain] = useState(rd?.elevation_gain_m?.toString() ?? "");

  // Climb fields — live edit of the full list (replace semantics on save)
  const liveClimbs = (session.climbs ?? [])
    .filter((c) => (c as { deleted_at?: string | null }).deleted_at == null)
    .sort((a, b) => a.order_in_session - b.order_in_session);
  const [climbs, setClimbs] = useState<HistoryClimb[]>(liveClimbs);

  // Strength fields
  const liveSets = (session.strength_sets ?? [])
    .filter((x) => (x as { deleted_at?: string | null }).deleted_at == null)
    .sort((a, b) => a.set_index - b.set_index);
  const [sets, setSets] = useState(liveSets);

  function save() {
    const payload: UpdateSessionPayload & { id: string } = {
      id: session.id,
      occurred_at: occurredAtForEdit(date, session.occurred_at),
      session_rpe: rpe,
      location: location.trim() || null,
      notes: notes.trim() || null,
    };
    if (session.sport === "run" && rd) {
      payload.run = {
        distance_m: Math.round(parseFloat(distanceKm || "0") * 1000) || rd.distance_m,
        surface: rd.surface,
        elevation_gain_m: elevGain ? Math.round(parseFloat(elevGain)) : null,
      };
      const min = parseFloat(durationMin);
      if (min > 0) payload.duration_s = Math.round(min * 60);
    }
    if (session.sport === "climb") {
      payload.climbs = climbs
        .filter((c) => (c.grade_label ?? "").trim())
        .map((c, i) => ({
          grade_label: c.grade_label!.trim(),
          grade_value: c.grade_value,
          grade_id: c.grade_id,
          style: c.style,
          environment: c.environment,
          attempts: c.attempts,
          sends: c.sends,
          route_name: c.route_name,
          crag: c.crag,
          order_in_session: i,
          angle: c.angle,
          character_tags: c.character_tags ?? [],
          length_ft: c.length_ft,
          effort: c.effort,
          result: c.result,
          climb_notes: c.climb_notes,
          wall: c.wall,
        }));
    }
    if (session.sport === "strength") {
      payload.sets = sets
        .filter((x) => (x.exercise_name ?? "").trim())
        .map((x, i) => ({
          exercise_id: x.exercise_id,
          exercise_name: x.exercise_name!.trim(),
          set_index: i,
          reps: x.reps,
          weight_kg: x.weight_kg,
          rpe: x.rpe,
        }));
    }
    update.mutate(payload, { onSuccess: onDone });
  }

  function updClimb(i: number, patch: Partial<HistoryClimb>) {
    setClimbs((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-3 pt-3 border-t border-border mt-3">
      <div>
        <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Date</label>
        <input
          type="date"
          value={date}
          max={localDateStr()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="w-full bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
        />
      </div>

      {session.sport === "run" && rd && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Distance (km)", value: distanceKm, set: setDistanceKm, step: "0.1" },
            { label: "Duration (min)", value: durationMin, set: setDurationMin, step: "1" },
            { label: "Elev gain (m)", value: elevGain, set: setElevGain, step: "1" },
          ].map((f) => (
            <div key={f.label}>
              <label className="block text-[10px] text-muted mb-1 uppercase tracking-wider">{f.label}</label>
              <input
                type="number"
                inputMode="decimal"
                value={f.value}
                step={f.step}
                min="0"
                onChange={(e) => f.set(e.target.value)}
                className="w-full bg-surface2 rounded-xl px-3 py-2 text-sm outline-none"
              />
            </div>
          ))}
        </div>
      )}

      {session.sport === "climb" && (
        <div className="space-y-2">
          <p className="text-xs text-muted uppercase tracking-wider">Climbs</p>
          {climbs.map((c, i) => {
            const discipline = c.style === "boulder" ? "boulder" : "rope";
            const opts = gradesForDiscipline(discipline);
            return (
              <div key={c.id ?? i} className="bg-surface2 rounded-xl p-2 space-y-2">
                <div className="flex gap-2 items-center">
                  <select
                    value={c.grade_label ?? ""}
                    onChange={(e) => {
                      const g = opts.find((x) => x.label === e.target.value);
                      updClimb(i, {
                        grade_label: g?.label ?? "",
                        grade_value: g?.grade_value ?? null,
                        grade_id: null,
                      });
                    }}
                    className="flex-1 bg-surface rounded-lg px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="">Grade…</option>
                    {opts.map((g) => (
                      <option key={g.label} value={g.label}>{g.label}</option>
                    ))}
                  </select>
                  <select
                    value={c.result ?? ""}
                    onChange={(e) =>
                      updClimb(i, { result: (e.target.value || null) as HistoryClimb["result"] })
                    }
                    className="bg-surface rounded-lg px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="">Result…</option>
                    {RESULTS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setClimbs((cs) => cs.filter((_, j) => j !== i))}
                    className="text-muted text-xl px-1 leading-none"
                  >
                    ×
                  </button>
                </div>
                <div className="flex gap-4 text-sm items-center">
                  {([["Att", "attempts", 1], ["Sends", "sends", 0]] as const).map(([lbl, key, min]) => (
                    <div key={key} className="flex items-center gap-1.5">
                      <span className="text-xs text-muted">{lbl}</span>
                      <button
                        type="button"
                        onClick={() => updClimb(i, { [key]: Math.max(min, c[key] - 1) } as Partial<HistoryClimb>)}
                        className="w-6 h-6 rounded-full bg-surface text-sm font-bold"
                      >
                        −
                      </button>
                      <span className="w-4 text-center font-semibold">{c[key]}</span>
                      <button
                        type="button"
                        onClick={() => updClimb(i, { [key]: key === "sends" ? Math.min(c.attempts, c.sends + 1) : c.attempts + 1 } as Partial<HistoryClimb>)}
                        className="w-6 h-6 rounded-full bg-surface text-sm font-bold"
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {session.sport === "strength" && (
        <div className="space-y-2">
          <p className="text-xs text-muted uppercase tracking-wider">Sets</p>
          {sets.map((x, i) => (
            <div key={x.id ?? i} className="flex gap-2 items-center">
              <input
                type="text"
                value={x.exercise_name ?? ""}
                onChange={(e) =>
                  setSets((ss) => ss.map((y, j) => (j === i ? { ...y, exercise_name: e.target.value } : y)))
                }
                placeholder="Exercise"
                className="flex-1 bg-surface2 rounded-lg px-2 py-1.5 text-sm outline-none"
              />
              <input
                type="number"
                value={x.reps ?? ""}
                onChange={(e) =>
                  setSets((ss) => ss.map((y, j) => (j === i ? { ...y, reps: e.target.value ? parseInt(e.target.value) : null } : y)))
                }
                placeholder="Reps"
                className="w-16 bg-surface2 rounded-lg px-2 py-1.5 text-sm outline-none"
              />
              <input
                type="number"
                step="0.5"
                value={x.weight_kg ?? ""}
                onChange={(e) =>
                  setSets((ss) => ss.map((y, j) => (j === i ? { ...y, weight_kg: e.target.value ? parseFloat(e.target.value) : null } : y)))
                }
                placeholder="kg"
                className="w-18 bg-surface2 rounded-lg px-2 py-1.5 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setSets((ss) => ss.filter((_, j) => j !== i))}
                className="text-muted text-xl px-1 leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <RpeSlider value={rpe} onChange={setRpe} />
      <Field label="Location" value={location} onChange={setLocation} placeholder="—" />
      <Field label="Notes" value={notes} onChange={setNotes} multiline placeholder="—" />

      {update.isError && (
        <p className="text-danger text-sm">{(update.error as Error).message}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDone}
          className="flex-1 py-2.5 rounded-xl bg-surface2 text-muted text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={update.isPending}
          className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Session row ──────────────────────────────────────────────────────────────

function SessionRow({ session }: { session: HistorySession }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const del = useDeleteSession();

  return (
    <div className="bg-surface rounded-2xl p-3">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => { setExpanded((e) => !e); setEditing(false); setConfirmingDelete(false); }}
      >
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${SPORT_COLOR[session.sport] ?? "bg-surface2 text-muted"}`}>
          {SPORT_LABEL[session.sport] ?? session.sport}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{fmtDate(session.occurred_at)}</p>
          <p className="text-xs text-muted truncate">
            {summary(session)}
            {session.location ? ` · ${session.location}` : ""}
          </p>
        </div>
        {session.session_rpe != null && (
          <span className="text-xs text-muted shrink-0">RPE {session.session_rpe}</span>
        )}
        <span className="text-muted text-xs">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && !editing && (
        <div className="pt-3 mt-3 border-t border-border space-y-2">
          {session.sport === "climb" && (session.climbs ?? []).length > 0 && (
            <div className="space-y-1">
              {(session.climbs ?? [])
                .filter((c) => (c as { deleted_at?: string | null }).deleted_at == null)
                .sort((a, b) => a.order_in_session - b.order_in_session)
                .map((c) => (
                  <div key={c.id} className="flex justify-between text-sm">
                    <span>
                      {c.grade_label}
                      {c.route_name ? <span className="text-muted"> — {c.route_name}</span> : null}
                    </span>
                    <span className="text-muted text-xs">
                      {c.sends}/{c.attempts}{c.result ? ` · ${c.result}` : ""}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {session.sport === "strength" && (session.strength_sets ?? []).length > 0 && (
            <div className="space-y-1">
              {(session.strength_sets ?? [])
                .filter((x) => (x as { deleted_at?: string | null }).deleted_at == null)
                .sort((a, b) => a.set_index - b.set_index)
                .map((x) => (
                  <div key={x.id} className="flex justify-between text-sm">
                    <span>{x.exercise_name}</span>
                    <span className="text-muted text-xs">
                      {x.reps ?? "—"} reps{x.weight_kg != null ? ` @ ${x.weight_kg} kg` : ""}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {session.notes && <p className="text-xs text-muted">{session.notes}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex-1 py-2 rounded-xl bg-surface2 text-sm font-medium"
            >
              Edit
            </button>
            {confirmingDelete ? (
              <div className="flex-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => del.mutate(session.id)}
                  disabled={del.isPending}
                  className="flex-1 py-2 rounded-xl bg-danger text-white text-sm font-semibold disabled:opacity-50"
                >
                  {del.isPending ? "Deleting…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="flex-1 py-2 rounded-xl bg-surface2 text-muted text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex-1 py-2 rounded-xl bg-surface2 text-danger text-sm font-medium"
              >
                Delete
              </button>
            )}
          </div>
          {del.isError && (
            <p className="text-danger text-xs">{(del.error as Error).message}</p>
          )}
        </div>
      )}

      {expanded && editing && <EditForm session={session} onDone={() => setEditing(false)} />}
    </div>
  );
}

// ─── History list ─────────────────────────────────────────────────────────────

type SportFilter = "all" | "run" | "climb" | "strength";

export function SessionHistory() {
  const [sport, setSport] = useState<SportFilter>("all");
  const { data, isLoading } = useSessionHistory(180, sport === "all" ? undefined : sport);
  const sessions = data?.sessions ?? [];

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(["all", "climb", "run", "strength"] as SportFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSport(s)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              sport === s ? "bg-accent text-white" : "bg-surface2 text-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-muted text-sm">Loading…</p>}
      {!isLoading && sessions.length === 0 && (
        <p className="text-muted text-sm">No workouts logged in the last 6 months.</p>
      )}
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} />
      ))}
    </div>
  );
}
