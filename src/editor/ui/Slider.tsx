import type { ReactNode } from 'react';

export interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange(value: number): void;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: SliderProps): ReactNode {
  return (
    <label className="ns-field ns-slider">
      {label ? (
        <span className="ns-field-label">
          {label}
          <span className="ns-slider-value">
            {Math.round(value * 100) / 100}
            {unit ?? ''}
          </span>
        </span>
      ) : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
