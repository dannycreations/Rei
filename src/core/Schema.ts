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
  Schema.Struct({
    type: Schema.Literal('tool_use'),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Any,
  }),
  Schema.Struct({
    type: Schema.Literal('tool_result'),
    tool_use_id: Schema.String,
    content: Schema.Union(Schema.String, Schema.Array(Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }))),
    is_error: Schema.optional(Schema.Boolean),
  }),
);

export const Message = Schema.Struct({
  role: MessageRole,
  content: Schema.Union(Schema.String, Schema.Array(MessageContent)),
});

export const Tool = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  input_schema: Schema.Any,
});

export const InternalRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(Message),
  system: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Array(Tool)),
  toolChoice: Schema.optional(
    Schema.Union(Schema.Literal('auto', 'none', 'any'), Schema.Struct({ type: Schema.Literal('tool'), name: Schema.String })),
  ),
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
  content: Schema.Array(MessageContent),
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
  content: Schema.Union(
    Schema.Struct({
      type: Schema.Literal('text_delta'),
      text: Schema.String,
    }),
    Schema.Struct({
      type: Schema.Literal('tool_use_delta'),
      index: Schema.Number,
      id: Schema.optional(Schema.String),
      name: Schema.optional(Schema.String),
      input: Schema.optional(Schema.String),
    }),
  ),
  done: Schema.Boolean,
});

export type InternalStreamChunk = Schema.Schema.Type<typeof InternalStreamChunk>;
