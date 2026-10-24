import { useEffect, useRef } from 'react';
import type { WebState } from '@api';
import { Panel } from '../../components/Panel';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { liveAnswer, queuedText, runFailure, transcript } from './messages';
import { describeRunningTool } from './toolCalls';

export function ChatView({ state }: { state: WebState }) {
  const messages = transcript(state);
  const answer = liveAnswer(state);
  const failure = runFailure(state);
  const agentBusy = Boolean(state.live.run);
  const runningTools = (state.live.tools ?? []).filter(tool => tool.status !== 'done');
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, answer?.text, state.inbox.items.length]);

  return (
    <Panel
      title="Chat"
      actions={<span className="text-xs text-slate-500 dark:text-slate-400">{agentBusy ? 'Working…' : 'Idle'}</span>}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && !answer && (
          <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No messages yet. Say hello.</p>
        )}
        {messages.map(message => (
          <div key={message.key} className="flex"><MessageBubble message={message} /></div>
        ))}
        {answer && <div className="flex"><MessageBubble message={answer} live /></div>}
        {runningTools.map(tool => (
          <p key={tool.callId} className="text-xs text-slate-500 dark:text-slate-400">
            {describeRunningTool(tool.name)}
          </p>
        ))}
        {state.inbox.items.map(item => (
          <div key={item.id} className="ml-auto max-w-[85%] rounded-2xl border border-dashed border-indigo-300 px-4 py-2 text-sm text-slate-600 dark:border-indigo-800 dark:text-slate-300">
            <span className="block text-xs text-slate-400">{item.mode === 'steer' ? 'Steering' : 'Queued'}</span>
            <span className="whitespace-pre-wrap wrap-anywhere">{queuedText(item)}</span>
          </div>
        ))}
        {failure && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{failure}</p>}
        <div ref={bottom} />
      </div>
      <Composer agentBusy={agentBusy} />
    </Panel>
  );
}
