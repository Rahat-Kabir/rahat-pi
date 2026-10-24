import { useEffect, useState } from 'react';
import type { WebState } from '@api';

// Subscribes to GET /api/events while signed in. The brain sends the full state on
// connect and on every change, so a reconnect always shows the current durable state.
export function useLiveState(signedIn: boolean, onStreamRefused: () => void) {
  const [state, setState] = useState<WebState | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!signedIn) {
      return;
    }
    const events = new EventSource('/api/events');
    events.onopen = () => setConnected(true);
    // EventSource reconnects by itself after a dropped connection; the brain asks for a
    // retry after one second. A refused one (such as 401) is closed for good instead.
    events.onerror = () => {
      setConnected(false);
      if (events.readyState === EventSource.CLOSED) {
        onStreamRefused();
      }
    };
    events.addEventListener('state', event => {
      setState(JSON.parse(event.data) as WebState);
      setConnected(true);
    });
    return () => events.close();
  }, [signedIn, onStreamRefused]);
  return { state, connected };
}
