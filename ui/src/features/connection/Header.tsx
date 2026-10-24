export function Header({ connected, token, onTokenChange }: {
  connected: boolean;
  token: string;
  onTokenChange: (token: string) => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <img src="/app/icon.svg" alt="" className="h-8 w-8" />
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Rahat-PI</h1>
      <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
        {connected ? 'Connected' : 'Reconnecting…'}
      </span>
      <label className="ml-auto flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        Web token
        {/* Kept in memory only; the brain makes a new token on every restart. */}
        <input
          type="password"
          value={token}
          onChange={event => onTokenChange(event.target.value.trim())}
          placeholder="Paste data/web-token"
          autoComplete="off"
          className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </label>
    </header>
  );
}
