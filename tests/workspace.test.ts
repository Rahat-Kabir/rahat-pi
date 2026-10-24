import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { Workspace, buildWorkspaceTools, workspaceFileLimit, workspaceOutputLimit } from '../src/extensions/workspace.js';
import { configFromEnv } from '../src/config.js';
import { assertAllowedTool } from '../src/policy/index.js';
import { App } from '../src/harness/app.js';
import { cli, offlineConfig, temporaryData, toolMessage } from './helpers.js';

describe('sandboxed workspace tools', () => {
  let temporaryStorage: ReturnType<typeof temporaryData>;
  let workspace: Workspace;

  beforeEach(() => {
    temporaryStorage = temporaryData();
    workspace = new Workspace(offlineConfig(temporaryStorage.dataDir));
  });

  afterEach(() => {
    temporaryStorage.cleanup();
  });

  it('validates the shell timeout and registers main-only tools with explicit replay policies', () => {
    expect(configFromEnv({}).workspaceShellTimeoutMs).toBe(30000);
    for (const invalidValue of ['0', '-1', '1.5', 'NaN']) {
      expect(() => configFromEnv({ RAHAT_PI_WORKSPACE_SHELL_TIMEOUT_MS: invalidValue })).toThrow();
    }
    const tools = buildWorkspaceTools(workspace);
    expect(tools.map(tool => [tool.name, tool.replay])).toEqual([
      ['workspace_list', 'safe'], ['workspace_read', 'safe'],
      ['workspace_write', 'safe'], ['workspace_shell', 'unsafe'],
    ]);
    for (const tool of tools) {
      expect(() => assertAllowedTool(tool.name)).not.toThrow();
      expect(() => assertAllowedTool(tool.name, true)).toThrow('Child tool denied');
    }
  });

  it('lists, reads, and replaces UTF-8 files idempotently through the real offline CLI', async () => {
    const dataDir = temporaryStorage.dataDir;
    const content = 'Rahat: চা\n';
    for (let writeNumber = 0; writeNumber < 2; writeNumber++) {
      expect((await cli(dataDir, ['chat', '--message', toolMessage('workspace_write', { path: 'note.txt', content })])).stdout).toContain('bytesWritten');
    }
    expect((await cli(dataDir, ['chat', '--message', toolMessage('workspace_list', {})])).stdout).toContain('note.txt');
    expect((await cli(dataDir, ['chat', '--message', toolMessage('workspace_read', { path: 'note.txt' })])).stdout).toContain('চা');
    expect(readFileSync(join(workspace.workspacePath, 'note.txt'), 'utf8')).toBe(content);
    expect(workspace.write('note.txt', 'short')).toEqual({ bytesWritten: 5 });
    expect(workspace.read('note.txt')).toEqual({ content: 'short' });
  });

  it('rejects traversal, absolute paths, and escaping parent and target symlinks', () => {
    const outsidePath = join(temporaryStorage.dataDir, 'private.txt');
    writeFileSync(outsidePath, 'private');
    symlinkSync(temporaryStorage.dataDir, join(workspace.workspacePath, 'outside'));
    symlinkSync(outsidePath, join(workspace.workspacePath, 'target'));
    symlinkSync(join(temporaryStorage.dataDir, 'missing'), join(workspace.workspacePath, 'dangling'));
    for (const path of ['../private.txt', '../../.env', outsidePath, '/etc/passwd', 'outside/private.txt', 'target', 'dangling']) {
      expect(() => workspace.read(path)).toThrow();
      expect(() => workspace.write(path, 'overwrite')).toThrow();
    }
    for (const path of ['..', '/', temporaryStorage.dataDir, 'outside']) {
      expect(() => workspace.list(path)).toThrow();
    }
    expect(readFileSync(outsidePath, 'utf8')).toBe('private');
    expect(existsSync(join(temporaryStorage.dataDir, 'missing'))).toBe(false);
  });

  it('allows internal symlinks but rejects a symlink workspace root and hardlinked writes', () => {
    workspace.write('note', 'original');
    symlinkSync('note', join(workspace.workspacePath, 'alias'));
    workspace.write('alias', 'internal');
    expect(workspace.read('alias').content).toBe('internal');
    linkSync(join(workspace.workspacePath, 'note'), join(workspace.workspacePath, 'hardlink'));
    expect(() => workspace.write('hardlink', 'changed')).toThrow('one link');
    expect(workspace.read('note').content).toBe('internal');
    const otherDataDir = join(temporaryStorage.dataDir, 'other');
    mkdirSync(otherDataDir);
    symlinkSync(workspace.workspacePath, join(otherDataDir, 'workspace'));
    expect(() => new Workspace(offlineConfig(otherDataDir))).toThrow('Workspace root');
  });

  it('caps file bytes and directory entries and refuses nonregular files', async () => {
    workspace.write('limit', 'x'.repeat(workspaceFileLimit));
    expect(workspace.read('limit').content.length).toBe(workspaceFileLimit);
    expect(() => workspace.write('limit', 'é'.repeat(workspaceFileLimit))).toThrow('exceeds');
    writeFileSync(join(workspace.workspacePath, 'large'), 'x'.repeat(workspaceFileLimit + 1));
    expect(() => workspace.read('large')).toThrow('exceeds');
    expect(() => workspace.read('.')).toThrow('regular file');
    expect(() => workspace.write('.', 'bad')).toThrow();
    expect((await workspace.shell('mkfifo pipe')).exitCode).toBe(0);
    expect(() => workspace.read('pipe')).toThrow('regular file');
    expect(() => workspace.write('pipe', 'bad')).toThrow();
    for (let entryNumber = 0; entryNumber < 257; entryNumber++) {
      writeFileSync(join(workspace.workspacePath, `entry-${entryNumber}`), '');
    }
    expect(workspace.list().entries).toHaveLength(256);
    expect(workspace.list().truncated).toBe(true);
  });

  it('runs with no parent secrets and a writable workspace and private temporary directory', async () => {
    process.env.RAHAT_WORKSPACE_DUMMY_SECRET = 'dummy-value-must-not-escape';
    try {
      const result = await workspace.shell('env; pwd; printf sandbox > result; printf temporary > /tmp/private; test ! -e /etc/passwd; test ! -w /usr/bin');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('HOME=/workspace');
      expect(result.output).toContain('PATH=/usr/bin:/bin');
      expect(result.output).not.toContain('RAHAT_WORKSPACE_DUMMY_SECRET');
      expect(result.output).not.toContain('dummy-value-must-not-escape');
      expect(result.output).not.toContain('OPENROUTER_API_KEY');
      expect(workspace.read('result').content).toBe('sandbox');
      expect((await workspace.shell('test ! -e /tmp/private')).exitCode).toBe(0);
    } finally {
      delete process.env.RAHAT_WORKSPACE_DUMMY_SECRET;
    }
  });

  it('cannot see the repo, provider database, Pi store, env file, or owner socket even through proc', async () => {
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    const ownerSocket = join(temporaryStorage.dataDir, 'agent.sock');
    const socketServer = createServer();
    await new Promise<void>(resolveListening => socketServer.listen(ownerSocket, resolveListening));
    try {
      const hiddenPaths = [
        process.cwd(), join(process.cwd(), '.env'),
        join(temporaryStorage.dataDir, 'fake-provider.sqlite'),
        join(temporaryStorage.dataDir, 'pi.sqlite'), ownerSocket,
      ];
      expect(existsSync(hiddenPaths[2])).toBe(true);
      const command = `python3 -c ${shellQuote([
        'import os, socket',
        `paths = ${JSON.stringify(hiddenPaths)}`,
        'assert all(not os.path.exists(path) for path in paths)',
        'assert all(not os.path.exists("/proc/1/root" + path) for path in paths)',
        'client = socket.socket(socket.AF_UNIX)',
        'try:',
        `    client.connect(${JSON.stringify(ownerSocket)})`,
        'except OSError:',
        '    print("SOCKET_BLOCKED")',
        'else:',
        '    raise AssertionError("owner socket reachable")',
      ].join('\n'))}`;
      const response = await app.dispatch({ name: 'chat', message: toolMessage('workspace_shell', { command }) });
      expect(JSON.stringify(response)).toContain('SOCKET_BLOCKED');
      expect(await app.dispatch({ name: 'outbox' })).toEqual([]);
      await app.dispatch({ name: 'chat', message: toolMessage('propose_send_message', { recipient: 'fixture:owner', body: 'workspace check' }) });
      await app.dispatch({ name: 'tick' });
      expect(await app.dispatch({ name: 'outbox' })).toEqual([]);
      const actions = await app.dispatch({ name: 'actions' }) as { id: string }[];
      await app.dispatch({ name: 'approve', id: actions[0].id });
      await app.dispatch({ name: 'tick' });
      await app.dispatch({ name: 'tick' });
      expect(await app.dispatch({ name: 'outbox' })).toHaveLength(1);
    } finally {
      await new Promise<void>((resolveClosing, reject) => socketServer.close(error => error ? reject(error) : resolveClosing()));
      await app.close();
    }
  });

  it('blocks external and host-loopback networking in a separate namespace', async () => {
    const hostServer = createServer();
    await new Promise<void>(resolveListening => hostServer.listen(0, '127.0.0.1', resolveListening));
    try {
      const address = hostServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('Missing test port');
      }
      const command = `python3 -c ${shellQuote([
        'import socket, errno',
        `for address in [("127.0.0.1", ${address.port}), ("1.1.1.1", 443)]:`,
        '    client = socket.socket()',
        '    client.settimeout(1)',
        '    result = client.connect_ex(address)',
        '    assert result in (errno.ENETUNREACH, errno.ECONNREFUSED), result',
        '    client.close()',
        'print("NETWORK_BLOCKED")',
      ].join('\n'))}`;
      const result = await workspace.shell(command);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('NETWORK_BLOCKED');
    } finally {
      await new Promise<void>(resolveClosing => hostServer.close(() => resolveClosing()));
    }
  });

  it('kills the process group and detached descendants on timeout', async () => {
    const shortWorkspace = new Workspace(offlineConfig(temporaryStorage.dataDir, { RAHAT_PI_WORKSPACE_SHELL_TIMEOUT_MS: '200' }));
    const startedAt = Date.now();
    const result = await shortWorkspace.shell("setsid sh -c 'sleep 0.5; echo escaped > escaped' & echo started > started; sleep 10");
    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(workspace.read('started').content).toContain('started');
    await new Promise(resolveDelay => setTimeout(resolveDelay, 600));
    expect(existsSync(join(workspace.workspacePath, 'escaped'))).toBe(false);
  });

  it('kills running work when the tool context is cancelled', async () => {
    const controller = new AbortController();
    const execution = workspace.shell('echo started > cancellation; sleep 10', controller.signal);
    const timeout = setTimeout(() => controller.abort(), 200);
    try {
      const result = await execution;
      expect(result.exitCode).not.toBe(0);
      expect(result.timedOut).toBe(false);
      expect(workspace.read('cancellation').content).toContain('started');
    } finally {
      clearTimeout(timeout);
    }
  });

  it('caps combined stdout and stderr with an explicit truncation marker', async () => {
    const result = await workspace.shell('head -c 40000 /dev/zero | tr "\\000" A; head -c 40000 /dev/zero | tr "\\000" B >&2');
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.output).toHaveLength(workspaceOutputLimit + '\n[output truncated]'.length);
    expect(result.output.endsWith('\n[output truncated]')).toBe(true);
    expect(result.output).toContain('A');
    expect(result.output).toContain('B');
  });

  it('refuses execution when bubblewrap is missing or sandbox setup fails', async () => {
    const unavailableWorkspace = new Workspace(offlineConfig(temporaryStorage.dataDir), '/missing/bwrap');
    await expect(unavailableWorkspace.shell('touch unsandboxed')).rejects.toThrow('refusing unsandboxed execution');
    expect(existsSync(join(workspace.workspacePath, 'unsandboxed'))).toBe(false);
    const failingWorkspace = new Workspace(offlineConfig(temporaryStorage.dataDir), '/usr/bin/false');
    expect((await failingWorkspace.shell('touch unsandboxed')).exitCode).not.toBe(0);
    expect(existsSync(join(workspace.workspacePath, 'unsandboxed'))).toBe(false);
  });
});

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
