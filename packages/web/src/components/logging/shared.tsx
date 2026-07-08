// ─── Session date (supports backdating) ──────────────────────────────────────

/** Local date as YYYY-MM-DD, offset by `daysAgo`. */
export function localDateStr(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * ISO timestamp for a session on the given local date.
 * Today → current time; past days → midday local time.
 */
export function occurredAtFrom(dateStr: string): string {
  if (dateStr === localDateStr()) return new Date().toISOString();
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

const QUICK_DAYS = [
  { offset: 0, label: "Today" },
  { offset: 1, label: "Yesterday" },
  { offset: 2, label: "2 days ago" },
];

export function DateSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isQuick = QUICK_DAYS.some((q) => localDateStr(q.offset) === value);
  return (
    <div>
      <label className="block text-xs text-muted mb-1 uppercase tracking-wider">When</label>
      <div className="flex gap-2">
        {QUICK_DAYS.map((q) => {
          const d = localDateStr(q.offset);
          return (
            <button
              key={q.offset}
              type="button"
              onClick={() => onChange(d)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                value === d ? "bg-accent text-white" : "bg-surface2 text-muted"
              }`}
            >
              {q.label}
            </button>
          );
        })}
        <input
          type="date"
          value={value}
          max={localDateStr()}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className={`flex-1 min-w-0 bg-surface2 rounded-xl px-3 py-2 text-sm outline-none ${
            isQuick ? "text-muted" : "text-text ring-1 ring-accent"
          }`}
        />
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

export function Field({ label, value, onChange, placeholder, multiline }: FieldProps) {
  const cls = "w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted";
  return (
    <div>
      <label className="block text-xs text-muted mb-1 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className={cls + " resize-none"}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cls}
        />
      )}
    </div>
  );
}

interface NumFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  step?: string;
}

export function NumField({ label, value, onChange, placeholder, min, max, step }: NumFieldProps) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1 uppercase tracking-wider">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        className="w-full bg-surface2 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-muted"
      />
    </div>
  );
}

interface RpeSliderProps {
  value: number;
  onChange: (v: number) => void;
}

const RPE_LABELS: Record<number, string> = {
  1: "Very easy", 2: "Easy", 3: "Moderate", 4: "Somewhat hard",
  5: "Hard", 6: "Hard+", 7: "Very hard", 8: "Very hard+",
  9: "Near max", 10: "Max",
};

export function RpeSlider({ value, onChange }: RpeSliderProps) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1 uppercase tracking-wider">
        RPE <span className="text-text font-semibold">{value}</span>
        <span className="ml-1 font-normal normal-case">— {RPE_LABELS[value]}</span>
      </label>
      <input
        type="range"
        min={1}
        max={10}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full accent-accent"
      />
      <div className="flex justify-between text-xs text-muted mt-1">
        <span>1</span><span>5</span><span>10</span>
      </div>
    </div>
  );
}

interface SubmitButtonProps {
  saved: boolean;
  label: string;
  pending?: boolean;
  error?: string | null;
}

export function SubmitButton({ saved, label, pending, error }: SubmitButtonProps) {
  return (
    <div className="space-y-2">
      {error && <p className="text-danger text-sm text-center">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className={`w-full py-4 rounded-2xl font-semibold text-white transition-all disabled:opacity-50 ${
          saved ? "bg-success" : "bg-accent active:opacity-80"
        }`}
      >
        {saved ? "✓ Logged!" : pending ? "Saving…" : label}
      </button>
    </div>
  );
}
