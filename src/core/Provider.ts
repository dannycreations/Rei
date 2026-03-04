import { Context, Effect, Layer, Stream } from 'effect';

import { AnthropicProvider } from '../providers/anthropic/Provider.js';
import { OpenAIProvider } from '../providers/openai/Provider.js';
import { Config, ConfigTag } from './Config.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from './Schema.js';

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly execute: (request: InternalRequest) => Effect.Effect<InternalResponse, Error, never>;
  readonly stream: (request: InternalRequest) => Stream.Stream<InternalStreamChunk, Error, never>;
}

export const Provider = Context.GenericTag<Provider>('@rei/core/Provider');

export interface ProviderRegistry {
  readonly register: (provider: Provider) => void;
  readonly getProvider: (modelId: string) => Effect.Effect<Provider, Error, never>;
  readonly mapModel: (modelId: string) => string;
}

export const ProviderRegistry = Context.GenericTag<ProviderRegistry>('@rei/core/ProviderRegistry');

export class ProviderRegistryImpl implements ProviderRegistry {
  private providers = new Map<string, Provider>();

  public constructor(private readonly config: Config) {}

  public register(provider: Provider) {
    this.providers.set(provider.id, provider);
  }

  public mapModel(modelId: string): string {
    const mappings = this.config['model-mappings'];
    for (const mapping of mappings) {
      const regex = new RegExp(`^${mapping.from.replace(/\*/g, '.*')}$`);
      if (regex.test(modelId)) {
        return mapping.to;
      }
    }
    return modelId;
  }

  public getProvider(modelId: string): Effect.Effect<Provider, Error, never> {
    const provider = Array.from(this.providers.values()).find((p) => modelId.startsWith(p.id) || p.id === modelId);

    if (provider) {
      return Effect.succeed(provider);
    }

    return Effect.fail(new Error(`No provider found for model: ${modelId}`));
  }
}

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const config = yield* ConfigTag;
    const registry = new ProviderRegistryImpl(config);

    // Initialize with env vars or config
    const openAIKey = process.env.OPENAI_API_KEY ?? 'sk-dummy';
    const anthropicKey = process.env.ANTHROPIC_API_KEY ?? 'sk-ant-dummy';

    registry.register(new OpenAIProvider(openAIKey));
    registry.register(new AnthropicProvider(anthropicKey));

    return registry;
  }),
);
