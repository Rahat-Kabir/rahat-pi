import type { DisplayMessage } from './messages';

const styles: Record<DisplayMessage['role'], string> = {
  user: 'ml-auto bg-indigo-600 text-white',
  assistant: 'mr-auto bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
  tool: 'mr-auto border border-dashed border-slate-300 bg-transparent font-mono text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400',
  other: 'mr-auto bg-transparent text-xs text-slate-500',
};

// Text only: React escapes it, so model output can never become HTML or a button.
export function MessageBubble({ message, live = false }: { message: DisplayMessage; live?: boolean }) {
  const bubbleStyle = `max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-2xl px-4 py-2 text-sm ${styles[message.role]}`;
  if (message.role === 'tool') {
    // Tool output is often long JSON: closed by default.
    return (
      <details className={bubbleStyle}>
        <summary className="cursor-pointer font-sans font-medium">Tool result</summary>
        <div className="mt-1">{message.text}</div>
      </details>
    );
  }
  return <div className={`${bubbleStyle} ${live ? 'animate-pulse' : ''}`}>{message.text}</div>;
}
