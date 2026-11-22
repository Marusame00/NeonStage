import type { ReactNode } from 'react';

export interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  hint?: string;
}

export function Toggle({ label, checked, onChange, disabled = false, hint }: ToggleProps): ReactNode {
  return (
    <label className={['ns-toggle', disabled ? 'is-disabled' : ''].filter(Boolean).join(' ')} title={hint}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ns-toggle-track" aria-hidden="true">
        <span className="ns-toggle-thumb" />
      </span>
      {label ? <span className="ns-toggle-label">{label}</span> : null}
    </label>
  );
}
