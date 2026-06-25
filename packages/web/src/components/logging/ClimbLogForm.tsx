import { useState } from "react";
import { RpeSlider, Field, SubmitButton } from "./shared.tsx";
import type { ClimbStyle, ClimbEnvironment, ClimbAngle, ClimbCharacter, ClimbResult, Grade } from "@smart-trainer/core";
import { useLogClimb, useClimbPlaces, useGrades } from "../../lib/hooks.ts";

interface ClimbEntry {
  grade_label: string;
  grade_value: number | null;
  grade_id: string | null;
  style: ClimbStyle;
  attempts: number;
  sends: number;
  route_name: string;
  angle: ClimbAngle | null;
  character_tags: ClimbCharacter[];
  length_ft: string;
  effort: number | null;
  result: ClimbResult | null;
  climb_notes: string;
  expanded: boolean;
}

const STYLES: ClimbStyle[] = ["sport", "boulder", "top_rope", "trad"];
const STYLE_LABELS: Record<ClimbStyle, string> = {
  sport: "Sport", boulder: "Boulder", top_rope: "Top rope", trad: "Trad", auto: "Auto",
};

const ANGLES: ClimbAngle[] = ["slab", "vertical", "overhang", "roof"];
const ANGLE_LABELS: Record<ClimbAngle, string> = {
  slab: "Slab", vertical: "Vert", overhang: "Over", roof: "Roof",
};

const CHARACTERS: ClimbCharacter[] = ["powerful", "endurance", "technical", "crimpy", "dynamic"];
const CHAR_LABELS: Record<ClimbCharacter, string> = {
  powerful: "Power", endurance: "Endur", technical: "Tech", crimpy: "Crimp", dynamic: "Dyna",
};

const RESULTS: { value: ClimbResult; label: string }[] = [
  { value: "onsight", label: "Onsight" },
  { value: "flash", label: "Flash" },
  { value: "redpoint", label: "Redpoint" },
  { value: "hung", label: "Fell / hung" },
  { value: "dnf", label: "DNF" },
];

const DISCIPLINE_FOR_STYLE = (style: ClimbStyle): "rope" | "boulder" =>
  style === "boulder" ? "boulder" : "rope";

const RESULT_COLORS: Record<ClimbResult, string> = {
  onsight: "bg-green-700 text-green-100",
  flash: "bg-blue-700 text-blue-100",
  redpoint: "bg-accent text-white",
  hung: "bg-yellow-700 text-yellow-100",
  dnf: "bg-surface2 text-muted",
};

const RESULT_BADGE: Record<ClimbResult, string> = {
  onsight: "OS", flash: "Flash", redpoint: "RP", hung: "Hung", dnf: "DNF",
};

function ClimbRow({
  climb,
  grades,
  onChange,
  onRemove,
}: {
  climb: ClimbEntry;
  grades: Grade[];
  onChange: (c: ClimbEntry) => void;
  onRemove: () => void;
}) {
  const discipline = DISCIPLINE_FOR_STYLE(climb.style);
  const gradeOptions = grades.filter((g) => g.discipline === discipline);

  function selectGrade(id: string) {
    const g = gradeOptions.find((x) => x.id === id);
    onChange({
      ...climb,
      grade_id: g?.id ?? null,
      grade_label: g?.label ?? "",
      grade_value: g?.grade_value ?? null,
      expanded: true,
    });
  }

  const hasGrade = climb.grade_label.trim().length > 0;
  const canCollapse = hasGrade && climb.result !== null;

  function toggleExpand() {
    onChange({ ...climb, expanded: !climb.expanded });
  }

  const resultBadge = climb.result ? (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${RESULT_COLORS[climb.result]}`}>
      {RESULT_BADGE[climb.result]}
    </span>
  ) : null;

  const angleBadge = climb.angle ? (
    <span className="text-[10px] text-muted">{ANGLE_LABELS[climb.angle]}</span>
  ) : null;

  return (
    <div className="bg-surface2 rounded-xl overflow-hidden">
      {/* Collapsed header — always visible */}
      <div
        className="flex gap-2 items-center p-3"
        onClick={canCollapse ? toggleExpand : undefined}
      >
        <select
          value={climb.grade_id ?? ""}
          onChange={(e) => selectGrade(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={`flex-1 bg-surface rounded-lg px-3 py-2 text-sm outline-none ${
            hasGrade ? "text-text" : "text-muted"
          }`}
        >
          <option value="">
            {grades.length === 0 ? "Loading grades…" : "Select grade…"}
          </option>
          {gradeOptions.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </select>
        {!climb.expanded && (
          <div className="flex items-center gap-1.5">
            {resultBadge}
            {angleBadge}
          </div>
        )}
        {canCollapse && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleExpand(); }}
            className="text-muted text-sm px-1"
          >
            {climb.expanded ? "▲" : "▼"}
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="text-muted text-xl px-1 leading-none"
        >
          ×
        </button>
      </div>

      {/* Expanded detail */}
      {climb.expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Style / discipline */}
          <div className="flex gap-1">
            {STYLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  const disciplineChanged =
                    DISCIPLINE_FOR_STYLE(s) !== DISCIPLINE_FOR_STYLE(climb.style);
                  onChange(
                    disciplineChanged
                      ? { ...climb, style: s, grade_id: null, grade_label: "", grade_value: null }
                      : { ...climb, style: s }
                  );
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  climb.style === s ? "bg-accent text-white" : "bg-surface text-muted"
                }`}
              >
                {STYLE_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Angle */}
          <div>
            <p className="text-xs text-muted mb-1 uppercase tracking-wider">Angle</p>
            <div className="flex gap-1">
              {ANGLES.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onChange({ ...climb, angle: climb.angle === a ? null : a })}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    climb.angle === a ? "bg-accent text-white" : "bg-surface text-muted"
                  }`}
                >
                  {ANGLE_LABELS[a]}
                </button>
              ))}
            </div>
          </div>

          {/* Character */}
          <div>
            <p className="text-xs text-muted mb-1 uppercase tracking-wider">Character</p>
            <div className="flex gap-1 flex-wrap">
              {CHARACTERS.map((ch) => {
                const selected = climb.character_tags.includes(ch);
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => {
                      const tags = selected
                        ? climb.character_tags.filter((t) => t !== ch)
                        : [...climb.character_tags, ch];
                      onChange({ ...climb, character_tags: tags });
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      selected ? "bg-accent text-white" : "bg-surface text-muted"
                    }`}
                  >
                    {CHAR_LABELS[ch]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Result — type of send */}
          <div>
            <p className="text-xs text-muted mb-1 uppercase tracking-wider">Result (type of send)</p>
            <div className="flex gap-1.5 flex-wrap">
              {RESULTS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onChange({ ...climb, result: climb.result === value ? null : value })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    climb.result === value
                      ? RESULT_COLORS[value]
                      : "bg-surface text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Attempts / Sends */}
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-muted w-10">Att</span>
              <button
                type="button"
                onClick={() => onChange({ ...climb, attempts: Math.max(1, climb.attempts - 1) })}
                className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center"
              >
                −
              </button>
              <span className="w-5 text-center text-sm font-semibold">{climb.attempts}</span>
              <button
                type="button"
                onClick={() => onChange({ ...climb, attempts: climb.attempts + 1 })}
                className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center"
              >
                +
              </button>
            </div>

            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-muted w-10">Sends</span>
              <button
                type="button"
                onClick={() => onChange({ ...climb, sends: Math.max(0, climb.sends - 1) })}
                className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center"
              >
                −
              </button>
              <span className="w-5 text-center text-sm font-semibold">{climb.sends}</span>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...climb, sends: Math.min(climb.attempts, climb.sends + 1) })
                }
                className="w-7 h-7 rounded-full bg-surface text-sm font-bold flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>

          {/* Length + Effort */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1 uppercase tracking-wider">
                Length (ft)
              </label>
              <input
                type="number"
                inputMode="numeric"
                value={climb.length_ft}
                onChange={(e) => onChange({ ...climb, length_ft: e.target.value })}
                placeholder="—"
                min="1"
                max="5000"
                className="w-full bg-surface rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1 uppercase tracking-wider">
                Effort {climb.effort ? `${climb.effort}/10` : ""}
              </label>
              <div className="flex gap-1 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange({ ...climb, effort: climb.effort === n ? null : n })}
                    className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${
                      climb.effort === n ? "bg-accent text-white" : "bg-surface text-muted"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Route name + notes */}
          <input
            type="text"
            value={climb.route_name}
            onChange={(e) => onChange({ ...climb, route_name: e.target.value })}
            placeholder="Route name (optional)"
            className="w-full bg-surface rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-muted"
          />
          <input
            type="text"
            value={climb.climb_notes}
            onChange={(e) => onChange({ ...climb, climb_notes: e.target.value })}
            placeholder="Notes (optional)"
            className="w-full bg-surface rounded-lg px-3 py-1.5 text-sm outline-none placeholder:text-muted"
          />
        </div>
      )}
    </div>
  );
}

const newClimb = (): ClimbEntry => ({
  grade_label: "",
  grade_value: null,
  grade_id: null,
  style: "sport",
  attempts: 1,
  sends: 1,
  route_name: "",
  angle: null,
  character_tags: [],
  length_ft: "",
  effort: null,
  result: null,
  climb_notes: "",
  expanded: true,
});

export function ClimbLogForm() {
  const logClimb = useLogClimb();
  const { data: places } = useClimbPlaces();
  const { data: grades } = useGrades();
  const [environment, setEnvironment] = useState<ClimbEnvironment>("indoor");
  const [location, setLocation] = useState("");
  const [wall, setWall] = useState("");
  const [climbs, setClimbs] = useState<ClimbEntry[]>([newClimb()]);
  const [rpe, setRpe] = useState(6);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);

  const venueLabel = environment === "indoor" ? "Gym" : "Crag / Area";
  const venueList = environment === "indoor" ? (places?.gyms ?? []) : (places?.crags ?? []);

  function updateClimb(i: number, c: ClimbEntry) {
    setClimbs((cs) => cs.map((x, j) => (j === i ? c : x)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const valid = climbs.filter((c) => c.grade_label.trim());
    if (valid.length === 0) return;
    const locTrim = location.trim() || null;
    logClimb.mutate(
      {
        occurred_at: new Date().toISOString(),
        session_rpe: rpe,
        location: locTrim,
        notes: notes.trim() || null,
        climbs: valid.map((c, i) => ({
          grade_label: c.grade_label.trim(),
          grade_value: c.grade_value,
          grade_id: c.grade_id,
          style: c.style,
          environment,
          attempts: c.attempts,
          sends: c.sends,
          route_name: c.route_name.trim() || null,
          crag: environment === "outdoor" ? locTrim : null,
          wall: wall.trim() || null,
          order_in_session: i,
          angle: c.angle,
          character_tags: c.character_tags,
          length_ft: c.length_ft ? parseInt(c.length_ft) : null,
          effort: c.effort,
          result: c.result,
          climb_notes: c.climb_notes.trim() || null,
        })),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setClimbs([newClimb()]);
          setNotes("");
          setLocation("");
          setWall("");
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Session header */}
      <div className="bg-surface2 rounded-xl p-3 space-y-2">
        {/* Environment toggle */}
        <div className="flex gap-2">
          {(["indoor", "outdoor"] as const).map((env) => (
            <button
              key={env}
              type="button"
              onClick={() => setEnvironment(env)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                environment === env
                  ? env === "indoor"
                    ? "bg-blue-900 text-blue-200"
                    : "bg-green-900 text-green-200"
                  : "bg-surface text-muted"
              }`}
            >
              {env === "indoor" ? "Indoor" : "Outdoor"}
            </button>
          ))}
        </div>

        {/* Venue */}
        <div>
          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">{venueLabel}</label>
          <input
            type="text"
            list="venue-list"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={environment === "indoor" ? "The Front, Movement…" : "Red River Gorge…"}
            className="w-full bg-surface rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted"
          />
          <datalist id="venue-list">
            {venueList.map((v) => <option key={v} value={v} />)}
          </datalist>
        </div>

        {/* Wall / Sector */}
        <div>
          <label className="block text-xs text-muted mb-1 uppercase tracking-wider">
            Wall / Sector (optional)
          </label>
          <input
            type="text"
            list="wall-list"
            value={wall}
            onChange={(e) => setWall(e.target.value)}
            placeholder="South Cave, Pipe Dream Wall…"
            className="w-full bg-surface rounded-lg px-3 py-2 text-sm outline-none placeholder:text-muted"
          />
          <datalist id="wall-list">
            {(places?.walls ?? []).map((w) => <option key={w} value={w} />)}
          </datalist>
        </div>
      </div>

      {/* Climbs */}
      <div className="space-y-2">
        {climbs.map((c, i) => (
          <ClimbRow
            key={i}
            climb={c}
            grades={grades ?? []}
            onChange={(u) => updateClimb(i, u)}
            onRemove={() => setClimbs((cs) => cs.filter((_, j) => j !== i))}
          />
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
      <Field
        label="Session notes (optional)"
        value={notes}
        onChange={setNotes}
        multiline
        placeholder="Worked the crux on the 5.12b…"
      />
      <SubmitButton
        saved={saved}
        label="Log session"
        pending={logClimb.isPending}
        error={logClimb.isError ? (logClimb.error as Error).message : null}
      />
    </form>
  );
}
