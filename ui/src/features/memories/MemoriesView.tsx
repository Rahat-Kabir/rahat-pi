import type { Memory } from '@api';
import { Panel } from '../../components/Panel';
import { MemoryCard } from './MemoryCard';
import { memoryCountLabel } from './memories';

export function MemoriesView({ memories }: { memories: Memory[] }) {
  return (
    <Panel
      title="Memories"
      actions={<span className="text-xs text-slate-500 dark:text-slate-400">{memoryCountLabel(memories.length)}</span>}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {memories.length === 0
          ? <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">Nothing remembered yet. Ask in chat, for example "remember that I prefer tea".</p>
          : memories.map(memory => <MemoryCard key={memory.id} memory={memory} />)}
      </div>
    </Panel>
  );
}
