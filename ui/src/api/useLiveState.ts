import { useEffect, useState } from 'react';
import type { WebState } from '@api';

// Subscribes to GET /api/events. The brain sends the full state on connect and on
// every change, so a reconnect always shows the current durable state.
export function useLiveState() {
  const [state, setState] = useState<WebState | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onopen = () => setConnected(true);
    // EventSource reconnects by itself; the brain asks for a retry after one second.
    events.onerror = () => setConnected(false);
    events.addEventListener('state', event => {
      setState(JSON.parse(event.data) as WebState);
      setConnected(true);
    });
    return () => events.close();
  }, []);
  return { state, connected };
}
