import { FileSystem } from '@effect/platform';
import { Context, Effect, Layer, Schema } from 'effect';
import { parse } from 'yaml';

export const ModelMapping = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  with: Schema.optional(Schema.String),
});

export const RoutingStrategy = Schema.Literal('round-robin', 'fill-first');
export type RoutingStrategy = Schema.Schema.Type<typeof RoutingStrategy>;

export const Config = Schema.Struct({
  'auth-keys': Schema.Array(Schema.String),
  'model-mappings': Schema.Array(ModelMapping),
  'routing-strategy': Schema.optionalWith(RoutingStrategy, { default: () => 'round-robin' }),
});

export type Config = Schema.Schema.Type<typeof Config>;

export const ConfigTag = Context.GenericTag<Config>('@rei/core/Config');

export const ConfigLive = (path?: string) =>
  Layer.effect(
    ConfigTag,
    Effect.gen(function* () {
      if (!path) {
        return {
          'auth-keys': [],
          'model-mappings': [
            {
              from: 'gpt-*',
              to: 'gemini-3-flash-preview',
            },
            {
              from: 'claude-*',
              to: 'gemini-3-flash-preview',
            },
          ],
          'routing-strategy': 'round-robin',
        } as const;
      }

      const fs = yield* FileSystem.FileSystem;
      const content = yield* fs.readFileString(path);
      return yield* Effect.try({
        try: () => parse(content),
        catch: (error) => new Error(`Failed to parse YAML: ${error}`),
      }).pipe(Effect.flatMap(Schema.decodeUnknown(Config)));
    }),
  );
