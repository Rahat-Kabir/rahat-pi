export function Header({ connected }: { connected: boolean }) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <img src="/app/icon.svg" alt="" className="h-8 w-8" />
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Rahat-PI</h1>
      <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
        {connected ? 'Connected' : 'Reconnecting…'}
      </span>
    </header>
  );
}
