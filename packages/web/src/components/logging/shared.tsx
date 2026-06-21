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
