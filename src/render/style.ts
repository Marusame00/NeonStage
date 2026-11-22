import type { CSSProperties } from 'react';
import type { NodeStyle } from '../shared/model';
import type { StyleCapability } from '../widgets/contract';

export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.trim().replace(/^#/, '');
  const expanded =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return `rgba(0, 0, 0, ${clamped})`;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export function boxStyle(style: NodeStyle, caps: StyleCapability[]): CSSProperties {
  const out: CSSProperties = {};

  if (caps.includes('background')) {
    out.background = style.bgGradient.enabled
      ? `linear-gradient(${style.bgGradient.angle}deg, ${hexToRgba(style.bgColor, style.bgOpacity)}, ${hexToRgba(style.bgGradient.color2, style.bgOpacity)})`
      : hexToRgba(style.bgColor, style.bgOpacity);
  }
  if (caps.includes('border') && style.borderWidth > 0) {
    out.border = `${style.borderWidth}px solid ${hexToRgba(style.borderColor, style.borderOpacity)}`;
  }
  if (caps.includes('radius')) out.borderRadius = `${style.radius}px`;
  if (caps.includes('padding')) out.padding = `${style.padding}px`;

  const shadows: string[] = [];
  if (caps.includes('shadow') && style.shadowEnabled) {
    shadows.push(
      `${style.shadowX}px ${style.shadowY}px ${style.shadowBlur}px ${hexToRgba(style.shadowColor, style.shadowOpacity)}`,
    );
  }
  if (caps.includes('glow') && style.glowEnabled) {
    shadows.push(`0 0 ${style.glowSize}px ${hexToRgba(style.glowColor, 0.75)}`);
  }
  if (shadows.length > 0) out.boxShadow = shadows.join(', ');

  return out;
}

export function textStyle(style: NodeStyle, caps: StyleCapability[]): CSSProperties {
  const out: CSSProperties = {};

  if (caps.includes('font')) {
    out.fontFamily = style.fontFamily;
    out.fontSize = `${style.fontSize}px`;
    out.fontWeight = style.fontWeight;
    out.lineHeight = style.lineHeight;
    out.letterSpacing = `${style.letterSpacing}px`;
  }
  if (caps.includes('text')) {
    out.textAlign = style.textAlign;
    out.color = hexToRgba(style.textColor, style.textOpacity);
    if (style.glowEnabled) {
      out.textShadow = `0 0 ${style.glowSize}px ${hexToRgba(style.glowColor, 0.75)}`;
    }
  }

  return out;
}
