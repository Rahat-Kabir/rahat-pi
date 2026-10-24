import { describe, expect, it, vi } from 'vitest';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { App, type Output } from '../src/harness/app.js';
import * as modelSetup from '../src/harness/models.js';
import { offlineConfig, temporaryData } from './helpers.js';

describe('committed chat output', () => {
  it.each([false, true])('prints the complete chunked answer exactly once (tool turn: %s)', async includeToolTurn => {
    const temporaryStorage = temporaryData();
    // Fixed four-character chunks span multiple Pi progress commits.
    const fauxModelProvider = fauxProvider({ tokenSize: { min: 1, max: 1 }, tokensPerSecond: 40 });
    const models = createModels();
    models.setProvider(fauxModelProvider.provider);
    const answerStart = "I'm Rahat-PI, your personal assistant, ";
    const answerEnd = "and you're in the **UTC** timezone. Complete ending.";
    const answer = answerStart + answerEnd;
    fauxModelProvider.setResponses([
      ...(includeToolTurn ? [fauxAssistantMessage([
        fauxText("I'll save that preference first."),
        fauxToolCall('memory_write', { content: 'Rahat prefers tea', source: 'owner:cli' }),
      ], { stopReason: 'toolUse' })] : []),
      fauxAssistantMessage([fauxText(answerStart), fauxText(answerEnd)]),
    ]);
    const modelSpy = vi.spyOn(modelSetup, 'buildModels').mockReturnValue({
      models, modelRef: { provider: fauxModelProvider.provider.id, modelId: fauxModelProvider.getModel().id },
    });
    const outputEvents: Parameters<Output>[0][] = [];
    const app = await App.open(offlineConfig(temporaryStorage.dataDir));
    try {
      const result = await app.dispatch({ name: 'chat', message: 'Introduce yourself and remember my preference.' }, event => outputEvents.push(event));
      expect(result).toMatchObject({ reply: answer });
      expect(outputEvents.filter(event => event.type === 'text')).toEqual([{ type: 'text', text: answer }]);
      expect(outputEvents.filter(event => event.type === 'tool')).toHaveLength(includeToolTurn ? 1 : 0);
      expect(fauxModelProvider.state.callCount).toBe(includeToolTurn ? 2 : 1);
    } finally {
      await app.close();
      modelSpy.mockRestore();
      temporaryStorage.cleanup();
    }
  });
});
