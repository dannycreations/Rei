import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Stream } from 'effect';

import { Provider } from '../../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';

export class AnthropicProvider implements Provider {
  public readonly id = 'anthropic';
  public readonly name = 'Anthropic';

  public constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.anthropic.com/v1',
  ) {}

  public execute(request: InternalRequest): Effect.Effect<InternalResponse, Error, never> {
    const req = HttpClientRequest.post(`${this.baseURL}/messages`).pipe(
      HttpClientRequest.setHeader('x-api-key', this.apiKey),
      HttpClientRequest.setHeader('anthropic-version', '2023-06-01'),
      HttpClientRequest.bodyJson(this.mapRequest(request)),
      Effect.catchAll((e) => Effect.fail(new Error(String(e)))),
    );

    return Effect.gen(this, function* () {
      const client = yield* HttpClient.HttpClient;
      const res = yield* req.pipe(Effect.flatMap((r) => client.execute(r)));
      const json: any = yield* res.json;
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

  public stream(_request: InternalRequest): Stream.Stream<InternalStreamChunk, Error, never> {
    return Stream.fail(new Error('Streaming not implemented yet for Anthropic provider'));
  }

  private mapRequest(request: InternalRequest) {
    return {
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 4096,
      stream: request.stream,
    };
  }
}
