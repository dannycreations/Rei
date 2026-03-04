import { Schema } from 'effect';

import { InternalRequest, InternalResponse } from '../../core/Schema.js';

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
  stream: Schema.optional(Schema.Boolean),
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

export const requestToInternal = (req: AnthropicRequest): InternalRequest => {
  const messages: Array<InternalRequest['messages'][number]> = [];

  if (req.system) {
    messages.push({
      role: 'system',
      content: req.system,
    });
  }

  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    } else {
      messages.push({
        role: msg.role,
        content: msg.content.map((c) => {
          if (c.type === 'text') {
            return { type: 'text', text: c.text };
          } else {
            // Anthropic image to internal image format
            // Internal image is currently just a string (base64 or url)
            // Anthropic has a more complex structure
            return { type: 'image', image: c.source.data };
          }
        }),
      });
    }
  }

  return {
    model: req.model,
    messages: messages as InternalRequest['messages'],
    maxTokens: req.max_tokens,
    temperature: req.temperature,
    stream: req.stream ?? false,
  };
};

export const internalToResponse = (res: InternalResponse): AnthropicResponse => ({
  id: res.id,
  type: 'message',
  role: res.role === 'assistant' ? 'assistant' : 'user', // Anthropic only supports user/assistant in messages
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
});
