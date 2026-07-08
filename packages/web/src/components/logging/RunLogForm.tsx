import { useState } from "react";
import { Field, NumField, RpeSlider, SubmitButton, DateSelector, localDateStr, occurredAtFrom } from "./shared.tsx";
import { useLogRun } from "../../lib/hooks.ts";

export function RunLogForm() {
  const logRun = useLogRun();
  const [date, setDate] = useState(localDateStr());
  const [distanceKm, setDistanceKm] = useState("");
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const [surface, setSurface] = useState<"trail" | "road" | "track" | "treadmill" | "mixed">("road");
  const [elevGain, setElevGain] = useState("");
  const [rpe, setRpe] = useState<number>(6);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const surfaces = ["road", "trail", "track", "treadmill", "mixed"] as const;

  // Derive pace for live display
  const distM = parseFloat(distanceKm) * 1000;
  const durS =
    (parseInt(hours || "0") * 3600) +
    (parseInt(minutes || "0") * 60) +
    parseInt(seconds || "0");
  const pace = distM && durS ? durS / (distM / 1000) : null;
  const paceDisplay = pace
    ? `${Math.floor(pace / 60)}:${String(Math.round(pace % 60)).padStart(2, "0")}/km`
    : null;

  function resetForm() {
    setDistanceKm("");
    setHours("");
    setMinutes("");
    setSeconds("");
    setElevGain("");
    setNotes("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(distM > 0) || !(durS > 0)) return;
    logRun.mutate(
      {
        occurred_at: occurredAtFrom(date),
        distance_m: Math.round(distM),
        duration_s: durS,
        surface,
        elevation_gain_m: elevGain ? Math.round(parseFloat(elevGain)) : null,
        session_rpe: rpe,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => {
          setSaved(true);
          resetForm();
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DateSelector value={date} onChange={setDate} />

      <div className="grid grid-cols-2 gap-3">
        <NumField
          label="Distance (km)"
          value={distanceKm}
          onChange={setDistanceKm}
          placeholder="10.5"
          step="0.1"
          min="0"
        />
        {paceDisplay && (
          <div className="flex flex-col justify-end pb-1">
            <p className="text-xs text-muted uppercase tracking-wider mb-1">Pace</p>
            <p className="text-lg font-semibold text-accent">{paceDisplay}</p>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Duration</label>
        <div className="flex gap-2">
          {[
            { value: hours, set: setHours, placeholder: "0h", max: 24 },
            { value: minutes, set: setMinutes, placeholder: "42m", max: 59 },
            { value: seconds, set: setSeconds, placeholder: "30s", max: 59 },
          ].map((f, i) => (
            <input
              key={i}
              type="number"
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
              min="0"
              max={f.max}
              className="w-16 bg-surface2 rounded-xl px-3 py-3 text-center outline-none"
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1 uppercase tracking-wider">Surface</label>
        <div className="flex gap-2 flex-wrap">
          {surfaces.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSurface(s)}
              className={`px-3 py-2 rounded-xl text-sm capitalize font-medium transition-colors ${
                surface === s ? "bg-accent text-white" : "bg-surface2 text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <NumField
        label="Elevation gain (m, optional)"
        value={elevGain}
        onChange={setElevGain}
        placeholder="150"
        min="0"
        step="1"
      />

      <RpeSlider value={rpe} onChange={setRpe} />

      <Field label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Felt strong on the hills…" />

      <SubmitButton
        saved={saved}
        label="Log run"
        pending={logRun.isPending}
        error={logRun.isError ? (logRun.error as Error).message : null}
      />
    </form>
  );
}
