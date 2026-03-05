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

export const AnthropicMessage = Schema.Struct({
  role: AnthropicMessageRole,
  content: Schema.Union(Schema.String, Schema.Array(AnthropicContent)),
});

export const AnthropicRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(AnthropicMessage),
  system: Schema.optional(Schema.String),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.optional(Schema.String),
        input_schema: Schema.Any,
      }),
    ),
  ),
  tool_choice: Schema.optional(
    Schema.Union(
      Schema.Struct({ type: Schema.Literal('auto') }),
      Schema.Struct({ type: Schema.Literal('any') }),
      Schema.Struct({ type: Schema.Literal('tool'), name: Schema.String }),
    ),
  ),
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
    Schema.Union(
      Schema.Struct({
        type: Schema.Literal('text'),
        text: Schema.String,
      }),
      Schema.Struct({
        type: Schema.Literal('tool_use'),
        id: Schema.String,
        name: Schema.String,
        input: Schema.Any,
      }),
    ),
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
          : msg.content.map((c) => {
              if (c.type === 'text') return { type: 'text', text: c.text };
              if (c.type === 'image') return { type: 'image', image: c.source.data };
              if (c.type === 'tool_use') return { type: 'tool_use', id: c.id, name: c.name, input: c.input };
              return { type: 'tool_result', tool_use_id: c.tool_use_id, content: c.content, is_error: c.is_error };
            }),
    })),
    tools: req.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    })),
    toolChoice: req.tool_choice?.type === 'tool' ? { type: 'tool', name: req.tool_choice.name } : req.tool_choice?.type,
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
    content: res.content.flatMap((c): Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }> => {
      if (c.type === 'text') return [{ type: 'text', text: c.text }];
      if (c.type === 'tool_use') return [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }];
      return [];
    }),
    model: res.model,
    stop_reason: res.content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn',
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
    if (chunk.content.type === 'text_delta') {
      return {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: chunk.content.text,
        },
      };
    } else {
      return {
        type: 'content_block_delta',
        index: chunk.content.index,
        delta: {
          type: 'input_json_delta',
          partial_json: chunk.content.input ?? '',
        },
      };
    }
  },
};

export const AnthropicCountTokensRequest = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(AnthropicMessage),
  system: Schema.optional(Schema.String),
  tools: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.optional(Schema.String),
        input_schema: Schema.Any,
      }),
    ),
  ),
});

export type AnthropicCountTokensRequest = Schema.Schema.Type<typeof AnthropicCountTokensRequest>;

export const AnthropicCountTokensResponse = Schema.Struct({
  input_tokens: Schema.Number,
});

export type AnthropicCountTokensResponse = Schema.Schema.Type<typeof AnthropicCountTokensResponse>;

export const ClaudeCountTokensHandler: ApiHandler<AnthropicCountTokensRequest, AnthropicCountTokensResponse> = {
  requestToInternal: (req) => AnthropicHandler.requestToInternal({ ...req, max_tokens: 1 }),
  internalToResponse: (res) => ({ input_tokens: res.usage.promptTokens }),
  internalToStreamChunk: () => ({}),
};
