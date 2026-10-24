import { App } from '../../src/harness/app.js';
import { configFromEnv } from '../../src/config.js';

// Opens the app, lets Pi resume unfinished work for a moment, then closes. Unlike the
// CLI commands, it never waits for the agent to become idle, which a parked task prevents.
const [dataDir] = process.argv.slice(2);
const app = await App.open(configFromEnv({ RAHAT_PI_DATA_DIR: dataDir, RAHAT_PI_OFFLINE: '1' }));
try {
  app.harness.resume();
  await new Promise(resolve => setTimeout(resolve, 1000));
} finally {
  await app.close();
}
