import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.js';
import { botModelRef, buildModels, compactionModelOverrides } from '../src/harness/models.js';

describe('bot model roles', () => {
  const mainModelRef = { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' } as const;

  it('resolves main to the main model and helper to the configured helper model', () => {
    const config = configFromEnv({
      RAHAT_PI_MODEL: 'anthropic/claude-sonnet-5.5',
      RAHAT_PI_SUBAGENT_MODEL: 'anthropic/claude-haiku-5.5',
    });
    expect(botModelRef(config, { ...mainModelRef }, 'main')).toEqual(mainModelRef);
    expect(botModelRef(config, { ...mainModelRef }, 'helper')).toEqual({ provider: 'openrouter', modelId: 'anthropic/claude-haiku-5.5' });
  });

  it('resolves every role to the offline faux model, so offline tests stay hermetic', () => {
    const config = configFromEnv({ RAHAT_PI_OFFLINE: '1' });
    const { modelRef } = buildModels(config);
    expect(modelRef.provider).toBe('faux');
    expect(botModelRef(config, modelRef, 'main')).toEqual(modelRef);
    expect(botModelRef(config, modelRef, 'helper')).toEqual(modelRef);
  });
});

describe('compaction model overrides', () => {
  it('gives every model in use one entry, deduplicated', () => {
    const config = configFromEnv({
      RAHAT_PI_MODEL: 'anthropic/claude-sonnet-5.5',
      RAHAT_PI_SUBAGENT_MODEL: 'anthropic/claude-haiku-5.5',
    });
    const { models, modelRef } = buildModels(config);
    const main = models.getModel(modelRef.provider, modelRef.modelId)!;
    const helper = models.getModel('openrouter', config.subagentModel)!;
    const overrides = compactionModelOverrides(models, [modelRef, { provider: 'openrouter', modelId: config.subagentModel }, modelRef], 40000);
    expect(Object.keys(overrides)).toEqual(['openrouter/anthropic/claude-sonnet-5.5', 'openrouter/anthropic/claude-haiku-5.5']);
    expect(overrides['openrouter/anthropic/claude-sonnet-5.5']).toEqual({
      enabled: true,
      reserveTokens: main.contextWindow - 40000,
      keepRecentTokens: 8000,
      backgroundTokens: 0,
    });
    expect(overrides['openrouter/anthropic/claude-haiku-5.5'].reserveTokens).toBe(helper.contextWindow - 40000);
  });

  it('refuses a compact threshold at or above any model context window', () => {
    const config = configFromEnv({
      RAHAT_PI_MODEL: 'anthropic/claude-sonnet-5.5',
      RAHAT_PI_SUBAGENT_MODEL: 'anthropic/claude-haiku-5.5',
    });
    const { models, modelRef } = buildModels(config);
    const main = models.getModel(modelRef.provider, modelRef.modelId)!;
    expect(() => compactionModelOverrides(models, [modelRef], main.contextWindow))
      .toThrow(`RAHAT_PI_COMPACT_AT_TOKENS must be below the ${modelRef.modelId} context window`);
  });
});
