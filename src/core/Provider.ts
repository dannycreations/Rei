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
  readonly generate: (request: InternalRequest) => Effect.Effect<InternalResponse, Error, Auth | HttpClient.HttpClient | FileSystem.FileSystem>;
  readonly stream: (request: InternalRequest) => Stream.Stream<InternalStreamChunk, Error, Auth | HttpClient.HttpClient | FileSystem.FileSystem>;
}

export const Provider = Context.GenericTag<Provider>('@rei/core/Provider');

export interface ProviderRegistry {
  readonly getProvider: (modelId: string) => Effect.Effect<Provider, Error>;
  readonly mapModel: (modelId: string) => { readonly to: string; readonly with?: string };
}

export const ProviderRegistry = Context.GenericTag<ProviderRegistry>('@rei/core/ProviderRegistry');

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const config = yield* ConfigTag;

    const providers: ReadonlyArray<Provider> = [OpenAIProvider, AnthropicProvider, GeminiCliProvider];

    const mapModel = (modelId: string): { readonly to: string; readonly with?: string } => {
      const mappings = config['model-mappings'];
      const match = mappings.find((mapping) => {
        const regex = new RegExp(`^${mapping.from.replace(/\*/g, '.*')}$`);
        return regex.test(modelId);
      });

      return match ? { to: match.to, with: match.with } : { to: modelId };
    };

    const getProvider = (modelId: string): Effect.Effect<Provider, Error> => {
      const provider = providers.find((p) => modelId.startsWith(p.id) || p.id === modelId);

      if (provider) {
        return Effect.succeed(provider);
      }

      return Effect.fail(new Error(`No provider found for model: ${modelId}`));
    };

    return {
      getProvider,
      mapModel,
    };
  }),
);
