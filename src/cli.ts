import { Command as Commander } from 'commander';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { App, type Command, type Output } from './harness/app.js';
import { formatStats, type Stats } from './harness/stats.js';
import { configFromEnv } from './config.js';
import { remoteCommand, runService } from './main.js';

const config = configFromEnv();
const printOutput: Output = event => {
  if (event.type === 'tool') {
    process.stderr.write(`\n[tool] ${event.text}\n`);
  } else {
    process.stdout.write(event.text);
  }
};
async function invoke(command: Command, output = printOutput) {
  try {
    return await remoteCommand(config, command, output);
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error;
    }
  }
  const app = await App.open(config);
  try {
    return await app.dispatch(command, output);
  } finally {
    await app.close();
  }
}
const program = new Commander().name('rahat-pi').description('Self-hosted personal durable agent');
program.command('chat')
  .option('-m, --message <text>', 'One-shot message')
  .option('--request-id <id>', 'Deduplicate a retried input')
  .action(async options => {
    if (options.message !== undefined) {
      await invoke({ name: 'chat', message: options.message, requestId: options.requestId });
      stdout.write('\n');
      return;
    }
    const terminal = createInterface({ input: stdin, output: stdout });
    try {
      while (true) {
        const message = await terminal.question('You> ');
        if (message === '/exit') {
          break;
        }
        if (!message.trim()) {
          continue;
        }
        await invoke({ name: 'chat', message });
        stdout.write('\n');
      }
    } finally {
      terminal.close();
    }
  });
program.command('stats').option('--json', 'Print structured statistics').action(async options => {
  const stats = await invoke({ name: 'stats' }) as Stats;
  console.log(options.json ? JSON.stringify(stats, null, 2) : formatStats(stats));
});
for (const commandName of ['actions', 'tick', 'state', 'outbox', 'reconcile', 'subagents', 'compact', 'memories'] as const) {
  program.command(commandName).action(async () => {
    console.log(JSON.stringify(await invoke({ name: commandName }), null, 2));
  });
}
for (const commandName of ['approve', 'reject'] as const) {
  program.command(`${commandName} <id>`).action(async actionId => {
    console.log(JSON.stringify(await invoke({ name: commandName, id: actionId }), null, 2));
  });
}
program.command('backup').description('Save a backup of the data folder now').action(async () => {
  console.log(JSON.stringify(await invoke({ name: 'backup' }), null, 2));
});
program.command('health').description('List tasks that stopped running').action(async () => {
  console.log(JSON.stringify(await invoke({ name: 'health' }), null, 2));
});
program.command('retry <taskId>').description('Run a task parked after repeated crashes again').action(async taskId => {
  const parsedTaskId = Number(taskId);
  if (!Number.isSafeInteger(parsedTaskId) || parsedTaskId <= 0) {
    throw new Error('Task id must be a positive whole number');
  }
  console.log(JSON.stringify(await invoke({ name: 'retry', taskId: parsedTaskId }), null, 2));
});
program.command('forget <id>').description('Forget one remembered fact').action(async memoryId => {
  console.log(JSON.stringify(await invoke({ name: 'forget', id: memoryId }), null, 2));
});
program.command('edit <id>')
  .requiredOption('--recipient <recipient>')
  .requiredOption('--body <body>')
  .action(async (actionId, options) => console.log(JSON.stringify(await invoke({
    name: 'edit',
    id: actionId,
    recipient: options.recipient,
    body: options.body,
  }), null, 2)));
program.command('run').alias('start').action(() => runService(config));
program.command('web').description('Run the service with a localhost web UI').action(() => runService(config, true));
program.command('stop').action(() => {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(config.dataDir, 'stop'), 'stop\n', { mode: 0o600 });
  console.log('Stop requested; running work and background tasks will be cancelled.');
});
program.parseAsync().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
