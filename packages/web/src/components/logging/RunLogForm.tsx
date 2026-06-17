import { useState } from "react";
import { Field, NumField, RpeSlider, SubmitButton } from "./shared.tsx";

export function RunLogForm() {
  const [distance, setDistance] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const [surface, setSurface] = useState<"trail" | "road" | "track" | "treadmill">("road");
  const [rpe, setRpe] = useState<number>(6);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const surfaces = ["road", "trail", "track", "treadmill"] as const;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // TODO: POST /logs/run once backend connected
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <NumField
        label="Distance (km)"
        value={distance}
        onChange={setDistance}
        placeholder="10.5"
        step="0.1"
        min="0"
      />

      <div>
        <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Duration</label>
        <div className="flex gap-2">
          <input
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0h"
            min="0"
            className="w-16 bg-surface2 rounded-xl px-3 py-3 text-center outline-none"
          />
          <input
            type="number"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="42m"
            min="0"
            max="59"
            className="w-16 bg-surface2 rounded-xl px-3 py-3 text-center outline-none"
          />
          <input
            type="number"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            placeholder="30s"
            min="0"
            max="59"
            className="w-16 bg-surface2 rounded-xl px-3 py-3 text-center outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Surface</label>
        <div className="grid grid-cols-4 gap-2">
          {surfaces.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSurface(s)}
              className={`py-2 rounded-xl text-sm capitalize font-medium transition-colors ${
                surface === s ? "bg-accent text-white" : "bg-surface2 text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <RpeSlider value={rpe} onChange={setRpe} />

      <Field label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Felt strong on the hills…" />

      <SubmitButton saved={saved} label="Log run" />
    </form>
  );
}
