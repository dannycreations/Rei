import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Schema, Stream } from 'effect';

import { AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';

export const AnthropicAuth = Schema.Struct({
  apiKey: Schema.String,
  baseURL: Schema.optionalWith(Schema.String, { default: () => 'https://api.anthropic.com/v1' }),
});

export type AnthropicAuth = Schema.Schema.Type<typeof AnthropicAuth>;

export class AnthropicProvider implements Provider {
  public readonly id = 'anthropic';
  public readonly name = 'Anthropic';

  public execute(request: InternalRequest): Effect.Effect<InternalResponse, Error, never> {
    const self = this;
    return Effect.gen(function* () {
      const auth = yield* AuthTag;
      const session = yield* auth.next(self.id, AnthropicAuth);
      const { apiKey, baseURL } = session.data;

      const req = HttpClientRequest.post(`${baseURL}/messages`).pipe(
        HttpClientRequest.setHeader('x-api-key', apiKey),
        HttpClientRequest.setHeader('anthropic-version', '2023-06-01'),
        HttpClientRequest.bodyJson(self.mapRequest(request)),
      );

      const client = yield* HttpClient.HttpClient;
      const res = yield* Effect.flatMap(req, (r) => client.execute(r));
      const json: any = yield* res.json;

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
      };
    }).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e))))) as Effect.Effect<InternalResponse, Error, never>;
  }

  public stream(request: InternalRequest): Stream.Stream<InternalStreamChunk, Error, never> {
    const self = this;
    return Stream.unwrap(
      Effect.gen(function* () {
        const auth = yield* AuthTag;
        const session = yield* auth.next(self.id, AnthropicAuth);
        const { apiKey, baseURL } = session.data;

        const req = HttpClientRequest.post(`${baseURL}/messages`).pipe(
          HttpClientRequest.setHeader('x-api-key', apiKey),
          HttpClientRequest.setHeader('anthropic-version', '2023-06-01'),
          HttpClientRequest.bodyJson(self.mapRequest(request)),
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
          Stream.map((json: any) => ({
            id: 'stream',
            content: json.delta?.text || '',
            done: false,
          })),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))) as Stream.Stream<InternalStreamChunk, Error, never>;
  }

  private mapRequest(request: InternalRequest) {
    return {
      model: request.model,
      system: request.system,
      messages: [...request.messages].filter((m) => m.role !== 'system'),
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature,
      top_p: request.topP,
      stop_sequences: request.stop,
      stream: request.stream,
    };
  }
}
