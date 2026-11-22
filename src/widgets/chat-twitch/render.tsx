import type { ReactNode } from 'react';
import { ChatList } from '../chat/ChatList';
import type { WidgetRenderProps } from '../render-contract';
import type { ChatTwitchProps } from './definition';

export function ChatTwitchRender({
  node,
  props,
  style,
  mode,
  width,
  height,
}: WidgetRenderProps<ChatTwitchProps>): ReactNode {
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
