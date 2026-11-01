import { useState, type FormEvent } from 'react';
import type { Bot } from '@api';
import { Button } from '../../components/Button';
import { createBot, describeError } from '../../api/client';

// Switches the chat between bots and creates new ones. Deleting a bot stays an owner
// CLI command (`npm run cli -- bot delete <id>`); its conversation history stays stored.
export function BotSwitcher({ bots, selectedId, onSelect }: {
  bots: Bot[];
  selectedId: string | undefined;
  onSelect: (botId: string | undefined) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || creating) {
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      const bot = await createBot({ name: trimmedName });
      onSelect(bot.id);
      setName('');
      setNaming(false);
    } catch (error) {
      setFeedback(describeError(error));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-1">
      <nav className="flex flex-wrap items-center gap-1" aria-label="Bots">
        {bots.map(bot => (
          <button
            key={bot.id}
            type="button"
            onClick={() => onSelect(bot.id === bots[0]?.id ? undefined : bot.id)}
            aria-current={selectedId === bot.id ? 'true' : undefined}
            className={`rounded-full px-3 py-1 text-xs font-medium ${selectedId === bot.id
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-600 shadow-sm hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white'}`}
          >
            {bot.name}
          </button>
        ))}
        {!naming && (
          <button type="button" onClick={() => setNaming(true)} className="rounded-full px-2 py-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            + New bot
          </button>
        )}
      </nav>
      {naming && (
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={name}
            onChange={event => setName(event.target.value)}
            maxLength={40}
            placeholder="New bot name"
            aria-label="New bot name"
            className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <Button type="submit" disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create'}</Button>
          <Button type="button" onClick={() => { setNaming(false); setFeedback(null); }}>Cancel</Button>
        </form>
      )}
      {feedback && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{feedback}</p>}
    </div>
  );
}
