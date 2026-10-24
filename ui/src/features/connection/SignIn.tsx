import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { ApiRequestError, describeError, signIn } from '../../api/client';

// Shown once per device. After sign-in the brain sets a long-lived cookie, so reloads
// and the installed app stay signed in; the token is not kept by the app.
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [token, setToken] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSigningIn(true);
    setFeedback(null);
    try {
      await signIn({ token: token.trim() });
      onSignedIn();
    } catch (error) {
      setFeedback(error instanceof ApiRequestError && error.status === 401
        ? 'That token does not match. Copy the whole contents of data/web-token.'
        : describeError(error));
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Sign in</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Paste the contents of <code>data/web-token</code>. You only need to do this once on this device.
        </p>
        <input
          type="password"
          value={token}
          onChange={event => setToken(event.target.value)}
          placeholder="Web token"
          autoComplete="off"
          autoFocus
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <Button type="submit" disabled={signingIn || !token.trim()} className="w-full">
          {signingIn ? 'Signing in…' : 'Sign in'}
        </Button>
        {feedback && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{feedback}</p>}
      </form>
    </main>
  );
}
