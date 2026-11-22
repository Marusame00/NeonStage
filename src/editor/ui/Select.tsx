import type { ReactNode } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
}

export function Select({ label, value, options, onChange, disabled = false }: SelectProps): ReactNode {
  return (
    <label className="ns-field ns-select">
      {label ? <span className="ns-field-label">{label}</span> : null}
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
