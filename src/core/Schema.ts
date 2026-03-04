import { Schema } from 'effect';

export const MessageRole = Schema.Literal('user', 'assistant', 'system', 'tool');

export const MessageContent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('text'),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal('image'),
    image: Schema.String, // base64 or url
  }),
);

export const Message = Schema.Struct({
  role: MessageRole,
  content: Schema.Union(Schema.String, Schema.Array(MessageContent)),
});

export const InternalRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(Message),
  system: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  stream: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  stop: Schema.optional(Schema.Array(Schema.String)),
});

export type InternalRequest = Schema.Schema.Type<typeof InternalRequest>;

export const InternalResponse = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  content: Schema.String,
  role: MessageRole,
  usage: Schema.Struct({
    promptTokens: Schema.Number,
    completionTokens: Schema.Number,
    totalTokens: Schema.Number,
  }),
});

export type InternalResponse = Schema.Schema.Type<typeof InternalResponse>;

export const InternalStreamChunk = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  done: Schema.Boolean,
});

export type InternalStreamChunk = Schema.Schema.Type<typeof InternalStreamChunk>;
