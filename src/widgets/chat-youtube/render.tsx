import type { ReactNode } from 'react';
import { ChatList } from '../chat/ChatList';
import type { WidgetRenderProps } from '../render-contract';
import type { ChatYouTubeProps } from './definition';

export function ChatYouTubeRender({
  node,
  props,
  style,
  mode,
  width,
  height,
}: WidgetRenderProps<ChatYouTubeProps>): ReactNode {
  return (
    <ChatList
      node={node}
      props={props}
      style={style}
      mode={mode}
      width={width}
      height={height}
      demo={props.source === 'demo'}
      showPlatformIcons={false}
    />
  );
}
