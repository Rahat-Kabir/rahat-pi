// Free, offline walkthrough of the core guarantees. No API key, no network, any OS.
// Uses the scripted faux model in a throwaway data folder that is deleted at the end.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from '../src/harness/app.js';
import { configFromEnv } from '../src/config.js';
import type { Action } from '../src/harness/state.js';

const demoDataDir = mkdtempSync(join(tmpdir(), 'rahat-pi-demo-'));
const config = configFromEnv({
  RAHAT_PI_OFFLINE: '1',
  RAHAT_PI_DATA_DIR: demoDataDir,
  RAHAT_PI_OWNER_NAME: 'Demo Owner',
  RAHAT_PI_TIMEZONE: 'UTC',
});

function step(number: number, title: string) {
  console.log(`\n${number}. ${title}`);
}
function show(detail: string) {
  console.log(`   ${detail}`);
}

// In offline mode the reply is the tool result itself: [{ type: 'text', text: '<JSON>' }].
async function callTool(app: App, toolName: string, toolArguments: object): Promise<unknown> {
  const { reply } = await app.dispatch({
    name: 'chat',
    message: `/tool ${toolName} ${JSON.stringify(toolArguments)}`,
  }) as { reply: string };
  return JSON.parse(JSON.parse(reply)[0].text);
}
async function outboxCount(app: App) {
  return (await app.dispatch({ name: 'outbox' }) as unknown[]).length;
}
async function readAction(app: App, actionId: string) {
  const actions = await app.dispatch({ name: 'actions' }) as Action[];
  return actions.find(action => action.id === actionId)!;
}

async function main() {
  console.log('Rahat-PI offline demo (scripted fake model, no API key, nothing leaves this computer)');
  let app = await App.open(config);
  try {
    step(1, 'Remember a fact');
    const memory = await callTool(app, 'memory_write', { content: 'Demo Owner prefers tea', source: 'owner:demo' }) as {
      content: string;
      source: string;
    };
    show(`saved "${memory.content}" (source: ${memory.source})`);

    step(2, 'Restart the agent');
    await app.close();
    app = await App.open(config);
    show('closed and reopened the same data folder');

    step(3, 'Recall the fact after the restart');
    const recalled = await callTool(app, 'memory_search', { query: 'tea' }) as { content: string }[];
    show(`memory_search "tea" found: ${recalled.map(fact => `"${fact.content}"`).join(', ')}`);

    step(4, 'The model proposes a message (it cannot send it)');
    const proposal = await callTool(app, 'propose_send_message', { recipient: 'fixture:sam', body: "I'll be 10 minutes late." }) as Action;
    show(`action ${proposal.id}: status "${proposal.status}", payload hash ${proposal.payloadHash.slice(0, 12)}...`);

    step(5, 'Run the executor before approval');
    await app.dispatch({ name: 'tick' });
    show(`outbox messages: ${await outboxCount(app)} (nothing is sent without approval)`);

    step(6, 'Approval is bound to the exact text');
    try {
      await app.dispatch({ name: 'approve', id: proposal.id, payloadHash: 'a-hash-the-owner-never-saw' });
    } catch (error) {
      show(`approving with a different hash is refused: "${(error as Error).message}"`);
    }
    await app.dispatch({ name: 'approve', id: proposal.id, payloadHash: proposal.payloadHash });
    show(`approved with the displayed hash; status "${(await readAction(app, proposal.id)).status}"`);

    step(7, 'Run the executor: the message is sent once');
    await app.dispatch({ name: 'tick' });
    const sentAction = await readAction(app, proposal.id);
    show(`status "${sentAction.status}", receipt ${sentAction.providerReceipt}, outbox messages: ${await outboxCount(app)}`);

    step(8, 'Run the executor again: no duplicate');
    await app.dispatch({ name: 'tick' });
    show(`outbox messages: ${await outboxCount(app)} (still one)`);

    console.log('\nDone. The fake outbox stands in for real sends; crash-and-restart safety is');
    console.log('proven by the SIGKILL tests (`npm run test:crash`, Linux).');
    console.log('To chat with a real model: copy .env.example to .env, set OPENROUTER_API_KEY,');
    console.log('then run `npm run cli -- chat`.');
  } finally {
    await app.close();
    rmSync(demoDataDir, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
