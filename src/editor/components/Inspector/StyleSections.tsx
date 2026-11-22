import type { ReactNode } from 'react';
import type { NodeStyle, SceneNode, TextAlign } from '../../../shared/model';
import { getWidget } from '../../../widgets/registry';
import { patchStyle } from '../../state/actions';
import { ColorField } from '../../ui/ColorField';
import { IconButton } from '../../ui/IconButton';
import { NumberField } from '../../ui/NumberField';
import { Section } from '../../ui/Section';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import { Toggle } from '../../ui/Toggle';

const FONT_FAMILIES = [
  'Bahnschrift',
  'Segoe UI',
  'Segoe UI Variable Display',
  'Arial',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Consolas',
  'Cascadia Code',
  'Courier New',
  'Impact',
  'Comic Sans MS',
  'system-ui',
  'monospace',
  'serif',
];

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const ALIGN_ICONS: { value: TextAlign; icon: string; label: string }[] = [
  { value: 'left', icon: 'M4 6h16M4 12h10M4 18h13', label: 'Align left' },
  { value: 'center', icon: 'M4 6h16M7 12h10M6 18h12', label: 'Align center' },
  { value: 'right', icon: 'M4 6h16M10 12h10M7 18h13', label: 'Align right' },
];

export interface StyleSectionsProps {
  nodes: SceneNode[];
}

export function StyleSections({ nodes }: StyleSectionsProps): ReactNode {
  const first = nodes[0];
  if (!first) return null;
  const definition = first.widget ? getWidget(first.widget.kind) : undefined;
  const caps = definition?.styleCapabilities ?? [];
  const style = first.style;
  const ids = nodes.map((node) => node.id);
  const key = ids.join(',');
  const set = (patch: Partial<NodeStyle>, field: string): void =>
    patchStyle(ids, patch, `${key}:${field}`);

  const familyValue = FONT_FAMILIES.includes(style.fontFamily) ? style.fontFamily : 'custom';

  return (
    <>
      {caps.includes('font') ? (
        <Section title="Typography">
          <Select
            label="Font family"
            value={familyValue}
            options={[
              ...FONT_FAMILIES.map((family) => ({ value: family, label: family })),
              { value: 'custom', label: 'Custom…' },
            ]}
            onChange={(value) => set({ fontFamily: value === 'custom' ? 'system-ui' : value }, 'fontFamily')}
          />
          {familyValue === 'custom' ? (
            <input
              className="ns-textinput"
              value={style.fontFamily}
              onChange={(event) => set({ fontFamily: event.target.value }, 'fontFamily')}
            />
          ) : null}
          <div className="ns-grid-2">
            <NumberField
              label="Size"
              value={style.fontSize}
              min={4}
              max={400}
              unit="px"
              onChange={(value) => set({ fontSize: value }, 'fontSize')}
            />
            <Select
              label="Weight"
              value={String(style.fontWeight)}
              options={WEIGHTS.map((weight) => ({ value: String(weight), label: String(weight) }))}
              onChange={(value) => set({ fontWeight: Number(value) }, 'fontWeight')}
            />
          </div>
          <div className="ns-grid-2">
            <NumberField
              label="Line height"
              value={style.lineHeight}
              min={0.6}
              max={4}
              step={0.05}
              onChange={(value) => set({ lineHeight: value }, 'lineHeight')}
            />
            <NumberField
              label="Letter spacing"
              value={style.letterSpacing}
              min={-10}
              max={40}
              step={0.5}
              unit="px"
              onChange={(value) => set({ letterSpacing: value }, 'letterSpacing')}
            />
          </div>
          <div className="ns-field">
            <span className="ns-field-label">Align</span>
            <div className="ns-row">
              {ALIGN_ICONS.map((entry) => (
                <IconButton
                  key={entry.value}
                  icon={entry.icon}
                  label={entry.label}
                  active={style.textAlign === entry.value}
                  onClick={() => set({ textAlign: entry.value }, 'textAlign')}
                />
              ))}
            </div>
          </div>
        </Section>
      ) : null}

      {caps.includes('text') ? (
        <Section title="Text">
          <ColorField
            label="Text color"
            value={style.textColor}
            onChange={(value) => set({ textColor: value }, 'textColor')}
          />
          <Slider
            label="Text opacity"
            value={Math.round(style.textOpacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(value) => set({ textOpacity: value / 100 }, 'textOpacity')}
          />
        </Section>
      ) : null}

      {caps.includes('background') ? (
        <Section title="Background">
          <ColorField
            label="Color"
            value={style.bgColor}
            onChange={(value) => set({ bgColor: value }, 'bgColor')}
          />
          <Slider
            label="Opacity"
            value={Math.round(style.bgOpacity * 100)}
            min={0}
            max={100}
            unit="%"
            onChange={(value) => set({ bgOpacity: value / 100 }, 'bgOpacity')}
          />
          <Toggle
            label="Gradient"
            checked={style.bgGradient.enabled}
            onChange={(value) => set({ bgGradient: { ...style.bgGradient, enabled: value } }, 'bgGradient')}
          />
          {style.bgGradient.enabled ? (
            <>
              <ColorField
                label="Second color"
                value={style.bgGradient.color2}
                onChange={(value) => set({ bgGradient: { ...style.bgGradient, color2: value } }, 'bgGradient')}
              />
              <NumberField
                label="Angle"
                value={style.bgGradient.angle}
                min={0}
                max={360}
                unit="deg"
                onChange={(value) => set({ bgGradient: { ...style.bgGradient, angle: value } }, 'bgGradient')}
              />
            </>
          ) : null}
        </Section>
      ) : null}

      {caps.includes('border') ? (
        <Section title="Border">
          <div className="ns-grid-2">
            <NumberField
              label="Width"
              value={style.borderWidth}
              min={0}
              max={40}
              unit="px"
              onChange={(value) => set({ borderWidth: value }, 'borderWidth')}
            />
            <NumberField
              label="Opacity"
              value={Math.round(style.borderOpacity * 100)}
              min={0}
              max={100}
              unit="%"
              onChange={(value) => set({ borderOpacity: value / 100 }, 'borderOpacity')}
            />
          </div>
          <ColorField
            label="Color"
            value={style.borderColor}
            onChange={(value) => set({ borderColor: value }, 'borderColor')}
          />
        </Section>
      ) : null}

      {caps.includes('radius') ? (
        <Section title="Corners">
          <NumberField
            label="Radius"
            value={style.radius}
            min={0}
            max={400}
            unit="px"
            onChange={(value) => set({ radius: value }, 'radius')}
          />
        </Section>
      ) : null}

      {caps.includes('padding') ? (
        <Section title="Padding">
          <NumberField
            label="Padding"
            value={style.padding}
            min={0}
            max={200}
            unit="px"
            onChange={(value) => set({ padding: value }, 'padding')}
          />
        </Section>
      ) : null}

      {caps.includes('glow') ? (
        <Section title="Glow" defaultOpen={false}>
          <Toggle
            label="Glow"
            checked={style.glowEnabled}
            onChange={(value) => set({ glowEnabled: value }, 'glowEnabled')}
          />
          {style.glowEnabled ? (
            <>
              <ColorField
                label="Color"
                value={style.glowColor}
                onChange={(value) => set({ glowColor: value }, 'glowColor')}
              />
              <Slider
                label="Size"
                value={style.glowSize}
                min={0}
                max={40}
                onChange={(value) => set({ glowSize: value }, 'glowSize')}
              />
              <span className="ns-hint">
                Glow is rendered with a single shadow; keep it subtle for performance.
              </span>
            </>
          ) : null}
        </Section>
      ) : null}

      {caps.includes('shadow') ? (
        <Section title="Shadow" defaultOpen={false}>
          <Toggle
            label="Shadow"
            checked={style.shadowEnabled}
            onChange={(value) => set({ shadowEnabled: value }, 'shadowEnabled')}
          />
          {style.shadowEnabled ? (
            <>
              <ColorField
                label="Color"
                value={style.shadowColor}
                onChange={(value) => set({ shadowColor: value }, 'shadowColor')}
              />
              <Slider
                label="Opacity"
                value={Math.round(style.shadowOpacity * 100)}
                min={0}
                max={100}
                unit="%"
                onChange={(value) => set({ shadowOpacity: value / 100 }, 'shadowOpacity')}
              />
              <div className="ns-grid-3">
                <NumberField label="X" value={style.shadowX} min={-100} max={100} onChange={(value) => set({ shadowX: value }, 'shadowX')} />
                <NumberField label="Y" value={style.shadowY} min={-100} max={100} onChange={(value) => set({ shadowY: value }, 'shadowY')} />
                <NumberField label="Blur" value={style.shadowBlur} min={0} max={100} onChange={(value) => set({ shadowBlur: value }, 'shadowBlur')} />
              </div>
            </>
          ) : null}
        </Section>
      ) : null}

      {caps.includes('animation') ? (
        <Section title="Animation" defaultOpen={false}>
          <Toggle
            label="Animate"
            checked={style.animate}
            onChange={(value) => set({ animate: value }, 'animate')}
          />
          <Slider
            label="Speed"
            value={style.animationSpeed}
            min={0.25}
            max={3}
            step={0.05}
            unit="×"
            onChange={(value) => set({ animationSpeed: value }, 'animationSpeed')}
          />
        </Section>
      ) : null}
    </>
  );
}
