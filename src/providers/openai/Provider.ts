import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Stream } from 'effect';

import { Provider } from '../../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';

export class OpenAIProvider implements Provider {
  public readonly id = 'openai';
  public readonly name = 'OpenAI';

  public constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.openai.com/v1',
  ) {}

  public execute(request: InternalRequest): Effect.Effect<InternalResponse, Error, never> {
    const req = HttpClientRequest.post(`${this.baseURL}/chat/completions`).pipe(
      HttpClientRequest.setHeader('Authorization', `Bearer ${this.apiKey}`),
      HttpClientRequest.bodyJson(this.mapRequest(request)),
      Effect.catchAll((e) => Effect.fail(new Error(String(e)))),
    );

    return Effect.gen(this, function* (_) {
      const client = yield* _(HttpClient.HttpClient);
      const res = yield* _(req.pipe(Effect.flatMap((r) => client.execute(r))));
      const json: any = yield* _(res.json);
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

  public stream(_request: InternalRequest): Stream.Stream<InternalStreamChunk, Error, never> {
    return Stream.fail(new Error('Streaming not implemented yet for OpenAI provider'));
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
