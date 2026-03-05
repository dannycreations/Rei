import { FileSystem, HttpClient } from '@effect/platform';
import { Context, Effect, Layer, Stream } from 'effect';

import { AnthropicProvider } from '../providers/anthropic/Provider.js';
import { GeminiCliProvider } from '../providers/gemini-cli/Provider.js';
import { OpenAIProvider } from '../providers/openai/Provider.js';
import { Auth } from './Auth.js';
import { ConfigTag } from './Config.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from './Schema.js';

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly models: ReadonlyArray<string>;
  readonly generate: (request: InternalRequest) => Effect.Effect<InternalResponse, Error, Auth | HttpClient.HttpClient | FileSystem.FileSystem>;
  readonly stream: (request: InternalRequest) => Stream.Stream<InternalStreamChunk, Error, Auth | HttpClient.HttpClient | FileSystem.FileSystem>;
}

export const Provider = Context.GenericTag<Provider>('@rei/core/Provider');

export interface ProviderRegistry {
  readonly getProvider: (modelId: string) => Effect.Effect<Provider, Error>;
  readonly mapModel: (modelId: string) => { readonly to: string; readonly with?: string };
  readonly getModels: () => Effect.Effect<ReadonlyArray<{ readonly id: string; readonly provider: string }>>;
}

export const ProviderRegistry = Context.GenericTag<ProviderRegistry>('@rei/core/ProviderRegistry');

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const config = yield* ConfigTag;

    const providers: ReadonlyArray<Provider> = [OpenAIProvider, AnthropicProvider, GeminiCliProvider];
    const mappings = [...config['model-mappings']]
      .sort((a, b) => b.from.length - a.from.length)
      .map((m) => ({ ...m, regex: new RegExp(`^${m.from.replace(/\*/g, '.*')}$`) }));

    const modelToProviderCache = new Map<string, Provider>();

    const mapModel = (modelId: string): { readonly to: string; readonly with?: string } => {
      const match = mappings.find((m) => m.regex.test(modelId));
      return match ? { to: match.to, with: match.with } : { to: modelId };
    };

    const getProvider = (modelId: string): Effect.Effect<Provider, Error> => {
      const cached = modelToProviderCache.get(modelId);
      if (cached) return Effect.succeed(cached);

      const provider = providers.find((p) => p.models.includes(modelId) || modelId.startsWith(p.id));

      if (provider) {
        modelToProviderCache.set(modelId, provider);
        return Effect.succeed(provider);
      }

      return Effect.fail(new Error(`No provider found for model: ${modelId}`));
    };

    const getModels = () => Effect.succeed(providers.flatMap((p) => p.models.map((m) => ({ id: m, provider: p.id }))));

    return {
      getProvider,
      mapModel,
      getModels,
    };
  }),
);
