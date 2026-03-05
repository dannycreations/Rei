import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Schema, Stream } from 'effect';

import { AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest } from '../../core/Schema.js';
import { streamSSE } from '../../helpers/Server.js';

export const OpenAIAuth = Schema.Struct({
  apiKey: Schema.String,
  baseURL: Schema.optionalWith(Schema.String, { default: () => 'https://api.openai.com/v1' }),
});

export type OpenAIAuth = Schema.Schema.Type<typeof OpenAIAuth>;

const mapRequest = (request: InternalRequest) => ({
  model: request.model,
  messages: request.messages,
  temperature: request.temperature,
  max_tokens: request.maxTokens,
  stream: request.stream,
  top_p: request.topP,
  stop: request.stop,
});

export const OpenAIProvider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  models: [],

  generate: (request: InternalRequest) =>
    Effect.gen(function* () {
      const auth = yield* AuthTag;
      const session = yield* auth.next('openai', OpenAIAuth);
      const { apiKey, baseURL } = session.data;

      const req = HttpClientRequest.post(`${baseURL}/chat/completions`).pipe(
        HttpClientRequest.setHeader('Authorization', `Bearer ${apiKey}`),
        HttpClientRequest.bodyJson(mapRequest(request)),
      );

      const client = yield* HttpClient.HttpClient;
      const res = yield* Effect.flatMap(req, (r) => client.execute(r));
      const json = (yield* res.json) as {
        id: string;
        model: string;
        choices: Array<{ message: { content: string } }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        error?: { message?: string };
      };

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
    }).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e))))),

  stream: (request: InternalRequest) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const auth = yield* AuthTag;
        const session = yield* auth.next('openai', OpenAIAuth);
        const { apiKey, baseURL } = session.data;

        const req = HttpClientRequest.post(`${baseURL}/chat/completions`).pipe(
          HttpClientRequest.setHeader('Authorization', `Bearer ${apiKey}`),
          HttpClientRequest.bodyJson(mapRequest(request)),
        );

        const client = yield* HttpClient.HttpClient;
        const res = yield* Effect.flatMap(req, (r) => client.execute(r));

        return streamSSE(res.stream).pipe(
          Stream.map((json) => {
            const j = json as { id: string; choices: Array<{ delta: { content?: string }; finish_reason?: string | null }> };
            return {
              id: j.id,
              content: j.choices[0]?.delta?.content || '',
              done: !!j.choices[0]?.finish_reason,
            };
          }),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))),
};
