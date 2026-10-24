// `npm run test:linux`: on Windows, run the full Linux test suite inside WSL against the
// current (possibly uncommitted) files. The real work happens in scripts/test-linux.sh.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error('test:linux is for Windows (it runs the tests inside WSL). On Linux, run `npm test` directly.');
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pathConversion = spawnSync('wsl.exe', ['--exec', 'wslpath', '-a', repoRoot.replaceAll('\\', '/')], {
  encoding: 'utf8',
});
const linuxRepoPath = pathConversion.stdout?.trim();
if (pathConversion.error || pathConversion.status !== 0 || !linuxRepoPath) {
  console.error('WSL with a Linux distribution is required. Install it with `wsl --install` (see README: On Windows, use WSL).');
  process.exit(1);
}

// Arguments are passed as an array (no shell), so paths with spaces need no quoting.
const testRun = spawnSync('wsl.exe', ['--exec', 'bash', `${linuxRepoPath}/scripts/test-linux.sh`, linuxRepoPath], {
  stdio: 'inherit',
});
process.exit(testRun.status ?? 1);
