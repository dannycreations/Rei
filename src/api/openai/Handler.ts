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
  content: Schema.Union(Schema.String, Schema.Array(OpenAIContent)),
  name: Schema.optional(Schema.String),
  tool_call_id: Schema.optional(Schema.String),
});

export const OpenAIRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(OpenAIMessage),
  temperature: Schema.optional(Schema.Number),
  max_tokens: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
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
        content: Schema.String,
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
  requestToInternal: (req: OpenAIRequest): InternalRequest => ({
    model: req.model,
    messages: req.messages.map((msg) => ({
      role: msg.role,
      content:
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', image: c.image_url.url })),
    })),
    temperature: req.temperature,
    topP: req.top_p,
    maxTokens: req.max_tokens,
    stream: req.stream ?? false,
    stop: typeof req.stop === 'string' ? [req.stop] : req.stop,
  }),

  internalToResponse: (res: InternalResponse): OpenAIResponse => ({
    id: res.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: res.model,
    choices: [
      {
        index: 0,
        message: {
          role: res.role,
          content: res.content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: res.usage.promptTokens,
      completion_tokens: res.usage.completionTokens,
      total_tokens: res.usage.totalTokens,
    },
  }),

  internalToStreamChunk: (chunk: InternalStreamChunk) => ({
    id: chunk.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'stream',
    choices: [
      {
        index: 0,
        delta: {
          content: chunk.content,
        },
        finish_reason: chunk.done ? 'stop' : null,
      },
    ],
  }),
};
