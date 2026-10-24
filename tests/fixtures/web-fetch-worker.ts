import { App } from '../../src/harness/app.js';
import { configFromEnv } from '../../src/config.js';
import { WebResearch } from '../../src/extensions/web-research.js';

const [dataDir, url] = process.argv.slice(2);
const config = configFromEnv({ RAHAT_PI_DATA_DIR: dataDir, RAHAT_PI_OFFLINE: '1' });
const webResearch = new WebResearch({ allowedTestOrigin: new URL(url).origin });
const app = await App.open(config, webResearch);
try {
  const response = await app.dispatch({
    name: 'chat',
    message: `/tool web_fetch ${JSON.stringify({ url })}`,
    requestId: 'web-fetch-recovery',
  });
  console.log(JSON.stringify(response));
} finally {
  await app.close();
}
