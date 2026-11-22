import type { ZodType } from 'zod';
import type { NodeStyle } from '../shared/model';

export type StyleCapability =
  | 'font'
  | 'text'
  | 'background'
  | 'border'
  | 'radius'
  | 'padding'
  | 'glow'
  | 'shadow'
  | 'animation';

export type FieldSpec = {
  key: string;
  label: string;
  help?: string;
  section?: string;
  showIf?: { key: string; equals: unknown | unknown[] };
} & (
  | { type: 'text'; placeholder?: string; maxLength?: number }
  | { type: 'textarea'; maxLength?: number }
  | { type: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { type: 'boolean' }
  | { type: 'select'; options: { value: string; label: string }[] }
  | { type: 'color' }
  | { type: 'stringList'; itemLabel: string; maxItems?: number }
  | { type: 'duration' }
  | { type: 'asset'; accept: 'image' }
);

export type DataSourceRequest = {
  kind: 'chat';
  provider: 'twitch' | 'youtube' | 'demo-twitch' | 'demo-youtube';
  key: string;
  params: Record<string, string>;
};

export type WidgetCategory = 'text' | 'shape' | 'frame' | 'time' | 'progress' | 'chat' | 'info' | 'media';

export interface WidgetDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  kind: string;
  version: number;
  name: string;
  description: string;
  category: WidgetCategory;
  icon: string;
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  defaultProps(): P;
  defaultStyle?(): Partial<NodeStyle>;
  fields: FieldSpec[];
  styleCapabilities: StyleCapability[];
  validate(raw: unknown): P;
  migrate?(props: Record<string, unknown>, fromVersion: number): Record<string, unknown>;
  dataSources?(props: P): DataSourceRequest[];
  visualOverflow?(props: P, style: NodeStyle): number;
  runtime?: 'timer' | 'goal';
  manualLabel?: boolean;
  notes?: string[];
}

export type WidgetValidator<P extends Record<string, unknown>> = (raw: unknown) => P;

export function makeValidator<P extends Record<string, unknown>>(
  defaults: P,
  shape: Record<string, ZodType>,
): WidgetValidator<P> {
  return (raw: unknown): P => {
    const source =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const out: Record<string, unknown> = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const schema = shape[key];
      if (!schema) continue;
      const parsed = schema.safeParse(source[key]);
      if (parsed.success) out[key] = parsed.data;
    }
    return out as P;
  };
}
