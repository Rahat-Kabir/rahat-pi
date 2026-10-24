import { createModels, type Models } from '@earendil-works/pi-ai/models';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import type { Model, Context as ModelContext } from '@earendil-works/pi-ai';
import type { DispatchAccounting } from './costs.js';
import { createOfflineFauxProvider } from './faux-model.js';
import { crashAt, type Config } from '../config.js';

// Runs before every model request: reserves budget or throws to refuse the request.
type BeforeDispatch = (
  model: Model<string>,
  transcript: ModelContext,
  sessionId: string | undefined,
) => Promise<DispatchAccounting | void>;

export function buildModels(config: Config) {
  const models = createModels();
  if (config.offline) {
    const fauxModelProvider = createOfflineFauxProvider();
    models.setProvider(fauxModelProvider.provider);
    return { models, modelRef: { provider: 'faux', modelId: fauxModelProvider.getModel().id } };
  }
  models.setProvider(openrouterProvider());
  if (!models.getModel('openrouter', config.model)) {
    throw new Error(`Unknown OpenRouter model in pinned catalog: ${config.model}`);
  }
  if (!models.getModel('openrouter', config.subagentModel)) {
    throw new Error(`Unknown OpenRouter subagent model in pinned catalog: ${config.subagentModel}`);
  }
  if (!models.getModel('openrouter', config.summaryModel)) {
    throw new Error(`Unknown OpenRouter summary model in pinned catalog: ${config.summaryModel}`);
  }
  return { models, modelRef: { provider: 'openrouter', modelId: config.model } };
}

// Pi 1.4's settings omit maxTokens. Enforce it at the real Models request boundary.
type StreamSimpleArguments = Parameters<Models['streamSimple']>;
type CompleteSimpleArguments = Parameters<Models['completeSimple']>;

export function capModelOutput(models: Models, maxOutputTokens: number, beforeDispatch: BeforeDispatch): Models {
  return new Proxy(models, {
    get(modelRegistry, propertyName) {
      if (propertyName === 'streamSimple') {
        return (
          model: StreamSimpleArguments[0],
          transcript: StreamSimpleArguments[1],
          options: StreamSimpleArguments[2],
        ) => {
          const guardedStream = createAssistantMessageEventStream();
          void (async () => {
            try {
              const accounting = await beforeDispatch(model, transcript, options?.sessionId);
              if (options?.signal?.aborted) {
                throw new Error('Model request cancelled before dispatch');
              }
              const cappedOptions = { ...options, maxTokens: maxOutputTokens };
              for await (const event of modelRegistry.streamSimple(model, transcript, cappedOptions)) {
                if (accounting?.isChild && event.type === 'start') {
                  crashAt('subagent_started');
                }
                if (event.type === 'done') {
                  await accounting?.recordUsage(event.message.usage);
                }
                if (event.type === 'error' && event.error.usage.totalTokens > 0) {
                  await accounting?.recordUsage(event.error.usage);
                }
                guardedStream.push(event);
              }
            } catch (error) {
              // Reuse the faux helper only to build a well-formed assistant error message.
              const errorText = error instanceof Error ? error.message : String(error);
              const errorMessage = {
                ...fauxAssistantMessage('', { stopReason: 'error', errorMessage: errorText }),
                api: model.api,
                provider: model.provider,
                model: model.id,
              };
              guardedStream.push({ type: 'error', reason: 'error', error: errorMessage });
            } finally {
              guardedStream.end();
            }
          })();
          return guardedStream;
        };
      }
      const propertyValue = Reflect.get(modelRegistry, propertyName, modelRegistry);
      return typeof propertyValue === 'function' ? propertyValue.bind(modelRegistry) : propertyValue;
    },
  });
}

// Pi compaction uses completeSimple rather than the generation streaming path.
export function budgetCompactionModels(
  models: Models,
  summaryModel: Model<string>,
  maxOutputTokens: number,
  beforeDispatch: BeforeDispatch,
): Models {
  return new Proxy(models, {
    get(modelRegistry, propertyName) {
      if (propertyName === 'completeSimple') {
        return async (
          _model: CompleteSimpleArguments[0],
          transcript: CompleteSimpleArguments[1],
          options: CompleteSimpleArguments[2],
        ) => {
          const accounting = await beforeDispatch(summaryModel, transcript, options?.sessionId);
          options?.signal?.throwIfAborted();
          crashAt('compaction_started');
          const cappedOptions = { ...options, maxTokens: maxOutputTokens };
          const summary = await modelRegistry.completeSimple(summaryModel, transcript, cappedOptions);
          // Record usage for any finished summary, and for a failed one only if tokens were billed.
          if ((summary.stopReason !== 'error' && summary.stopReason !== 'aborted') || summary.usage.totalTokens > 0) {
            await accounting?.recordUsage(summary.usage);
          }
          crashAt('compaction_summary_ready');
          return summary;
        };
      }
      const propertyValue = Reflect.get(modelRegistry, propertyName, modelRegistry);
      return typeof propertyValue === 'function' ? propertyValue.bind(modelRegistry) : propertyValue;
    },
  });
}
