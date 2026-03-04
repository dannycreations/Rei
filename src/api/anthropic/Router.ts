import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { ProviderRegistry } from '../../core/Provider.js';
import { InternalRequest } from '../../core/Schema.js';

export const anthropicRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/messages',
    Effect.gen(function* (_) {
      const registry = yield* _(ProviderRegistry);
      const body: any = yield* _(HttpServerRequest.schemaBodyJson(InternalRequest));

      const provider = yield* _(registry.getProvider(body.model));
      const response = yield* _(provider.execute(body));

      return yield* _(
        HttpServerResponse.json({
          id: response.id,
          type: 'message',
          role: response.role,
          content: [
            {
              type: 'text',
              text: response.content,
            },
          ],
          model: response.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: response.usage.promptTokens,
            output_tokens: response.usage.completionTokens,
          },
        }),
      );
    }),
  ),
);
