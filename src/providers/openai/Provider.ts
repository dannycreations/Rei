import { HttpClient, HttpClientRequest } from '@effect/platform';
import { Effect, Schema, Stream } from 'effect';

import { AuthTag } from '../../core/Auth.js';
import { Provider } from '../../core/Provider.js';
import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';
import { streamSSE } from '../../helpers/Server.js';

export const OpenAIAuth = Schema.Struct({
  apiKey: Schema.String,
  baseURL: Schema.optionalWith(Schema.String, { default: () => 'https://api.openai.com/v1' }),
});

export type OpenAIAuth = Schema.Schema.Type<typeof OpenAIAuth>;

const mapRequest = (request: InternalRequest) => {
  const messages = request.messages.map((m) => {
    if (m.role === 'tool') {
      const toolResult = Array.isArray(m.content) ? m.content[0] : { type: 'text', text: m.content };

      if (toolResult.type === 'tool_result') {
        return {
          role: 'tool',
          tool_call_id: toolResult.tool_use_id,
          content: typeof toolResult.content === 'string' ? toolResult.content : toolResult.content[0].text,
        };
      }
    }

    if (Array.isArray(m.content)) {
      const toolCalls = m.content
        .filter((c) => c.type === 'tool_use')
        .map((c) => ({
          id: c.id,
          type: 'function',
          function: {
            name: c.name,
            arguments: JSON.stringify(c.input),
          },
        }));

      const content = m.content
        .filter((c) => c.type === 'text' || c.type === 'image')
        .map((c) => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          if (c.type === 'image') return { type: 'image_url', image_url: { url: c.image } };
          return null;
        })
        .filter(Boolean);

      return {
        role: m.role,
        content: content.length > 0 ? content : null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    }

    return {
      role: m.role,
      content: m.content,
    };
  });

  if (request.system) {
    messages.unshift({
      role: 'system',
      content: request.system,
    });
  }

  return {
    model: request.model,
    messages,
    tools: request.tools?.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    })),
    tool_choice:
      typeof request.toolChoice === 'string'
        ? request.toolChoice === 'any'
          ? 'required'
          : request.toolChoice
        : request.toolChoice
          ? { type: 'function', function: { name: request.toolChoice.name } }
          : undefined,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    stream: request.stream,
    top_p: request.topP,
    top_k: request.topK,
    stop: request.stop,
  };
};

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
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: Array<{
              id: string;
              type: 'function';
              function: { name: string; arguments: string };
            }>;
          };
        }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        error?: { message?: string };
      };

      if (json.error) {
        return yield* Effect.fail(new Error(json.error.message || 'OpenAI API Error'));
      }

      const message = json.choices[0].message;
      const content: Array<InternalResponse['content'][number]> = [];

      if (message.content) {
        content.push({ type: 'text', text: message.content });
      }

      if (message.tool_calls) {
        for (const tc of message.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
      }

      return {
        id: json.id,
        model: json.model,
        content,
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
            const j = json as {
              id: string;
              choices: Array<{
                delta: {
                  content?: string | null;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
            };
            const delta = j.choices[0]?.delta;
            let content: InternalStreamChunk['content'] = { type: 'text_delta', text: delta?.content || '' };

            if (delta?.tool_calls) {
              const tc = delta.tool_calls[0];
              content = {
                type: 'tool_use_delta',
                index: tc.index,
                id: tc.id,
                name: tc.function?.name,
                input: tc.function?.arguments,
              };
            }

            return {
              id: j.id,
              content,
              done: !!j.choices[0]?.finish_reason,
            };
          }),
        );
      }),
    ).pipe(Stream.catchAll((e) => Stream.fail(new Error(String(e))))),
};
