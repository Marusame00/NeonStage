import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '../src/shared/templates';
import { createEmptyProject } from '../src/shared/model';
import { parseProjectDoc } from '../src/shared/schema';
import { getWidget } from '../src/widgets/registry';

describe('templates', () => {
  it('ships three templates', () => {
    expect(TEMPLATES.map((template) => template.id)).toEqual([
      'synthwave-gameplay',
      'minimal-mono',
      'colorful-just-chatting',
    ]);
  });

  for (const template of TEMPLATES) {
    it(`builds "${template.id}" as a valid document`, () => {
      const scene = template.build(1920, 1080);
      expect(scene.width).toBe(1920);
      expect(scene.height).toBe(1080);
      expect(scene.rootIds.length).toBeGreaterThan(0);

      const doc = { ...createEmptyProject(template.name), scenes: [scene] };
      const parsed = parseProjectDoc(JSON.parse(JSON.stringify(doc)));
      expect(parsed.scenes[0]!.nodes).toEqual(scene.nodes);
      expect(parsed.scenes[0]!.rootIds).toEqual(scene.rootIds);
      expect(parsed.assets).toEqual([]);

      for (const node of Object.values(scene.nodes)) {
        if (node.type === 'widget') {
          expect(node.widget).not.toBeNull();
          expect(getWidget(node.widget!.kind)).toBeDefined();
        }
      }
    });

    it(`keeps "${template.id}" proportional on a portrait canvas`, () => {
      const scene = template.build(1080, 1920);
      for (const node of Object.values(scene.nodes)) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.x + node.w).toBeLessThanOrEqual(1080 + 1);
        expect(node.y + node.h).toBeLessThanOrEqual(1920 + 1);
      }
    });
  }
});
