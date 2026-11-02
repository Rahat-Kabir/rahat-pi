import { describe, expect, it } from 'vitest';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { App } from '../src/harness/app.js';
import { AppDoc, type Routine } from '../src/harness/state.js';
import { captureRoutineReport, composeBriefingPrompt } from '../src/extensions/routines.js';
import { offlineConfig, temporaryData, toolMessage } from './helpers.js';

// Tests pin Etc/GMT-6 (UTC+6): local 06:10 is 00:10 UTC, so the run is due between
// the first and second fixed clock times below.
const initialTime = '2026-11-02T00:05:00Z';
const laterTime = '2026-11-02T00:15:00Z';
const nextDayTime = '2026-11-03T00:15:00Z';

// A routine created in a bot's chat through the normal tool path. Waits for the
// finished turn, not just the routine record: closing mid-turn would leave the
// conversation busy, and the next briefing input would queue behind it forever.
async function createBotRoutine(app: App, botId: string) {
  await app.submitMessage(
    toolMessage('routine_create', { name: 'Bot briefing', prompt: 'Summarize the night.', time: '06:10', missedRunPolicy: 'catchUpOnce' }),
    'followUp',
    undefined,
    botId,
  );
  await expectEventually(async () => {
    expect(Object.values((await app.harness.snapshot(AppDoc, context))!.routines)).toHaveLength(1);
    const conversationId = await botConversationId(app, botId);
    const entries = await app.harness.commit(
      transaction => transaction.scanEntries({ conversationId: conversationId as never }, 10),
      context,
    );
    const newest = entries.items[0];
    const newestText = JSON.stringify(newest?.model ?? []);
    expect(newest?.kind).toBe('pi.assistant');
    expect(newestText).toContain('Bot briefing');
    expect(newestText).not.toBe('"text":""');
  });
}

// The bot's conversation id, looked up through the registry the app exposes.
async function botConversationId(app: App, botId: string) {
  return (await app.listBots()).find(bot => bot.id === botId)!.conversationId;
}

// vi.waitFor with the project's default polling, named for what it waits for.
async function expectEventually(assertion: () => Promise<void>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  await assertion();
}

async function botConversationEntries(app: App, conversationId: number) {
  return await app.harness.commit(
    transaction => transaction.scanEntries({ conversationId: conversationId as never }, 100),
    context,
  );
}

describe('routines per bot', () => {
  it('composes prompts from the last report and treats a last-line "Nothing new" as no report', () => {
    expect(composeBriefingPrompt({ prompt: 'Brief me.', lastReport: null })).toBe('Brief me.');
    expect(composeBriefingPrompt({ prompt: 'Brief me.', lastReport: undefined })).toBe('Brief me.');
    const withReport = composeBriefingPrompt({ prompt: 'Brief me.', lastReport: 'Two mentions.' });
    expect(withReport).toContain("Previous run's report (may be outdated):\nTwo mentions.");
    expect(withReport).toContain('Brief me.');
    expect(withReport).toContain('Nothing new');
    expect(captureRoutineReport('All quiet.\nNothing new')).toBeNull();
    expect(captureRoutineReport('Nothing new')).toBeNull();
    expect(captureRoutineReport('Real findings here.')).toBe('Real findings here.');
    expect(captureRoutineReport('x'.repeat(3000))).toHaveLength(2000);
  });

  it('delivers a bot routine into its own bot chat, across restart and pause/resume', async () => {
    const temporaryStorage = temporaryData();
    const botId = await (async () => {
      const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_NOW: initialTime }));
      try {
        const bot = await app.dispatch({ name: 'createBot', botName: 'Researcher' }) as { id: string; conversationId: number };
        await createBotRoutine(app, bot.id);
        return { id: bot.id, conversationId: bot.conversationId };
      } finally {
        await app.close();
      }
    })();
    try {
      // Restart after the scheduled time: startBackground recreates the task, and it
      // must report into the bot's conversation, not the root.
      const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_NOW: laterTime }));
      try {
        await app.dispatch({ name: 'tick' });
        const botEntries = await botConversationEntries(app, botId.conversationId);
        const botText = JSON.stringify(botEntries.items.flatMap(entry => entry.model ?? []));
        expect(botText).toContain('Daily briefing');
        expect(botText).toContain('Summarize the night.');
        const rootEntries = await botConversationEntries(app, app.root.id as never);
        expect(JSON.stringify(rootEntries.items.flatMap(entry => entry.model ?? []))).not.toContain('Daily briefing');
        const routine = Object.values((await app.harness.snapshot(AppDoc, context))!.routines)[0];
        expect(routine.botId).toBe(botId.id);
        // The first run's answer is captured as the report the next run starts from.
        expect(routine.lastReport).toContain('Summarize the night.');

        // Pause and resume keep the routine in the bot's conversation.
        await app.dispatch({ name: 'pauseRoutine', id: routine.id });
        await app.dispatch({ name: 'resumeRoutine', id: routine.id });
      } finally {
        await app.close();
      }
      const resumed = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_NOW: nextDayTime }));
      try {
        await resumed.dispatch({ name: 'tick' });
        const botEntries = await botConversationEntries(resumed, botId.conversationId);
        const inputs = botEntries.items
          .flatMap(entry => entry.model ?? [])
          .filter(message => message.role === 'user' && JSON.stringify(message.content).includes('Daily briefing'))
          .map(message => JSON.stringify(message.content));
        expect(inputs).toHaveLength(2);
        // Newest first: the second run starts from the first run's report and offers the quiet answer.
        expect(inputs[0]).toContain("Previous run's report (may be outdated):");
        const rootEntries = await botConversationEntries(resumed, resumed.root.id as never);
        expect(JSON.stringify(rootEntries.items.flatMap(entry => entry.model ?? []))).not.toContain('Daily briefing');
        // The faux model echoes the composed prompt as one line, so its last line is
        // not exactly "Nothing new"; the quiet rule's null case is unit-tested above.
        // Here the second run's answer is captured verbatim as the next report.
        const routine = Object.values((await resumed.harness.snapshot(AppDoc, context))!.routines)[0];
        expect(routine.lastReport).toContain('1793664600000');
      } finally {
        await resumed.close();
      }
    } finally {
      temporaryStorage.cleanup();
    }
  });

  it('schedules for another bot by name from the default chat', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_NOW: initialTime }));
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Coder' }) as { id: string; conversationId: number };
      await app.dispatch({
        name: 'chat',
        message: toolMessage('routine_create', { name: 'Build check', prompt: 'Check the build.', time: '07:30', missedRunPolicy: 'skip', bot: 'Coder' }),
      });
      const routine = Object.values((await app.harness.snapshot(AppDoc, context))!.routines)[0] as Routine;
      expect(routine.botId).toBe(bot.id);
      const listed = await app.dispatch({ name: 'routines' }) as { botName: string }[];
      expect(listed).toMatchObject([{ name: 'Build check', botName: 'Coder' }]);
      // The routine stores botId, not the raw "bot" argument it was resolved from.
      expect(listed[0]).not.toHaveProperty('bot');
      // An unknown bot name is refused, not silently aimed at the default bot.
      await app.dispatch({
        name: 'chat',
        message: toolMessage('routine_create', { name: 'Bad', prompt: 'x', time: '07:30', missedRunPolicy: 'skip', bot: 'Nobody' }),
      });
      const routines = Object.values((await app.harness.snapshot(AppDoc, context))!.routines);
      expect(routines).toHaveLength(1);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('deleting a bot disables its routines', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_NOW: initialTime }));
    try {
      const bot = await app.dispatch({ name: 'createBot', botName: 'Shortlived' }) as { id: string };
      await createBotRoutine(app, bot.id);
      await app.dispatch({ name: 'deleteBot', id: bot.id });
      const state = await app.harness.snapshot(AppDoc, context);
      const routine = Object.values(state!.routines)[0];
      expect(routine.deleted).toBe(true);
      expect(routine.enabled).toBe(false);
      expect(await app.dispatch({ name: 'routines' })).toEqual([]);
      // The watchdog releases the disabled routine's sleeping task.
      await expectEventually(async () => {
        const stoppedTask = await app.harness.getTask(routine.taskId as never, context);
        expect(stoppedTask?.state.status).toBe('terminal');
      });
      // Recreating the background tasks must not resurrect a routine of a deleted bot:
      // the routine keeps its stopped task and gains no new one.
      await app.startBackground();
      const stateAfterRestart = await app.harness.snapshot(AppDoc, context);
      expect(Object.values(stateAfterRestart!.routines)[0].taskId).toBe(routine.taskId);
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });

  it('keeps existing default-chat routines on the default bot', async () => {
    const temporaryStorage = temporaryData();
    const app = await App.open(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_NOW: '2026-11-02T00:05:00Z' }));
    try {
      await app.dispatch({
        name: 'chat',
        message: toolMessage('routine_create', { name: 'Main briefing', prompt: 'Brief me.', time: '07:00', missedRunPolicy: 'skip' }),
      });
      const routine = Object.values((await app.harness.snapshot(AppDoc, context))!.routines)[0];
      expect(routine.botId).toBe('main');
      const listed = await app.dispatch({ name: 'routines' }) as { botName: string }[];
      expect(listed[0].botName).toBe('Rahat-PI');
    } finally {
      await app.close();
      temporaryStorage.cleanup();
    }
  });
});
