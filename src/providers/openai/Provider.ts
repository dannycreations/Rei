import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Schema, Stream } from 'effect';

import { AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';

export const OpenAIAuth = Schema.Struct({
  apiKey: Schema.String,
  baseURL: Schema.optionalWith(Schema.String, { default: () => 'https://api.openai.com/v1' }),
});

export type OpenAIAuth = Schema.Schema.Type<typeof OpenAIAuth>;

export class OpenAIProvider implements Provider {
  public readonly id = 'openai';
  public readonly name = 'OpenAI';

  public execute(request: InternalRequest): Effect.Effect<InternalResponse, Error, never> {
    const self = this;
    return Effect.gen(function* () {
      const auth = yield* AuthTag;
      const session = yield* auth.next(self.id, OpenAIAuth);
      const { apiKey, baseURL } = session.data;

      const req = HttpClientRequest.post(`${baseURL}/chat/completions`).pipe(
        HttpClientRequest.setHeader('Authorization', `Bearer ${apiKey}`),
        HttpClientRequest.bodyJson(self.mapRequest(request)),
      );

      const client = yield* HttpClient.HttpClient;
      const res = yield* Effect.flatMap(req, (r) => client.execute(r));
      const json: any = yield* res.json;

      if (json.error) {
        return yield* Effect.fail(new Error(json.error.message || 'OpenAI API Error'));
      }

      return {
        id: json.id,
        model: json.model,
        content: json.choices[0].message.content,
        role: 'assistant' as const,
        usage: {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        },
      };
    }).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e))))) as Effect.Effect<InternalResponse, Error, never>;
  }

  public stream(request: InternalRequest): Stream.Stream<InternalStreamChunk, Error, never> {
    const self = this;
    return Stream.unwrap(
      Effect.gen(function* () {
        const auth = yield* AuthTag;
        const session = yield* auth.next(self.id, OpenAIAuth);
        const { apiKey, baseURL } = session.data;

        const req = HttpClientRequest.post(`${baseURL}/chat/completions`).pipe(
          HttpClientRequest.setHeader('Authorization', `Bearer ${apiKey}`),
          HttpClientRequest.bodyJson(self.mapRequest(request)),
        );

        const client = yield* HttpClient.HttpClient;
        const res = yield* Effect.flatMap(req, (r) => client.execute(r));

        return res.stream.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.startsWith('data: ')),
          Stream.map((line) => line.slice(6).trim()),
          Stream.filter((line) => line.length > 0 && line !== '[DONE]'),
          Stream.mapEffect((line) => Effect.try(() => JSON.parse(line))),
          Stream.map((json: any) => ({
            id: json.id,
            content: json.choices[0]?.delta?.content || '',
            done: !!json.choices[0]?.finish_reason,
          })),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))) as Stream.Stream<InternalStreamChunk, Error, never>;
  }

  private mapRequest(request: InternalRequest) {
    return {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: request.stream,
    };
  }
}
