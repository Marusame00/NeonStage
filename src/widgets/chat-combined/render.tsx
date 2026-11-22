import type { ReactNode } from 'react';
import { ChatList } from '../chat/ChatList';
import type { WidgetRenderProps } from '../render-contract';
import type { ChatCombinedProps } from './definition';

export function ChatCombinedRender({
  node,
  props,
  style,
  mode,
  width,
  height,
}: WidgetRenderProps<ChatCombinedProps>): ReactNode {
  return (
    <ChatList
      node={node}
      props={props}
      style={style}
      mode={mode}
      width={width}
      height={height}
      demo={false}
      showPlatformIcons={props.showPlatformIcons}
    />
  );
}
