import { useState } from "react";
import { Field, NumField, SubmitButton } from "./shared.tsx";
import type { BodyPart } from "@smart-trainer/core";

const BODY_PARTS: BodyPart[] = ["calf", "knee", "shoulder", "hip", "ankle", "back", "elbow", "wrist"];

function SorenessRow({ part, value, onChange }: { part: BodyPart; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm capitalize w-20">{part}</span>
      <div className="flex gap-1 flex-1">
        {[0, 1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 h-8 rounded-lg text-xs font-semibold transition-colors ${
              v === 0
                ? value === 0 ? "bg-success text-white" : "bg-surface2 text-muted"
                : value >= v
                ? v <= 2 ? "bg-yellow-600 text-white" : v <= 4 ? "bg-orange-600 text-white" : "bg-danger text-white"
                : "bg-surface2 text-muted"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CheckInForm() {
  const [sleep, setSleep] = useState("");
  const [weight, setWeight] = useState("");
  const [mood, setMood] = useState(3);
  const [readiness, setReadiness] = useState(3);
  const [soreness, setSoreness] = useState<Record<BodyPart, number>>({
    calf: 0, knee: 0, shoulder: 0, hip: 0, ankle: 0, back: 0, elbow: 0, wrist: 0,
  });
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const EMOJI_SCALE = ["", "😫", "😕", "😐", "🙂", "😄"];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: POST /logs/checkin
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
        <label className="block text-xs text-muted mb-2 uppercase tracking-wider">Mood</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setMood(v)}
              className={`flex-1 py-2 rounded-xl text-xl transition-opacity ${mood === v ? "opacity-100" : "opacity-30"}`}
            >
              {EMOJI_SCALE[v]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-2 uppercase tracking-wider">Readiness</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setReadiness(v)}
              className={`flex-1 py-2 rounded-xl text-xl transition-opacity ${readiness === v ? "opacity-100" : "opacity-30"}`}
            >
              {EMOJI_SCALE[v]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-2 uppercase tracking-wider">Soreness (0 = none, 5 = severe)</label>
        <div className="space-y-2">
          {BODY_PARTS.map((part) => (
            <SorenessRow
              key={part}
              part={part}
              value={soreness[part]}
              onChange={(v) => setSoreness((s) => ({ ...s, [part]: v }))}
            />
          ))}
        </div>
      </div>

      <Field label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Knee felt a bit stiff on the stairs…" />
      <SubmitButton saved={saved} label="Log check-in" />
    </form>
  );
}
