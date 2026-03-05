import { Schema } from 'effect';

import { InternalRequest, InternalResponse, InternalStreamChunk } from '../../core/Schema.js';

import type { ApiHandler } from '../../core/Server.js';

export const AnthropicMessageRole = Schema.Literal('user', 'assistant');

export const AnthropicContent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('text'),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('image'),
    source: Schema.Struct({
      type: Schema.Literal('base64'),
      media_type: Schema.String,
      data: Schema.String,
    }),
  }),
);

export const AnthropicMessage = Schema.Struct({
  role: AnthropicMessageRole,
  content: Schema.Union(Schema.String, Schema.Array(AnthropicContent)),
});

export const AnthropicRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(AnthropicMessage),
  system: Schema.optional(Schema.String),
  max_tokens: Schema.Number,
  temperature: Schema.optional(Schema.Number),
  top_p: Schema.optional(Schema.Number),
  stream: Schema.optional(Schema.Boolean),
  stop_sequences: Schema.optional(Schema.Array(Schema.String)),
});

export type AnthropicRequest = Schema.Schema.Type<typeof AnthropicRequest>;

export const AnthropicResponse = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('message'),
  role: AnthropicMessageRole,
  content: Schema.Array(
    Schema.Struct({
      type: Schema.Literal('text'),
      text: Schema.String,
    }),
  ),
  model: Schema.String,
  stop_reason: Schema.Union(Schema.Literal('end_turn', 'max_tokens', 'stop_sequence', 'tool_use'), Schema.Null),
  stop_sequence: Schema.Union(Schema.String, Schema.Null),
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number,
  }),
});

export type AnthropicResponse = Schema.Schema.Type<typeof AnthropicResponse>;

export const AnthropicHandler: ApiHandler<AnthropicRequest, AnthropicResponse> = {
  requestToInternal: (req: AnthropicRequest): InternalRequest => ({
    model: req.model,
    system: req.system,
    messages: req.messages.map((msg) => ({
      role: msg.role,
      content:
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((c) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: 'image', image: c.source.data })),
    })),
    maxTokens: req.max_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    stream: req.stream ?? false,
    stop: req.stop_sequences,
  }),

  internalToResponse: (res: InternalResponse): AnthropicResponse => ({
    id: res.id,
    type: 'message',
    role: res.role === 'assistant' ? 'assistant' : 'user',
    content: [
      {
        type: 'text',
        text: res.content,
      },
    ],
    model: res.model,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: res.usage.promptTokens,
      output_tokens: res.usage.completionTokens,
    },
  }),

  internalToStreamChunk: (chunk: InternalStreamChunk) => {
    if (chunk.done) {
      return {
        type: 'message_stop',
      };
    }
    return {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: chunk.content,
      },
    };
  },
};
