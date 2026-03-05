import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Option, Schema, Stream } from 'effect';

import { AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';
import { streamSSE } from '../../helpers/Server.js';

export const AnthropicAuth = Schema.Struct({
  apiKey: Schema.String,
  baseURL: Schema.optionalWith(Schema.String, { default: () => 'https://api.anthropic.com/v1' }),
});

export type AnthropicAuth = Schema.Schema.Type<typeof AnthropicAuth>;

const mapRequest = (request: InternalRequest) => ({
  model: request.model,
  system: request.system,
  messages: request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role,
      content:
        typeof m.content === 'string'
          ? m.content
          : m.content.map((c) => {
              if (c.type === 'text') return { type: 'text', text: c.text };
              if (c.type === 'image')
                return {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/jpeg', data: c.image },
                };
              if (c.type === 'tool_use') return { type: 'tool_use', id: c.id, name: c.name, input: c.input };
              if (c.type === 'tool_result')
                return {
                  type: 'tool_result',
                  tool_use_id: c.tool_use_id,
                  content: c.content,
                  is_error: c.is_error,
                };
              return null;
            }),
    })),
  tools: request.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  })),
  tool_choice:
    typeof request.toolChoice === 'string'
      ? { type: request.toolChoice }
      : request.toolChoice
        ? { type: 'tool', name: request.toolChoice.name }
        : undefined,
  max_tokens: request.maxTokens ?? 4096,
  temperature: request.temperature,
  top_p: request.topP,
  stop_sequences: request.stop,
  stream: request.stream,
});

export const AnthropicProvider: Provider = {
  id: 'anthropic',
  name: 'Anthropic',
  models: [],

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
      const json = (yield* res.json) as {
        id: string;
        model: string;
        content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>;
        usage: { input_tokens: number; output_tokens: number };
        error?: { message?: string };
      };

      if (json.error) {
        return yield* Effect.fail(new Error(json.error.message || 'Anthropic API Error'));
      }

      return {
        id: json.id,
        model: json.model,
        content: json.content.map((c): InternalResponse['content'][number] => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          return { type: 'tool_use', id: c.id, name: c.name, input: c.input };
        }),
        role: 'assistant' as const,
        usage: {
          promptTokens: json.usage.input_tokens,
          completionTokens: json.usage.output_tokens,
          totalTokens: json.usage.input_tokens + json.usage.output_tokens,
        },
      };
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

        return streamSSE(res.stream).pipe(
          Stream.filterMap((json): Option.Option<InternalStreamChunk> => {
            const j = json as {
              type: string;
              index?: number;
              delta?: { text?: string; partial_json?: string };
            };
            if (j.type === 'content_block_delta') {
              let content: InternalStreamChunk['content'] = {
                type: 'text_delta',
                text: j.delta?.text || '',
              };
              if (j.delta?.partial_json) {
                content = {
                  type: 'tool_use_delta',
                  index: j.index ?? 0,
                  input: j.delta.partial_json,
                };
              }
              return Option.some({
                id: 'stream',
                content,
                done: false,
              });
            }
            if (j.type === 'content_block_start') {
              const start = j as { content_block?: { type: string; id: string; name: string } };
              if (start.content_block?.type === 'tool_use') {
                return Option.some({
                  id: 'stream',
                  content: {
                    type: 'tool_use_delta',
                    index: j.index ?? 0,
                    id: start.content_block.id,
                    name: start.content_block.name,
                  },
                  done: false,
                });
              }
            }
            if (j.type === 'message_delta') {
              const delta = j as { delta?: { stop_reason?: string } };
              if (delta.delta?.stop_reason) {
                return Option.some({
                  id: 'stream',
                  content: { type: 'text_delta', text: '' },
                  done: true,
                });
              }
            }
            return Option.none();
          }),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))),
};
