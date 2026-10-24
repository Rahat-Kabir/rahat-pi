import { useCallback, useEffect, useRef, useState } from 'react';
import { checkSignedIn } from './api/client';
import { useLiveState } from './api/useLiveState';
import { Header } from './features/connection/Header';
import { SignIn } from './features/connection/SignIn';
import { ChatView } from './features/chat/ChatView';
import { ApprovalsBanner } from './features/approvals/ApprovalsBanner';
import { ApprovalsPanel } from './features/approvals/ApprovalsPanel';
import { waitingCount } from './features/approvals/approvals';

type SignInStatus = 'checking' | 'signedOut' | 'signedIn';
const recheckDelayMs = 2000;

export function App() {
  const [signInStatus, setSignInStatus] = useState<SignInStatus>('checking');
  // Bumped to ask the brain again when it could not be reached.
  const [checkAttempt, setCheckAttempt] = useState(0);
  useEffect(() => {
    if (signInStatus !== 'checking') {
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    checkSignedIn().then(
      signedIn => {
        if (!cancelled) {
          setSignInStatus(signedIn ? 'signedIn' : 'signedOut');
        }
      },
      // The brain may be restarting; ask again shortly.
      () => {
        if (!cancelled) {
          retryTimer = setTimeout(() => setCheckAttempt(attempt => attempt + 1), recheckDelayMs);
        }
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [signInStatus, checkAttempt]);
  // A refused live stream usually means the sign-in is no longer valid, so check again.
  const recheckSignIn = useCallback(() => setSignInStatus('checking'), []);
  const { state, connected } = useLiveState(signInStatus === 'signedIn', recheckSignIn);
  const approvals = useRef<HTMLDivElement>(null);
  const waiting = state ? waitingCount(state.actions) : 0;

  return (
    <div className="flex h-dvh flex-col bg-slate-50 dark:bg-slate-950">
      <Header connected={signInStatus === 'signedIn' && connected} />
      {signInStatus === 'signedOut' && <SignIn onSignedIn={() => setSignInStatus('signedIn')} />}
      {signInStatus === 'checking' && <p className="p-8 text-center text-sm text-slate-500">Connecting to Rahat-PI…</p>}
      {signInStatus === 'signedIn' && state && (
        <ApprovalsBanner waiting={waiting} onReview={() => approvals.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      )}
      {signInStatus === 'signedIn' && (state ? (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:overflow-hidden">
          <div className="flex min-h-[70vh] flex-col lg:min-h-0 [&>section]:flex-1">
            <ChatView state={state} />
          </div>
          {/* On a phone, approvals waiting for the owner go above the chat; a long history scrolls inside. */}
          <div ref={approvals} className={`flex max-h-[60vh] min-h-0 scroll-mt-4 flex-col lg:max-h-none [&>section]:flex-1 ${waiting > 0 ? 'order-first lg:order-none' : ''}`}>
            <ApprovalsPanel actions={state.actions} />
          </div>
        </main>
      ) : (
        <p className="p-8 text-center text-sm text-slate-500">Connecting to Rahat-PI…</p>
      ))}
    </div>
  );
}
