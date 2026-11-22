import type { ComponentType } from 'react';
import type { NodeStyle } from '../shared/model';
import type { OutputNode } from '../shared/output';

export interface WidgetRenderProps<P extends Record<string, unknown> = Record<string, unknown>> {
  node: OutputNode;
  props: P;
  style: NodeStyle;
  mode: 'editor' | 'output';
  width: number;
  height: number;
}

export type WidgetRenderer<P extends Record<string, unknown>> = ComponentType<WidgetRenderProps<P>>;
