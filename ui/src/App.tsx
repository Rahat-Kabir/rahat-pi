import { useState } from 'react';
import { useLiveState } from './api/useLiveState';
import { Header } from './features/connection/Header';
import { ChatView } from './features/chat/ChatView';
import { ApprovalsPanel } from './features/approvals/ApprovalsPanel';

export function App() {
  const { state, connected } = useLiveState();
  const [token, setToken] = useState('');

  return (
    <div className="flex h-dvh flex-col bg-slate-50 dark:bg-slate-950">
      <Header connected={connected} token={token} onTokenChange={setToken} />
      {state ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:overflow-hidden">
          <div className="flex min-h-[70vh] flex-col lg:min-h-0 [&>section]:flex-1">
            <ChatView state={state} token={token} />
          </div>
          <div className="flex min-h-0 flex-col [&>section]:flex-1">
            <ApprovalsPanel actions={state.actions} token={token} />
          </div>
        </main>
      ) : (
        <p className="p-8 text-center text-sm text-slate-500">Connecting to Rahat-PI…</p>
      )}
    </div>
  );
}
