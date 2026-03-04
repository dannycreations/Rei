import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Schema, Stream } from 'effect';

import { AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest } from '../../core/Schema.js';

export const AnthropicAuth = Schema.Struct({
  apiKey: Schema.String,
  baseURL: Schema.optionalWith(Schema.String, { default: () => 'https://api.anthropic.com/v1' }),
});

export type AnthropicAuth = Schema.Schema.Type<typeof AnthropicAuth>;

const mapRequest = (request: InternalRequest) => ({
  model: request.model,
  system: request.system,
  messages: request.messages.filter((m) => m.role !== 'system'),
  max_tokens: request.maxTokens ?? 4096,
  temperature: request.temperature,
  top_p: request.topP,
  stop_sequences: request.stop,
  stream: request.stream,
});

export const AnthropicProvider: Provider = {
  id: 'anthropic',
  name: 'Anthropic',

  generate: (request: InternalRequest) =>
    Effect.gen(function* () {
      const auth = yield* AuthTag;
      const session = yield* auth.next('anthropic', AnthropicAuth);
      const { apiKey, baseURL } = session.data;

      const req = HttpClientRequest.post(`${baseURL}/messages`).pipe(
        HttpClientRequest.setHeader('x-api-key', apiKey),
        HttpClientRequest.setHeader('anthropic-version', '2023-06-01'),
        HttpClientRequest.bodyJson(mapRequest(request)),
      );

      const client = yield* HttpClient.HttpClient;
      const res = yield* Effect.flatMap(req, (r) => client.execute(r));
      const json = (yield* res.json) as any;

      if (json.error) {
        return yield* Effect.fail(new Error(json.error.message || 'Anthropic API Error'));
      }

      return {
        id: json.id,
        model: json.model,
        content: json.content[0].text,
        role: 'assistant' as const,
        usage: {
          promptTokens: json.usage.input_tokens,
          completionTokens: json.usage.output_tokens,
          totalTokens: json.usage.input_tokens + json.usage.output_tokens,
        },
      } as const;
    }).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e))))),

  stream: (request: InternalRequest) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const auth = yield* AuthTag;
        const session = yield* auth.next('anthropic', AnthropicAuth);
        const { apiKey, baseURL } = session.data;

        const req = HttpClientRequest.post(`${baseURL}/messages`).pipe(
          HttpClientRequest.setHeader('x-api-key', apiKey),
          HttpClientRequest.setHeader('anthropic-version', '2023-06-01'),
          HttpClientRequest.bodyJson(mapRequest(request)),
        );

        const client = yield* HttpClient.HttpClient;
        const res = yield* Effect.flatMap(req, (r) => client.execute(r));

        return res.stream.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.startsWith('data: ')),
          Stream.map((line) => line.slice(6).trim()),
          Stream.filter((line) => line.length > 0),
          Stream.mapEffect((line) => Effect.try(() => JSON.parse(line))),
          Stream.filter((json: any) => json.type === 'content_block_delta'),
          Stream.map(
            (json: any) =>
              ({
                id: 'stream',
                content: json.delta?.text || '',
                done: false,
              }) as const,
          ),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))),
};
