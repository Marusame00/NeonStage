import { z } from 'zod';

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function numField(def: number, min: number, max: number): z.ZodType<number> {
  return z.unknown().transform((value) => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  });
}

export function boolField(def: boolean): z.ZodType<boolean> {
  return z.unknown().transform((value) => (typeof value === 'boolean' ? value : def));
}

export function strField(def: string, maxLength = 10_000): z.ZodType<string> {
  return z.unknown().transform((value) => (typeof value === 'string' ? value.slice(0, maxLength) : def));
}

export function enumField<T extends string>(values: readonly T[], def: T): z.ZodType<T> {
  return z.unknown().transform((value) =>
    typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : def,
  );
}

export function colorField(def: string): z.ZodType<string> {
  return z.unknown().transform((value) => (typeof value === 'string' && HEX_COLOR.test(value) ? value : def));
}

export function strListField(def: string[], maxItems = 50, maxLength = 500): z.ZodType<string[]> {
  return z.unknown().transform((value) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .slice(0, maxItems)
          .map((item) => item.slice(0, maxLength))
      : def,
  );
}
