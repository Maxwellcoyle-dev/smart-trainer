import { useState } from "react";
import { Field, SubmitButton, DateSelector, localDateStr, occurredAtFrom } from "./shared.tsx";
import { useLogStrength } from "../../lib/hooks.ts";

interface SetEntry {
  exercise: string;
  reps: number;
  weight_kg: number | null;
  rpe: number | null;
}

const QUICK_EXERCISES = ["Pull-up", "Dead hang", "Push-up", "Ring row", "Shoulder press", "Single-leg squat", "Hip hinge", "Calf raise"];

function SetRow({
  set,
  onChange,
  onRemove,
}: {
  set: SetEntry;
  onChange: (s: SetEntry) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-surface2 rounded-xl p-3 space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={set.exercise}
          onChange={(e) => onChange({ ...set, exercise: e.target.value })}
          placeholder="Exercise"
          list="exercises"
          className="flex-1 bg-surface rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted"
        />
        <button type="button" onClick={onRemove} className="text-muted text-lg px-1">×</button>
      </div>
      <datalist id="exercises">
        {QUICK_EXERCISES.map((e) => <option key={e} value={e} />)}
      </datalist>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs text-muted">Reps</label>
          <div className="flex items-center gap-1 mt-1">
            <button type="button" onClick={() => onChange({ ...set, reps: Math.max(1, set.reps - 1) })}
              className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center">−</button>
            <span className="w-8 text-center font-semibold">{set.reps}</span>
            <button type="button" onClick={() => onChange({ ...set, reps: set.reps + 1 })}
              className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center">+</button>
          </div>
        </div>

        <div className="flex-1">
          <label className="text-xs text-muted">Weight (kg)</label>
          <input
            type="number"
            inputMode="decimal"
            value={set.weight_kg ?? ""}
            onChange={(e) => onChange({ ...set, weight_kg: e.target.value ? parseFloat(e.target.value) : null })}
            placeholder="BW"
            className="mt-1 w-full bg-surface rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-muted"
          />
        </div>

        <div className="flex-1">
          <label className="text-xs text-muted">RPE</label>
          <input
            type="number"
            min="1"
            max="10"
            value={set.rpe ?? ""}
            onChange={(e) => onChange({ ...set, rpe: e.target.value ? parseInt(e.target.value) : null })}
            placeholder="—"
            className="mt-1 w-full bg-surface rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-muted"
          />
        </div>
      </div>
    </div>
  );
}

const newSet = (): SetEntry => ({ exercise: "", reps: 10, weight_kg: null, rpe: null });

export function StrengthLogForm() {
  const logStrength = useLogStrength();
  const [date, setDate] = useState(localDateStr());
  const [sets, setSets] = useState<SetEntry[]>([newSet()]);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  function update(i: number, s: SetEntry) {
    setSets((ss) => ss.map((x, j) => (j === i ? s : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = sets.filter((s) => s.exercise.trim());
    if (valid.length === 0) return;
    logStrength.mutate(
      {
        occurred_at: occurredAtFrom(date),
        notes: notes.trim() || null,
        sets: valid.map((s, i) => ({
          exercise_name: s.exercise.trim(),
          set_index: i,
          reps: s.reps,
          weight_kg: s.weight_kg,
          rpe: s.rpe,
        })),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setSets([newSet()]);
          setNotes("");
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DateSelector value={date} onChange={setDate} />

      <div className="space-y-2">
        {sets.map((s, i) => (
          <SetRow key={i} set={s} onChange={(u) => update(i, u)} onRemove={() => setSets((ss) => ss.filter((_, j) => j !== i))} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setSets((ss) => [...ss, newSet()])}
        className="w-full py-3 rounded-xl border border-dashed border-border text-muted text-sm"
      >
        + Add set
      </button>

      <Field label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Focused on slow eccentrics…" />
      <SubmitButton
        saved={saved}
        label="Log session"
        pending={logStrength.isPending}
        error={logStrength.isError ? (logStrength.error as Error).message : null}
      />
    </form>
  );
}
