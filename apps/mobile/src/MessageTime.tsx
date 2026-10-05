import React, { memo, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Text } from './FontSize';
import { chatClock } from '../../../packages/client/src/chatPresentation';
import { accessibleMessageTime, formatMessageTime, nextMessageTimeUpdate, validTimestampSeconds, userMessageTime } from './messageTime.ts';

/** User message dates stay fixed; directory and notice times keep their existing behavior. */
export const MessageTime = memo(function MessageTime({ seconds, absolute = false, clockOnly = false }: { seconds?: number; absolute?: boolean; clockOnly?: boolean }) {
  if (clockOnly || absolute) return <Text style={{ color: '#697b90', fontSize: 12 }} accessibilityLabel={validTimestampSeconds(seconds) ? `Sent ${accessibleMessageTime(seconds)}` : 'Time unavailable'}>
    {clockOnly ? chatClock(seconds) : validTimestampSeconds(seconds) ? userMessageTime(seconds, Date.now()) : '—'}
  </Text>;
  return <RelativeMessageTime seconds={seconds} />;
});

/** Isolated from the markdown row/list so relative-time ticks don't re-render either. */
const RelativeMessageTime = memo(function RelativeMessageTime({ seconds }: { seconds?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let active = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (!active) return;
      const delay = nextMessageTimeUpdate(seconds, Date.now());
      if (delay !== null) timer = setTimeout(() => { setNow(Date.now()); schedule(); }, delay);
    };
    const app = AppState.addEventListener('change', state => {
      active = state === 'active';
      if (active) setNow(Date.now());
      schedule();
    });
    setNow(Date.now());
    schedule();
    return () => { if (timer !== undefined) clearTimeout(timer); app.remove(); };
  }, [seconds]);
  return <Text style={{ color: '#697b90', fontSize: 12 }} accessibilityLabel={validTimestampSeconds(seconds) ? `Sent ${accessibleMessageTime(seconds)}` : 'Time unavailable'}>
    {formatMessageTime(seconds, now)}
  </Text>;
});