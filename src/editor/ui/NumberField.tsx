import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface NumberFieldProps {
  label?: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  precision?: number;
  disabled?: boolean;
}

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  precision = 2,
  disabled = false,
}: NumberFieldProps): ReactNode {
  const [draft, setDraft] = useState(() => String(round(value, precision)));
  const scrub = useRef<{ x: number; start: number } | null>(null);

  useEffect(() => {
    setDraft(String(round(value, precision)));
  }, [value, precision]);

  const commit = (raw: string): void => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onChange(clamp(parsed, min, max));
    else setDraft(String(round(value, precision)));
  };

  return (
    <label className="ns-field ns-numberfield">
      {label ? (
        <span
          className="ns-field-label ns-scrub"
          onPointerDown={(event) => {
            if (disabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            scrub.current = { x: event.clientX, start: value };
          }}
          onPointerMove={(event) => {
            if (!scrub.current) return;
            const delta = Math.round((event.clientX - scrub.current.x) / 2) * step;
            onChange(clamp(scrub.current.start + delta, min, max));
          }}
          onPointerUp={() => {
            scrub.current = null;
          }}
        >
          {label}
        </span>
      ) : null}
      <span className="ns-numberfield-input">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = Number(event.target.value);
            if (event.target.value !== '' && Number.isFinite(parsed)) {
              onChange(clamp(parsed, min, max));
            }
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            const direction = event.key === 'ArrowUp' ? 1 : -1;
            const delta = direction * step * (event.shiftKey ? 10 : 1);
            const next = clamp(round(value + delta, precision), min, max);
            setDraft(String(next));
            onChange(next);
          }}
        />
        {unit ? <span className="ns-unit">{unit}</span> : null}
      </span>
    </label>
  );
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
