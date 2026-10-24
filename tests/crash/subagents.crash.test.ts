import { describe, expect, it } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ConversationId } from '@earendil-works/pi-durable';
import { App } from '../../src/harness/app.js';
import { AppDoc } from '../../src/harness/state.js';
import { SubagentsDoc } from '../../src/extensions/subagents.js';
import { cli, offlineConfig, temporaryData, toolMessage } from '../helpers.js';

describe('subagent SIGKILL recovery', () => {
  it.each(['subagent_started', 'subagent_finished_before_delivery'])(
    'delivers exactly one child result after %s and repeated restarts',
    async crashPoint => {
      const temporaryStorage = temporaryData();
      const message = toolMessage('subagent_run', { task: 'crash recovery answer', title: 'Crash test' });
      const commandArguments = ['chat', '--message', message, '--request-id', 'child-crash-check'];
      try {
        const crashedCommand = await cli(temporaryStorage.dataDir, commandArguments, { RAHAT_PI_CRASH_AT: crashPoint });
        expect(crashedCommand.signal).toBe('SIGKILL');
        const inspection = await App.open(offlineConfig(temporaryStorage.dataDir));
        try {
          const subagentRuns = Object.values((await inspection.harness.snapshot(SubagentsDoc, context))!.runs);
          expect(subagentRuns).toHaveLength(1);
          const state = (await inspection.harness.snapshot(AppDoc, context))!;
          expect(Object.values(state.budgets).filter(runBudget => runBudget.conversationId === subagentRuns[0].conversationId)).toHaveLength(1);
          expect(subagentRuns[0].answer).toBe(crashPoint === 'subagent_started' ? null : 'Offline reply: crash recovery answer');
        } finally {
          await inspection.close();
        }
        for (let restartNumber = 0; restartNumber < 2; restartNumber++) {
          const recoveredCommand = await cli(temporaryStorage.dataDir, commandArguments);
          expect(recoveredCommand.code).toBe(0);
          expect(recoveredCommand.stdout).toContain('Offline reply: crash recovery answer');
        }
        const app = await App.open(offlineConfig(temporaryStorage.dataDir));
        try {
          const subagentRuns = Object.values((await app.harness.snapshot(SubagentsDoc, context))!.runs);
          expect(subagentRuns).toHaveLength(1);
          const parentEntries = await app.harness.commit(transaction => transaction.scanEntries({ conversationId: app.root.id }, 100), context);
          const toolResults = parentEntries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'subagent_run');
          expect(toolResults).toHaveLength(1);
          expect(JSON.stringify(toolResults[0])).toContain('Offline reply: crash recovery answer');
          const childId = subagentRuns[0].conversationId as ConversationId;
          const childEntries = await app.harness.commit(transaction => transaction.scanEntries({ conversationId: childId }, 100), context);
          const childInputs = childEntries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user');
          expect(childInputs).toHaveLength(1);
          expect(await app.dispatch({ name: 'subagents' })).toMatchObject([{ status: 'completed' }]);
        } finally {
          await app.close();
        }
      } finally {
        temporaryStorage.cleanup();
      }
    },
  );
  it.each(['subagent_started', 'subagent_finished_before_delivery'])(
    'preserves the deadline and any saved answer after an overdue restart at %s',
    async crashPoint => {
      const temporaryStorage = temporaryData();
      const message = toolMessage('subagent_run', { task: 'deadline recovery answer' });
      const requestId = 'deadline-crash-check';
      const initialClock = { RAHAT_PI_NOW: '2026-10-24T00:00:00Z', RAHAT_PI_MAX_RUN_MS: '300000' };
      try {
        const crashedCommand = await cli(temporaryStorage.dataDir, ['chat', '--message', message, '--request-id', requestId], {
          ...initialClock,
          RAHAT_PI_CRASH_AT: crashPoint,
        });
        expect(crashedCommand.signal).toBe('SIGKILL');
        const app = await App.open(offlineConfig(temporaryStorage.dataDir, {
          ...initialClock,
          RAHAT_PI_NOW: '2026-10-24T00:01:40Z',
        }));
        try {
          // Let the watchdog enforce the persisted child deadline before resuming the parent.
          await new Promise(resolve => setTimeout(resolve, 150));
          const response = await app.dispatch({ name: 'chat', message, requestId });
          if (crashPoint === 'subagent_finished_before_delivery') {
            expect(JSON.stringify(response)).toContain('Offline reply: deadline recovery answer');
          } else {
            expect(JSON.stringify(response)).toMatch(/abort|cap/i);
          }
          const subagentRuns = Object.values((await app.harness.snapshot(SubagentsDoc, context))!.runs);
          expect(subagentRuns).toHaveLength(1);
          const parentEntries = await app.harness.commit(transaction => transaction.scanEntries({ conversationId: app.root.id }, 100), context);
          const toolResults = parentEntries.items.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'subagent_run');
          expect(toolResults).toHaveLength(1);
        } finally {
          await app.close();
        }
      } finally {
        temporaryStorage.cleanup();
      }
    },
  );

});
