import type { WidgetRenderer } from './render-contract';
import { TextRender } from './text/render';
import { ShapeRender } from './shape/render';
import { FrameRender } from './frame/render';
import { TimerRender } from './timer/render';
import { ClockRender } from './clock/render';
import { GoalRender } from './goal/render';
import { TickerRender } from './ticker/render';
import { ImageRender } from './image/render';
import { ChatTwitchRender } from './chat-twitch/render';
import { ChatYouTubeRender } from './chat-youtube/render';
import { ChatCombinedRender } from './chat-combined/render';

export type { WidgetRenderProps, WidgetRenderer } from './render-contract';

const renderers: Record<string, WidgetRenderer<Record<string, unknown>>> = {
  text: TextRender as unknown as WidgetRenderer<Record<string, unknown>>,
  shape: ShapeRender as unknown as WidgetRenderer<Record<string, unknown>>,
  frame: FrameRender as unknown as WidgetRenderer<Record<string, unknown>>,
  timer: TimerRender as unknown as WidgetRenderer<Record<string, unknown>>,
  clock: ClockRender as unknown as WidgetRenderer<Record<string, unknown>>,
  goal: GoalRender as unknown as WidgetRenderer<Record<string, unknown>>,
  ticker: TickerRender as unknown as WidgetRenderer<Record<string, unknown>>,
  image: ImageRender as unknown as WidgetRenderer<Record<string, unknown>>,
  'chat-twitch': ChatTwitchRender as unknown as WidgetRenderer<Record<string, unknown>>,
  'chat-youtube': ChatYouTubeRender as unknown as WidgetRenderer<Record<string, unknown>>,
  'chat-combined': ChatCombinedRender as unknown as WidgetRenderer<Record<string, unknown>>,
};

export function getRenderer(kind: string): WidgetRenderer<Record<string, unknown>> | undefined {
  return renderers[kind];
}
