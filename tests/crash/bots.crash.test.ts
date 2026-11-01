import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { ConversationId } from '@earendil-works/pi-durable';
import { App } from '../../src/harness/app.js';
import { BotsDoc } from '../../src/harness/bots.js';
import { offlineConfig, temporaryData } from '../helpers.js';

// Spawns the bot-chat fixture and resolves once the bot's run is inside the sleeping
// shell command, so the SIGKILL lands mid-tool, not before or after the run.
function startBusyBotChat(dataDir: string) {
  const worker = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/bot-chat-worker.ts', dataDir], {
    cwd: resolve('.'),
    env: { ...process.env, OPENROUTER_API_KEY: '', RAHAT_PI_OFFLINE: '1', RAHAT_PI_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  worker.stderr.on('data', chunk => {
    stderr += chunk;
  });
  return new Promise<{ worker: typeof worker; stderr: () => string }>((resolveWorker, rejectWorker) => {
    worker.stdout.on('data', chunk => {
      if (String(chunk).includes('bot-shell-started')) {
        resolveWorker({ worker, stderr: () => stderr });
      }
    });
    worker.once('error', rejectWorker);
    worker.once('close', () => rejectWorker(new Error(`Bot chat worker exited before the shell started: ${stderr}`)));
  });
}

describe('bot chat SIGKILL recovery', () => {
  it('resumes a run cut off inside a bot tool once, without rerunning the interrupted command', async () => {
    const temporaryStorage = temporaryData();
    try {
      const { worker } = await startBusyBotChat(temporaryStorage.dataDir);
      // The shell sleeps 30 s; kill well inside it, after it has certainly started.
      await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
      worker.kill('SIGKILL');
      await new Promise(resolveClose => worker.once('close', resolveClose));

      const app = await App.open(offlineConfig(temporaryStorage.dataDir));
      try {
        app.harness.resume();
        // The interrupted `sleep 30` is reported, not rerun, so the run settles quickly.
        await app.harness.waitForIdle(context);
        const bots = Object.values((await app.harness.snapshot(BotsDoc, context))!.bots);
        expect(bots.map(bot => bot.name)).toEqual(['Rahat-PI', 'Crashy']);
        const botConversationId = bots.find(bot => bot.name === 'Crashy')!.conversationId as ConversationId;
        const entries = await app.harness.commit(
          transaction => transaction.scanEntries({ conversationId: botConversationId }, 100),
          context,
        );
        const messages = entries.items.flatMap(entry => entry.model ?? []);
        expect(messages.filter(message => message.role === 'user')).toHaveLength(1);
        const shellCalls = messages.flatMap(message =>
          message.role === 'assistant'
            ? message.content.filter(block => block.type === 'toolCall' && block.name === 'workspace_shell')
            : []
        );
        expect(shellCalls).toHaveLength(1);
        const shellResults = messages.filter(message => message.role === 'toolResult' && message.toolName === 'workspace_shell');
        expect(shellResults).toHaveLength(1);
        // Pi reports the interrupted unsafe replay instead of a second sleep's output.
        expect(JSON.stringify(shellResults)).toMatch(/interrupt/i);
      } finally {
        await app.close();
      }
    } finally {
      temporaryStorage.cleanup();
    }
  });
});
