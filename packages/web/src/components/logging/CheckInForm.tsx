import { useState } from "react";
import { Field, NumField, SubmitButton } from "./shared.tsx";
import type { BodyPart } from "@smart-trainer/core";

// Watchlist body parts shown by default; can expand later
const WATCH_PARTS: BodyPart[] = ["calf", "achilles", "knee", "shoulder", "elbow", "finger", "hip", "ankle"];

function SorenessRow({
  part,
  value,
  onChange,
}: {
  part: BodyPart;
  value: number;
  onChange: (v: number) => void;
}) {
  const color = (v: number) => {
    if (v === 0) return "bg-success text-white";
    if (v <= 3) return "bg-yellow-600 text-white";
    if (v <= 6) return "bg-orange-600 text-white";
    return "bg-danger text-white";
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm capitalize w-20 flex-shrink-0">{part}</span>
      <div className="flex gap-1 flex-1">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 h-7 rounded text-xs font-semibold transition-colors ${
              value === v ? color(v) : "bg-surface2 text-muted"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

const EMOJI_SCALE = ["", "😫", "😕", "😐", "🙂", "😄"];

export function CheckInForm() {
  const [sleep, setSleep] = useState("");
  const [sleepQuality, setSleepQuality] = useState(3);
  const [weight, setWeight] = useState("");
  const [mood, setMood] = useState(3);
  const [readiness, setReadiness] = useState(5);
  const [soreness, setSoreness] = useState<Record<BodyPart, number>>(
    Object.fromEntries(WATCH_PARTS.map((p) => [p, 0])) as Record<BodyPart, number>
  );
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: POST /logs/checkin with soreness as array of { body_part, severity }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Sleep (hours)" value={sleep} onChange={setSleep} placeholder="7.5" min="0" max="24" step="0.5" />
        <NumField label="Weight (kg)" value={weight} onChange={setWeight} placeholder="70" step="0.1" />
      </div>

      <div>
        <label className="block text-xs text-muted mb-2 uppercase tracking-wider">Sleep quality</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((v) => (
            <button key={v} type="button" onClick={() => setSleepQuality(v)}
              className={`flex-1 py-2 rounded-xl text-xl transition-opacity ${sleepQuality === v ? "opacity-100" : "opacity-30"}`}>
              {EMOJI_SCALE[v]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-2 uppercase tracking-wider">Mood</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((v) => (
            <button key={v} type="button" onClick={() => setMood(v)}
              className={`flex-1 py-2 rounded-xl text-xl transition-opacity ${mood === v ? "opacity-100" : "opacity-30"}`}>
              {EMOJI_SCALE[v]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1 uppercase tracking-wider">
          Readiness <span className="text-text font-semibold">{readiness}</span>/10
        </label>
        <input type="range" min={1} max={10} value={readiness}
          onChange={(e) => setReadiness(parseInt(e.target.value))}
          className="w-full accent-accent" />
        <div className="flex justify-between text-xs text-muted mt-0.5">
          <span>Wrecked</span><span>Fresh</span>
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-2 uppercase tracking-wider">
          Soreness (0 = none, 10 = severe)
        </label>
        <div className="space-y-2">
          {WATCH_PARTS.map((part) => (
            <SorenessRow key={part} part={part} value={soreness[part] ?? 0}
              onChange={(v) => setSoreness((s) => ({ ...s, [part]: v }))} />
          ))}
        </div>
      </div>

      <Field label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Knee felt a bit stiff on the stairs…" />
      <SubmitButton saved={saved} label="Log check-in" />
    </form>
  );
}
