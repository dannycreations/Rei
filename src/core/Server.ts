import { HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Option } from 'effect';

import { anthropicRouter } from '../api/anthropic/Router.js';
import { openAIRouter } from '../api/openai/Router.js';
import { isLocalhost } from '../helpers/Server.js';
import { ConfigTag } from './Config.js';

export const server = HttpRouter.empty.pipe(
  HttpRouter.mount('/openai', openAIRouter),
  HttpRouter.mount('/anthropic', anthropicRouter),
  HttpRouter.use(
    HttpMiddleware.make((httpApp) =>
      Effect.gen(function* () {
        const config = yield* ConfigTag;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const remoteAddress = Option.getOrElse(request.remoteAddress, () => '');

        // If it's localhost, we allow it to be without bearer token
        if (isLocalhost(remoteAddress)) {
          return yield* httpApp;
        }

        // If not localhost, we force authentication
        const authHeader = request.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return yield* HttpServerResponse.json({ error: 'Unauthorized: Missing or invalid Bearer token' }, { status: 401 });
        }

        if (!config['auth-keys'].includes(authHeader.substring(7))) {
          return yield* HttpServerResponse.json({ error: 'Unauthorized: Invalid auth key' }, { status: 401 });
        }

        return yield* httpApp;
      }),
    ),
  ),
);
