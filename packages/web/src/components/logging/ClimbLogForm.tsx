import { useState } from "react";
import { RpeSlider, Field, SubmitButton } from "./shared.tsx";

type Style = "sport" | "boulder" | "tr" | "trad";

interface ClimbEntry {
  grade: string;
  style: Style;
  attempts: number;
  sends: number;
  indoor: boolean;
}

const STYLES: Style[] = ["sport", "boulder", "tr", "trad"];

function ClimbRow({
  climb,
  onChange,
  onRemove,
}: {
  climb: ClimbEntry;
  onChange: (c: ClimbEntry) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-surface2 rounded-xl p-3 space-y-2">
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={climb.grade}
          onChange={(e) => onChange({ ...climb, grade: e.target.value })}
          placeholder="5.11a / V4"
          className="flex-1 bg-surface rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-muted text-lg px-1"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {STYLES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange({ ...climb, style: s })}
            className={`py-1.5 rounded-lg text-xs font-medium capitalize ${
              climb.style === s ? "bg-accent text-white" : "bg-surface text-muted"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex gap-3 items-center">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-muted">Attempts</span>
          <button type="button" onClick={() => onChange({ ...climb, attempts: Math.max(1, climb.attempts - 1) })}
            className="w-8 h-8 rounded-full bg-surface text-lg font-bold flex items-center justify-center">−</button>
          <span className="w-6 text-center text-sm font-semibold">{climb.attempts}</span>
          <button type="button" onClick={() => onChange({ ...climb, attempts: climb.attempts + 1 })}
            className="w-8 h-8 rounded-full bg-surface text-lg font-bold flex items-center justify-center">+</button>
        </div>

        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-muted">Sends</span>
          <button type="button" onClick={() => onChange({ ...climb, sends: Math.max(0, climb.sends - 1) })}
            className="w-8 h-8 rounded-full bg-surface text-lg font-bold flex items-center justify-center">−</button>
          <span className="w-6 text-center text-sm font-semibold">{climb.sends}</span>
          <button type="button" onClick={() => onChange({ ...climb, sends: Math.min(climb.attempts, climb.sends + 1) })}
            className="w-8 h-8 rounded-full bg-surface text-lg font-bold flex items-center justify-center">+</button>
        </div>

        <button
          type="button"
          onClick={() => onChange({ ...climb, indoor: !climb.indoor })}
          className={`px-2 py-1 rounded-lg text-xs font-medium ${climb.indoor ? "bg-blue-900 text-blue-300" : "bg-green-900 text-green-300"}`}
        >
          {climb.indoor ? "Indoor" : "Outdoor"}
        </button>
      </div>
    </div>
  );
}

const newClimb = (): ClimbEntry => ({ grade: "", style: "sport", attempts: 1, sends: 1, indoor: true });

export function ClimbLogForm() {
  const [climbs, setClimbs] = useState<ClimbEntry[]>([newClimb()]);
  const [rpe, setRpe] = useState(6);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  function updateClimb(i: number, c: ClimbEntry) {
    setClimbs((cs) => cs.map((x, j) => (j === i ? c : x)));
  }

  function removeClimb(i: number) {
    setClimbs((cs) => cs.filter((_, j) => j !== i));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: POST /logs/climb
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        {climbs.map((c, i) => (
          <ClimbRow key={i} climb={c} onChange={(u) => updateClimb(i, u)} onRemove={() => removeClimb(i)} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setClimbs((cs) => [...cs, newClimb()])}
        className="w-full py-3 rounded-xl border border-dashed border-border text-muted text-sm"
      >
        + Add climb
      </button>

      <RpeSlider value={rpe} onChange={setRpe} />
      <Field label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Worked the crux on the 5.12b…" />
      <SubmitButton saved={saved} label="Log session" />
    </form>
  );
}
