import type { Routine } from '@api';
import { Panel } from '../../components/Panel';
import { RoutineCard } from './RoutineCard';
import { routineCountLabel } from './routines';

export function RoutinesView({ routines }: { routines: Routine[] }) {
  return (
    <Panel
      title="Routines"
      actions={<span className="text-xs text-slate-500 dark:text-slate-400">{routineCountLabel(routines.length)}</span>}
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {routines.length === 0
          ? <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">No routines yet. Ask in chat, for example "brief me every day at 08:00".</p>
          : routines.map(routine => <RoutineCard key={routine.id} routine={routine} />)}
      </div>
    </Panel>
  );
}
