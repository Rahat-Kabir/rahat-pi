import 'dotenv/config';
import { resolve } from 'node:path';
import { fixedUtcOffsetMs } from './timezone.js';

export function configFromEnv(environment = process.env) {
  const positiveNumber = (name: string, fallback: number) => {
    const value = Number(environment[name] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be positive`);
    }
    return value;
  };
  const positiveInteger = (name: string, fallback: number) => {
    const value = positiveNumber(name, fallback);
    if (!Number.isInteger(value)) {
      throw new Error(`${name} must be an integer`);
    }
    return value;
  };
  const webPort = positiveInteger('RAHAT_PI_WEB_PORT', 8787);
  if (webPort > 65535) {
    throw new Error('RAHAT_PI_WEB_PORT must be at most 65535');
  }
  const fixedTime = environment.RAHAT_PI_NOW;
  if (fixedTime && !Number.isFinite(Date.parse(fixedTime))) {
    throw new Error('Invalid RAHAT_PI_NOW');
  }
  const ownerName = environment.RAHAT_PI_OWNER_NAME?.trim() || 'Owner';
  const timezone = environment.RAHAT_PI_TIMEZONE?.trim() || 'UTC';
  // Fail at startup, not at the first routine, for an unknown or daylight-saving timezone.
  fixedUtcOffsetMs(timezone);
  return {
    ownerName,
    timezone,
    webPort,
    workspaceShellTimeoutMs: positiveInteger('RAHAT_PI_WORKSPACE_SHELL_TIMEOUT_MS', 30000),
    dataDir: resolve(environment.RAHAT_PI_DATA_DIR ?? 'data'),
    model: environment.RAHAT_PI_MODEL ?? 'anthropic/claude-sonnet-5.5',
    subagentModel: environment.RAHAT_PI_SUBAGENT_MODEL ?? 'anthropic/claude-haiku-5.5',
    summaryModel: environment.RAHAT_PI_SUMMARY_MODEL ?? environment.RAHAT_PI_SUBAGENT_MODEL ?? 'anthropic/claude-haiku-5.5',
    compactAtTokens: positiveInteger('RAHAT_PI_COMPACT_AT_TOKENS', 40000),
    subagentMaxToolCalls: positiveInteger('RAHAT_PI_SUBAGENT_MAX_TOOL_CALLS', 8),
    subagentMaxMs: positiveNumber('RAHAT_PI_SUBAGENT_MAX_MS', 90000),
    offline: environment.RAHAT_PI_OFFLINE === '1',
    // Thinking models count their thinking toward the output cap, and each tool step
    // re-reserves the whole transcript, so smaller values cut off normal turns.
    maxRunTokens: positiveNumber('RAHAT_PI_MAX_RUN_TOKENS', 300000),
    maxOutputTokens: positiveNumber('RAHAT_PI_MAX_OUTPUT_TOKENS', 8000),
    maxRunMs: positiveNumber('RAHAT_PI_MAX_RUN_MS', 120000),
    maxToolCalls: positiveNumber('RAHAT_PI_MAX_TOOL_CALLS', 20),
    totalUsdCap: environment.RAHAT_PI_TOTAL_USD_CAP === undefined ? undefined : positiveNumber('RAHAT_PI_TOTAL_USD_CAP', 0.25),
    dailyUsdCap: positiveNumber('RAHAT_PI_DAILY_USD_CAP', 5),
    now: () => fixedTime ? Date.parse(fixedTime) : Date.now(),
  };
}
export type Config = ReturnType<typeof configFromEnv>;

export function crashAt(point: string) {
  if (process.env.RAHAT_PI_CRASH_AT === point) {
    process.kill(process.pid, 'SIGKILL');
  }
}
