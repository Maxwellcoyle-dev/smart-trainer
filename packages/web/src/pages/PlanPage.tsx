import { useState } from "react";
import type { SportType } from "@smart-trainer/core";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  // day_of_week → sport (null = rest/empty)
  const [slots, setSlots] = useState<(SportType | null)[]>(Array(7).fill(null));
  const [editing, setEditing] = useState<number | null>(null);

  function pick(day: number, sport: SportType | null) {
    setSlots((s) => s.map((x, i) => (i === day ? sport : x)));
    setEditing(null);
  }

  const slotInputs: SlotDraft[] = slots
    .map((sport, i) => sport ? { day_of_week: i, sport, hint: "" } : null)
    .filter(Boolean) as SlotDraft[];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold pt-2">Plan</h1>

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

        <button
          className="mt-4 w-full py-3 rounded-xl bg-accent text-white font-semibold active:opacity-80"
          onClick={() => alert(`Would save ${slotInputs.length} slots — wire to PUT /plan/skeleton once backend connected`)}
        >
          Save skeleton ({slotInputs.length} slots)
        </button>
      </div>

      {/* Goals placeholder */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-2">Goals</p>
        <p className="text-muted text-sm">Connect backend to manage goals</p>
      </div>

      {/* Proposals placeholder */}
      <div className="bg-surface rounded-2xl p-4">
        <p className="text-muted text-xs uppercase tracking-wider mb-2">Pending proposals</p>
        <p className="text-muted text-sm">No pending proposals</p>
      </div>
    </div>
  );
}
