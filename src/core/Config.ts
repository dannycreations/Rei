import { Context, Effect, Layer, Schema } from 'effect';
import { parse } from 'yaml';

export const parseYaml = (content: string) =>
  Effect.try({
    try: () => parse(content),
    catch: (error) => new Error(`Failed to parse YAML: ${error}`),
  }).pipe(Effect.flatMap(Schema.decodeUnknown(Config)));

export const ModelMapping = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
});

export const Config = Schema.Struct({
  'auth-keys': Schema.Array(Schema.String),
  'model-mappings': Schema.Array(ModelMapping),
});

export type Config = Schema.Schema.Type<typeof Config>;

export const ConfigTag = Context.GenericTag<Config>('@rei/core/Config');

export const ConfigLive = Layer.succeed(ConfigTag, {
  'auth-keys': [],
  'model-mappings': [],
});
