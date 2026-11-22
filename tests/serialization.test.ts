import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../src/shared/model';
import { DocumentError, parseProjectDoc } from '../src/shared/schema';
import { addNode, createWidgetNode, groupNodes } from '../src/shared/ops';

describe('parseProjectDoc', () => {
  it('round-trips a fresh project through JSON', () => {
    const doc = createEmptyProject('Round trip');
    const parsed = parseProjectDoc(JSON.parse(JSON.stringify(doc)));
    expect(parsed).toEqual(doc);
  });

  it('coerces malformed style values to defaults', () => {
    const doc = createEmptyProject('Styles');
    const node = createWidgetNode('text', 0, 0);
    const raw = JSON.parse(JSON.stringify({ ...doc, scenes: [addNode(doc.scenes[0]!, node)] }));
    const style = raw.scenes[0].nodes[node.id].style;
    style.fontSize = 'huge';
    style.textColor = 'red';
    style.glowSize = 999;
    style.textAlign = 'diagonal';
    style.bgGradient = 'nope';

    const parsed = parseProjectDoc(raw);
    const result = parsed.scenes[0]!.nodes[node.id]!.style;
    expect(result.fontSize).toBe(32);
    expect(result.textColor).toBe('#ffffff');
    expect(result.glowSize).toBe(40);
    expect(result.textAlign).toBe('left');
    expect(result.bgGradient).toEqual({ enabled: false, color2: '#2a0f4a', angle: 135 });
  });

  it('repairs dangling parent references', () => {
    const doc = createEmptyProject('Dangling');
    const node = createWidgetNode('text', 0, 0);
    const raw = JSON.parse(JSON.stringify({ ...doc, scenes: [addNode(doc.scenes[0]!, node)] }));
    raw.scenes[0].nodes[node.id].parentId = 'missing-parent';
    raw.scenes[0].rootIds = [];

    const parsed = parseProjectDoc(raw);
    expect(parsed.scenes[0]!.nodes[node.id]!.parentId).toBeNull();
    expect(parsed.scenes[0]!.rootIds).toEqual([node.id]);
  });

  it('drops root ids that belong to a group', () => {
    const doc = createEmptyProject('Roots');
    const node = createWidgetNode('text', 0, 0);
    const grouped = groupNodes(addNode(doc.scenes[0]!, node), [node.id], 'G');
    const raw = JSON.parse(JSON.stringify({ ...doc, scenes: [grouped.scene] }));
    raw.scenes[0].rootIds = [grouped.groupId, node.id];

    const parsed = parseProjectDoc(raw);
    expect(parsed.scenes[0]!.rootIds).toEqual([grouped.groupId]);
    expect(parsed.scenes[0]!.nodes[grouped.groupId]!.children).toEqual([node.id]);
  });

  it('clamps canvas size into the supported range', () => {
    const doc = createEmptyProject('Canvas');
    const raw = JSON.parse(JSON.stringify(doc));
    raw.scenes[0].width = 4;
    raw.scenes[0].height = 99999;
    const parsed = parseProjectDoc(raw);
    expect(parsed.scenes[0]!.width).toBe(16);
    expect(parsed.scenes[0]!.height).toBe(8192);
  });

  it('throws DocumentError for garbage input', () => {
    expect(() => parseProjectDoc('nope')).toThrow(DocumentError);
    expect(() => parseProjectDoc(null)).toThrow(DocumentError);
    expect(() => parseProjectDoc(42)).toThrow(DocumentError);
    expect(() => parseProjectDoc({})).toThrow(DocumentError);
  });

  it('throws DocumentError for too many scenes', () => {
    const doc = createEmptyProject('Many');
    const raw = JSON.parse(JSON.stringify(doc));
    raw.scenes = Array.from({ length: 51 }, (_, index) => ({ ...raw.scenes[0], id: `s${index}` }));
    expect(() => parseProjectDoc(raw)).toThrow(DocumentError);
  });

  it('throws DocumentError for too many nodes', () => {
    const doc = createEmptyProject('Huge');
    const raw = JSON.parse(JSON.stringify(doc));
    const nodes: Record<string, unknown> = {};
    for (let index = 0; index < 2001; index += 1) {
      nodes[`n${index}`] = {
        id: `n${index}`,
        type: 'widget',
        name: 'Node',
        parentId: null,
        children: [],
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        visible: true,
        locked: false,
        opacity: 1,
        style: {},
        widget: null,
        output: { padding: 0 },
      };
    }
    raw.scenes[0].nodes = nodes;
    expect(() => parseProjectDoc(raw)).toThrow(DocumentError);
  });
});
