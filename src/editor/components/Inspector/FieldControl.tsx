import type { ReactNode } from 'react';
import type { FieldSpec } from '../../../widgets/contract';
import { updateDoc } from '../../state/actions';
import { store, useEditor, type EditorState } from '../../state/store';
import { Button } from '../../ui/Button';
import { ColorField } from '../../ui/ColorField';
import { NumberField } from '../../ui/NumberField';
import { Select } from '../../ui/Select';
import { Toggle } from '../../ui/Toggle';

const selectAssets = (state: EditorState) => state.doc.assets;

export interface FieldControlProps {
  field: FieldSpec;
  value: unknown;
  onChange(value: unknown): void;
}

export function FieldControl({ field, value, onChange }: FieldControlProps): ReactNode {
  switch (field.type) {
    case 'text':
      return (
        <label className="ns-field">
          <span className="ns-field-label">{field.label}</span>
          <input
            className="ns-textinput"
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
          {field.help ? <span className="ns-hint">{field.help}</span> : null}
        </label>
      );
    case 'textarea':
      return (
        <label className="ns-field">
          <span className="ns-field-label">{field.label}</span>
          <textarea
            className="ns-textarea"
            value={typeof value === 'string' ? value : ''}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
          {field.help ? <span className="ns-hint">{field.help}</span> : null}
        </label>
      );
    case 'number':
      return (
        <NumberField
          label={field.label}
          value={typeof value === 'number' ? value : 0}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          unit={field.unit}
          onChange={onChange}
        />
      );
    case 'boolean':
      return (
        <Toggle
          label={field.label}
          checked={value === true}
          hint={field.help}
          onChange={onChange}
        />
      );
    case 'select':
      return (
        <Select
          label={field.label}
          value={typeof value === 'string' ? value : ''}
          options={field.options}
          onChange={onChange}
        />
      );
    case 'color':
      return (
        <ColorField
          label={field.label}
          value={typeof value === 'string' ? value : '#000000'}
          onChange={onChange}
        />
      );
    case 'stringList':
      return (
        <StringListField
          label={field.label}
          itemLabel={field.itemLabel}
          maxItems={field.maxItems}
          value={Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []}
          onChange={onChange}
        />
      );
    case 'duration':
      return (
        <DurationField
          label={field.label}
          value={typeof value === 'number' ? value : 0}
          onChange={onChange}
        />
      );
    case 'asset':
      return (
        <AssetField
          label={field.label}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

function StringListField({
  label,
  itemLabel,
  maxItems,
  value,
  onChange,
}: {
  label: string;
  itemLabel: string;
  maxItems?: number;
  value: string[];
  onChange(value: string[]): void;
}): ReactNode {
  const update = (index: number, text: string): void => {
    const next = [...value];
    next[index] = text;
    onChange(next);
  };
  const move = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange(next);
  };
  return (
    <div className="ns-field">
      <span className="ns-field-label">{label}</span>
      {value.map((item, index) => (
        <div className="ns-row" key={index}>
          <input
            className="ns-textinput"
            value={item}
            onChange={(event) => update(index, event.target.value)}
          />
          <button
            type="button"
            className="ns-iconbtn"
            title="Move up"
            onClick={() => move(index, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="ns-iconbtn"
            title="Move down"
            onClick={() => move(index, 1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="ns-iconbtn"
            title="Remove"
            onClick={() => onChange(value.filter((_, entry) => entry !== index))}
          >
            ×
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        disabled={maxItems !== undefined && value.length >= maxItems}
        onClick={() => onChange([...value, ''])}
      >
        Add {itemLabel.toLowerCase()}
      </Button>
    </div>
  );
}

function DurationField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange(value: number): void;
}): ReactNode {
  const total = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const set = (h: number, m: number, s: number): void => {
    onChange(Math.max(0, h * 3600 + m * 60 + s) * 1000);
  };
  return (
    <div className="ns-field">
      <span className="ns-field-label">{label}</span>
      <div className="ns-grid-3">
        <NumberField label="h" value={hours} min={0} max={24} onChange={(h) => set(h, minutes, seconds)} />
        <NumberField label="m" value={minutes} min={0} max={59} onChange={(m) => set(hours, m, seconds)} />
        <NumberField label="s" value={seconds} min={0} max={59} onChange={(s) => set(hours, minutes, s)} />
      </div>
    </div>
  );
}

function AssetField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}): ReactNode {
  const assets = useEditor(selectAssets);
  const asset = assets.find((entry) => entry.id === value);
  return (
    <div className="ns-field">
      <span className="ns-field-label">{label}</span>
      <div className="ns-row">
        <Button
          size="sm"
          onClick={() => {
            void (async () => {
              const imported = await window.neonstage.importAsset();
              if (!imported) return;
              const current = store.getState().doc.assets;
              if (!current.some((entry) => entry.id === imported.id)) {
                updateDoc((doc) => ({ ...doc, assets: [...doc.assets, imported] }));
              }
              onChange(imported.id);
            })();
          }}
        >
          Choose image…
        </Button>
        {value ? (
          <Button size="sm" variant="ghost" onClick={() => onChange('')}>
            Remove
          </Button>
        ) : null}
      </div>
      <span className="ns-hint">{asset ? asset.name : value ? 'Missing asset' : 'No image chosen'}</span>
    </div>
  );
}
