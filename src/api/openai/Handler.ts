import { Schema } from 'effect';

import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';

import type { ApiHandler } from '../../core/Server.js';

export const OpenAIMessageRole = Schema.Literal('user', 'assistant', 'system', 'tool');

export const OpenAIContent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('text'),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('image_url'),
    image_url: Schema.Struct({
      url: Schema.String,
    }),
  }),
);

export const OpenAIMessage = Schema.Struct({
  role: OpenAIMessageRole,
  content: Schema.Union(Schema.String, Schema.Array(OpenAIContent), Schema.Null),
  name: Schema.optional(Schema.String),
  tool_call_id: Schema.optional(Schema.String),
  tool_calls: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        type: Schema.Literal('function'),
        function: Schema.Struct({
          name: Schema.String,
          arguments: Schema.String,
        }),
      }),
    ),
  ),
});

export const OpenAIRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(OpenAIMessage),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literal('function'),
        function: Schema.Struct({
          name: Schema.String,
          description: Schema.optional(Schema.String),
          parameters: Schema.Any,
        }),
      }),
    ),
  ),
  tool_choice: Schema.optional(
    Schema.Union(
      Schema.Literal('auto', 'none', 'required'),
      Schema.Struct({
        type: Schema.Literal('function'),
        function: Schema.Struct({
          name: Schema.String,
        }),
      }),
    ),
  ),
  temperature: Schema.optional(Schema.Number),
  max_tokens: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  top_k: Schema.optional(Schema.Number),
  stream: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  stop: Schema.optional(Schema.Union(Schema.String, Schema.Array(Schema.String))),
});

export type OpenAIRequest = Schema.Schema.Type<typeof OpenAIRequest>;

export const OpenAIResponse = Schema.Struct({
  id: Schema.String,
  object: Schema.Literal('chat.completion'),
  created: Schema.Number,
  model: Schema.String,
  choices: Schema.Array(
    Schema.Struct({
      index: Schema.Number,
      message: Schema.Struct({
        role: OpenAIMessageRole,
        content: Schema.Union(Schema.String, Schema.Null),
        tool_calls: Schema.optional(
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              type: Schema.Literal('function'),
              function: Schema.Struct({
                name: Schema.String,
                arguments: Schema.String,
              }),
            }),
          ),
        ),
      }),
      finish_reason: Schema.String,
    }),
  ),
  usage: Schema.Struct({
    prompt_tokens: Schema.Number,
    completion_tokens: Schema.Number,
    total_tokens: Schema.Number,
  }),
});

export type OpenAIResponse = Schema.Schema.Type<typeof OpenAIResponse>;

export const OpenAIHandler: ApiHandler<OpenAIRequest, OpenAIResponse> = {
  requestToInternal: (req: OpenAIRequest): InternalRequest => {
    const systemMessages = req.messages.filter((m) => m.role === 'system');
    const system =
      systemMessages.length > 0
        ? systemMessages
            .map((m) => {
              if (typeof m.content === 'string') return m.content;
              if (Array.isArray(m.content)) {
                return m.content
                  .map((c) => (c.type === 'text' ? c.text : ''))
                  .filter(Boolean)
                  .join('\n');
              }
              return '';
            })
            .filter(Boolean)
            .join('\n\n')
        : undefined;

    return {
      model: req.model,
      system,
      messages: req.messages.flatMap((msg) => {
        if (msg.role === 'system') return [];
        const messages: Array<InternalRequest['messages'][number]> = [];

        if (msg.role === 'tool') {
          messages.push({
            role: 'tool',
            content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id!, content: msg.content as string }],
          });
        } else {
          const content: Array<Extract<InternalRequest['messages'][number]['content'], ReadonlyArray<unknown>>[number]> = [];

          if (typeof msg.content === 'string') {
            content.push({ type: 'text', text: msg.content });
          } else if (Array.isArray(msg.content)) {
            for (const c of msg.content) {
              if (c.type === 'text') {
                content.push({ type: 'text', text: c.text });
              } else if (c.type === 'image_url') {
                content.push({ type: 'image', image: c.image_url.url });
              }
            }
          }

          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments),
              });
            }
          }

          messages.push({ role: msg.role, content });
        }

        return messages;
      }),
      tools: req.tools?.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
      toolChoice:
        typeof req.tool_choice === 'string'
          ? req.tool_choice === 'required'
            ? 'any'
            : req.tool_choice
          : req.tool_choice
            ? { type: 'tool', name: req.tool_choice.function.name }
            : undefined,
      temperature: req.temperature,
      topP: req.top_p,
      topK: req.top_k,
      maxTokens: req.max_tokens,
      stream: req.stream ?? false,
      stop: typeof req.stop === 'string' ? [req.stop] : req.stop,
    };
  },

  internalToResponse: (res: InternalResponse): OpenAIResponse => {
    const textContent = res.content.find((c) => c.type === 'text');
    const toolCalls = res.content.flatMap((c) => {
      if (c.type === 'tool_use') {
        return [
          {
            id: c.id,
            type: 'function' as const,
            function: {
              name: c.name,
              arguments: JSON.stringify(c.input),
            },
          },
        ];
      }
      return [];
    });

    return {
      id: res.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: res.model,
      choices: [
        {
          index: 0,
          message: {
            role: res.role,
            content: textContent?.type === 'text' ? textContent.text : null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        },
      ],
      usage: {
        prompt_tokens: res.usage.promptTokens,
        completion_tokens: res.usage.completionTokens,
        total_tokens: res.usage.totalTokens,
      },
    };
  },

  internalToStreamChunk: (chunk: InternalStreamChunk) => ({
    id: chunk.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'stream',
    choices: [
      {
        index: 0,
        delta:
          chunk.content.type === 'text_delta'
            ? { content: chunk.content.text }
            : {
                tool_calls: [
                  {
                    index: chunk.content.index,
                    id: chunk.content.id,
                    type: 'function',
                    function: {
                      name: chunk.content.name,
                      arguments: chunk.content.input,
                    },
                  },
                ],
              },
        finish_reason: chunk.done ? (chunk.content.type === 'tool_use_delta' ? 'tool_calls' : 'stop') : null,
      },
    ],
  }),
};
