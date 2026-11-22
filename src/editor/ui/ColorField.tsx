import { useEffect, useState, type ReactNode } from 'react';

export interface ColorFieldProps {
  label?: string;
  value: string;
  onChange(value: string): void;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField({ label, value, onChange }: ColorFieldProps): ReactNode {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label className="ns-field ns-colorfield">
      {label ? <span className="ns-field-label">{label}</span> : null}
      <span className="ns-colorfield-input">
        <input
          type="color"
          value={HEX.test(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="text"
          className="ns-hex"
          value={draft}
          spellCheck={false}
          onChange={(event) => {
            setDraft(event.target.value);
            if (HEX.test(event.target.value)) onChange(event.target.value);
          }}
          onBlur={() => setDraft(value)}
        />
      </span>
    </label>
  );
}
