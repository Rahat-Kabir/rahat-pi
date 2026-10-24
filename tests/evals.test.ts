import { expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runEvaluations, runEvalCases, formatEvalResults, liveCases, type EvalContext } from '../src/evals/runner.js';
import { App } from '../src/harness/app.js';
import { temporaryData } from './helpers.js';

it('runs 15 deterministic offline evals and writes a private JSON report even with live settings inherited', async () => {
  const temporaryStorage = temporaryData();
  try {
    const options = { reportDir: join(temporaryStorage.dataDir, 'evals'), environment: { RAHAT_PI_OFFLINE: '0', RAHAT_PI_LIVE_EVAL: '1', OPENROUTER_API_KEY: '' } };
    const first = await runEvaluations(options);
    const second = await runEvaluations(options);
    expect(first.report.mode).toBe('offline');
    expect(first.report.passed).toBe(15);
    expect(first.report.failed).toBe(0);
    expect(first.report.results).toEqual(second.report.results);
    expect(first.report.dataDir).not.toBe(second.report.dataDir);
    expect(JSON.parse(readFileSync(first.reportPath, 'utf8'))).toEqual(first.report);
    expect(statSync(first.reportPath).mode & 0o777).toBe(0o600);
    expect(formatEvalResults(first.report.results)).toContain('PASS    compaction keeps facts');
    expect(first.report.stats.total.actualUsd).toBe(0);
    expect(liveCases).toHaveLength(4);
  } finally {
    temporaryStorage.cleanup();
  }
});

it('records failed evals and continues to the next task', async () => {
  const results = await runEvalCases([
    { name: 'intentional failure', run: async () => {
      throw new Error('expected failure');
    } },
    { name: 'next task', run: async () => {} },
  ], {} as EvalContext);
  expect(results).toEqual([
    { name: 'intentional failure', passed: false, error: 'expected failure' },
    { name: 'next task', passed: true },
  ]);
  expect(formatEvalResults(results)).toContain('FAIL    intentional failure: expected failure');
});

it('refuses live evals without a key before creating a store or making a request', async () => {
  await expect(runEvaluations({ live: true, environment: { OPENROUTER_API_KEY: '' } })).rejects.toThrow('OPENROUTER_API_KEY is required');
});

it('fixes live evals to four tasks and USD 0.25 with a faux-only test substitute', async () => {
  const temporaryStorage = temporaryData();
  const openApp = App.open.bind(App);
  const openSpy = vi.spyOn(App, 'open').mockImplementation(async config => {
    expect(config.offline).toBe(false);
    expect(config.totalUsdCap).toBe(0.25);
    expect(config.dailyUsdCap).toBe(0.25);
    return openApp({ ...config, offline: true });
  });
  try {
    const { report } = await runEvaluations({
      live: true,
      reportDir: join(temporaryStorage.dataDir, 'evals'),
      environment: { OPENROUTER_API_KEY: 'unused-faux-test-value', RAHAT_PI_TOTAL_USD_CAP: '100' },
    });
    expect(report.mode).toBe('live');
    expect(report.results.map(result => result.name)).toEqual(liveCases.map(evaluationCase => evaluationCase.name));
    expect(report.capUsd).toBe(0.25);
    expect(report.stats.total.countedUsd).toBeLessThanOrEqual(0.25);
  } finally {
    openSpy.mockRestore();
    temporaryStorage.cleanup();
  }
});
