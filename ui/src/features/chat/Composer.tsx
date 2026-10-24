import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';
import { describeError, sendMessage } from '../../api/client';
import { nextPendingMessage, type PendingMessage, type WhenBusy } from './pendingMessage';

export function Composer({ agentBusy }: { agentBusy: boolean }) {
  const [draft, setDraft] = useState('');
  const [whenBusy, setWhenBusy] = useState<WhenBusy>('followUp');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  // Kept across failed attempts so a retry of the same text reuses its request ID.
  const pendingMessage = useRef<PendingMessage | undefined>(undefined);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = draft.trim();
    if (!message || sending) {
      return;
    }
    setSending(true);
    setFeedback(null);
    pendingMessage.current = nextPendingMessage(pendingMessage.current, message, whenBusy, () => crypto.randomUUID());
    try {
      await sendMessage(pendingMessage.current);
      pendingMessage.current = undefined;
      setDraft(current => current.trim() === message ? '' : current);
    } catch (error) {
      setFeedback(`${describeError(error)} Sending again is safe; it will not be duplicated.`);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-800">
      <textarea
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        maxLength={16000}
        placeholder="Message Rahat-PI… (Enter to send, Shift+Enter for a new line)"
        className="w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
      <div className="flex items-center justify-between gap-2">
        {agentBusy ? (
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            While it works:
            <select
              value={whenBusy}
              onChange={event => setWhenBusy(event.target.value as WhenBusy)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="followUp">Ask next</option>
              <option value="steer">Steer now</option>
            </select>
          </label>
        ) : <span />}
        <Button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</Button>
      </div>
      {feedback && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{feedback}</p>}
    </form>
  );
}
