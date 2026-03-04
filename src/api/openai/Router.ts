import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

import { ProviderRegistry } from '../../core/Provider.js';
import { InternalRequest } from '../../core/Schema.js';

export const openAIRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/v1/chat/completions',
    Effect.gen(function* (_) {
      const registry = yield* _(ProviderRegistry);
      const body = yield* _(HttpServerRequest.schemaBodyJson(InternalRequest));

      const provider = yield* _(registry.getProvider(body.model));
      const response = yield* _(provider.execute(body));

      return yield* _(
        HttpServerResponse.json({
          id: response.id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: response.model,
          choices: [
            {
              index: 0,
              message: {
                role: response.role,
                content: response.content,
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: response.usage.promptTokens,
            completion_tokens: response.usage.completionTokens,
            total_tokens: response.usage.totalTokens,
          },
        }),
      );
    }),
  ),
);
