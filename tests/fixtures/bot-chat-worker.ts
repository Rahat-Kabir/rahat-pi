import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { watchEvents, type ConversationId } from '@earendil-works/pi-durable';
import { App } from '../../src/harness/app.js';
import { configFromEnv } from '../../src/config.js';

// Crash-test fixture: creates a bot, then submits a message whose scripted tool call
// sleeps inside the sandbox. It reports when that shell has started, so the test can
// SIGKILL this process while the bot's run is busy inside the tool.
const [dataDir] = process.argv.slice(2);
const app = await App.open(configFromEnv({ RAHAT_PI_DATA_DIR: dataDir, RAHAT_PI_OFFLINE: '1' }));
const bot = await app.dispatch({ name: 'createBot', botName: 'Crashy' }) as { id: string; conversationId: number };
const events = await watchEvents(app.harness, bot.conversationId as ConversationId, context);
events.start(async eventBatch => {
  if (eventBatch.some(event => event.type === 'tool_execution_start')) {
    console.log('bot-shell-started');
  }
});
await app.submitMessage('/tool workspace_shell {"command":"sleep 30"}', 'followUp', undefined, bot.id);
app.harness.resume();
// The run is busy until the test kills this process; nothing to clean up afterwards.
setInterval(() => {}, 60000);
