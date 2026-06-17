import { useState } from "react";
import { RpeSlider, Field, SubmitButton } from "./shared.tsx";
import type { ClimbStyle, ClimbEnvironment } from "@smart-trainer/core";

interface ClimbEntry {
  grade_label: string;
  style: ClimbStyle;
  environment: ClimbEnvironment;
  attempts: number;
  sends: number;
  route_name: string;
}

const STYLES: ClimbStyle[] = ["sport", "boulder", "top_rope", "trad"];
const STYLE_LABELS: Record<ClimbStyle, string> = {
  sport: "Sport", boulder: "Boulder", top_rope: "Top rope", trad: "Trad", auto: "Auto",
};

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
          value={climb.grade_label}
          onChange={(e) => onChange({ ...climb, grade_label: e.target.value })}
          placeholder="5.11a / V4 / 7a"
          className="flex-1 bg-surface rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted"
        />
        <button type="button" onClick={onRemove} className="text-muted text-xl px-1 leading-none">×</button>
      </div>

      {/* Style */}
      <div className="flex gap-1">
        {STYLES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange({ ...climb, style: s })}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              climb.style === s ? "bg-accent text-white" : "bg-surface text-muted"
            }`}
          >
            {STYLE_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Environment + attempts/sends */}
      <div className="flex gap-3 items-center">
        <button
          type="button"
          onClick={() => onChange({ ...climb, environment: climb.environment === "indoor" ? "outdoor" : "indoor" })}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 ${
            climb.environment === "indoor" ? "bg-blue-900 text-blue-300" : "bg-green-900 text-green-300"
          }`}
        >
          {climb.environment === "indoor" ? "Indoor" : "Outdoor"}
        </button>

        <div className="flex items-center gap-1 flex-1">
          <span className="text-xs text-muted">Att</span>
          <button type="button" onClick={() => onChange({ ...climb, attempts: Math.max(1, climb.attempts - 1) })}
            className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center">−</button>
          <span className="w-5 text-center text-sm font-semibold">{climb.attempts}</span>
          <button type="button" onClick={() => onChange({ ...climb, attempts: climb.attempts + 1 })}
            className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center">+</button>
        </div>

        <div className="flex items-center gap-1 flex-1">
          <span className="text-xs text-muted">Sends</span>
          <button type="button"
            onClick={() => onChange({ ...climb, sends: Math.max(0, climb.sends - 1) })}
            className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center">−</button>
          <span className="w-5 text-center text-sm font-semibold">{climb.sends}</span>
          <button type="button"
            onClick={() => onChange({ ...climb, sends: Math.min(climb.attempts, climb.sends + 1) })}
            className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center">+</button>
        </div>
      </div>

      <input
        type="text"
        value={climb.route_name}
        onChange={(e) => onChange({ ...climb, route_name: e.target.value })}
        placeholder="Route name (optional)"
        className="w-full bg-surface rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-muted"
      />
    </div>
  );
}

const newClimb = (): ClimbEntry => ({
  grade_label: "", style: "sport", environment: "indoor", attempts: 1, sends: 1, route_name: "",
});

export function ClimbLogForm() {
  const [climbs, setClimbs] = useState<ClimbEntry[]>([newClimb()]);
  const [rpe, setRpe] = useState(6);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  function updateClimb(i: number, c: ClimbEntry) {
    setClimbs((cs) => cs.map((x, j) => (j === i ? c : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: POST /logs/climb
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        {climbs.map((c, i) => (
          <ClimbRow key={i} climb={c} onChange={(u) => updateClimb(i, u)} onRemove={() => setClimbs((cs) => cs.filter((_, j) => j !== i))} />
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
