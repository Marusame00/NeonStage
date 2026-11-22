import { describe, expect, it } from 'vitest';
import { migrateProjectDoc, migrateWidget } from '../src/shared/migrations';
import { parseProjectDoc } from '../src/shared/schema';
import { DocumentError } from '../src/shared/errors';
import { makeValidator } from '../src/widgets/contract';
import { strField } from '../src/widgets/fields';
import { registerWidget } from '../src/widgets/registry';

const v0Document = {
  id: 'prj1',
  name: 'Legacy',
  createdAt: '',
  updatedAt: '',
  scenes: [
    {
      id: 'sc1',
      name: 'Main',
      width: 1920,
      height: 1080,
      nodes: [
        {
          id: 'n1',
          type: 'widget',
          name: 'Text',
          parentId: null,
          children: [],
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          visible: true,
          locked: false,
          opacity: 1,
          style: {},
          widget: { kind: 'text', version: 1, props: { text: 'Hi' } },
        },
        {
          id: 'g1',
          type: 'group',
          name: 'G',
          parentId: null,
          children: ['n2'],
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          visible: true,
          locked: false,
          opacity: 1,
          style: {},
          widget: null,
        },
        {
          id: 'n2',
          type: 'widget',
          name: 'Shape',
          parentId: 'g1',
          children: [],
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          visible: true,
          locked: false,
          opacity: 1,
          style: {},
          widget: { kind: 'shape', version: 1, props: {} },
        },
      ],
    },
  ],
};

describe('migrateProjectDoc', () => {
  it('migrates a v0 document to v1', () => {
    const migrated = migrateProjectDoc(v0Document) as Record<string, unknown>;
    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.settings).toEqual({ reduceMotion: false });
    expect(migrated.assets).toEqual([]);
    const scene = (migrated.scenes as Record<string, unknown>[])[0]!;
    expect(Array.isArray(scene.nodes)).toBe(false);
    expect(scene.rootIds).toEqual(['n1', 'g1']);
  });

  it('produces a document that validates', () => {
    const doc = parseProjectDoc(v0Document);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.scenes[0]!.nodes['n2']!.parentId).toBe('g1');
    expect(doc.scenes[0]!.nodes['g1']!.children).toEqual(['n2']);
    expect(doc.scenes[0]!.rootIds).toEqual(['n1', 'g1']);
    expect(doc.scenes[0]!.nodes['n1']!.output).toEqual({ padding: 0 });
  });

  it('rejects a newer schema version', () => {
    expect(() => migrateProjectDoc({ schemaVersion: 99 })).toThrow(DocumentError);
    expect(() => migrateProjectDoc({ schemaVersion: 99 })).toThrow(/newer version/i);
  });
});

describe('migrateWidget', () => {
  it('delegates to the widget definition migrate', () => {
    registerWidget({
      kind: 'test-migrate',
      version: 2,
      name: 'Test migrate',
      description: 'Test only widget',
      category: 'info',
      icon: '',
      defaultSize: { w: 10, h: 10 },
      defaultProps: () => ({ label: 'x' }),
      fields: [],
      styleCapabilities: [],
      validate: makeValidator({ label: 'x' }, { label: strField('x') }),
      migrate: (props, fromVersion) => ({ ...props, label: `${String(props.label)}@${fromVersion}` }),
    });

    const migrated = migrateWidget({ kind: 'test-migrate', version: 1, props: { label: 'a' } });
    expect(migrated.version).toBe(2);
    expect(migrated.props.label).toBe('a@1');
  });

  it('preserves unknown widget kinds', () => {
    const instance = { kind: 'not-registered', version: 3, props: { a: 1 } };
    expect(migrateWidget(instance)).toBe(instance);
  });

  it('leaves up-to-date widgets untouched', () => {
    const instance = { kind: 'text', version: 1, props: { text: 'Hi' } };
    expect(migrateWidget(instance)).toBe(instance);
  });
});
