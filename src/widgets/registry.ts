import type { WidgetDefinition } from './contract';
import { textWidget } from './text/definition';
import { shapeWidget } from './shape/definition';
import { frameWidget } from './frame/definition';
import { timerWidget } from './timer/definition';
import { clockWidget } from './clock/definition';
import { goalWidget } from './goal/definition';
import { tickerWidget } from './ticker/definition';
import { chatTwitchWidget } from './chat-twitch/definition';
import { chatYouTubeWidget } from './chat-youtube/definition';
import { chatCombinedWidget } from './chat-combined/definition';
import { imageWidget } from './image/definition';

const registry = new Map<string, WidgetDefinition<Record<string, unknown>>>();

export function registerWidget<P extends Record<string, unknown>>(definition: WidgetDefinition<P>): void {
  registry.set(definition.kind, definition as unknown as WidgetDefinition<Record<string, unknown>>);
}

export function getWidget(kind: string): WidgetDefinition<Record<string, unknown>> | undefined {
  return registry.get(kind);
}

export function listWidgets(): WidgetDefinition<Record<string, unknown>>[] {
  return [...registry.values()];
}

for (const definition of [
  textWidget,
  shapeWidget,
  frameWidget,
  timerWidget,
  clockWidget,
  goalWidget,
  tickerWidget,
  chatTwitchWidget,
  chatYouTubeWidget,
  chatCombinedWidget,
  imageWidget,
] as WidgetDefinition<Record<string, unknown>>[]) {
  registerWidget(definition);
}

export const WIDGET_KINDS: readonly string[] = listWidgets().map((definition) => definition.kind);
