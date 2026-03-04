import { FileSystem } from '@effect/platform';
import { Context, Effect, Layer, Ref, Schema } from 'effect';

import { ConfigTag } from './Config.js';

export const OAuthCredentials = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  token_type: Schema.String,
  expiry_date: Schema.Number,
});

export type OAuthCredentials = Schema.Schema.Type<typeof OAuthCredentials>;

export const AuthTag = Context.GenericTag<Auth>('@rei/core/Auth');

export interface Auth {
  readonly credentials: ReadonlyArray<OAuthCredentials>;
  readonly next: () => Effect.Effect<OAuthCredentials, Error>;
}

export const make = (credentials: ReadonlyArray<OAuthCredentials>, strategy: 'round-robin' | 'fill-first', index: Ref.Ref<number>): Auth => {
  const next = () =>
    Effect.gen(function* () {
      if (credentials.length === 0) {
        return yield* Effect.fail(new Error('No credentials available'));
      }

      const i = yield* Ref.get(index);

      if (strategy === 'round-robin') {
        yield* Ref.set(index, (i + 1) % credentials.length);
        return credentials[i];
      }

      // fill-first: always try the first one until it fails (logic for failure not here, just returning first)
      return credentials[0];
    });

  return {
    credentials,
    next,
  };
};

const loadAuthFile = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const content = yield* fs.readFileString(path);
    const json = yield* Effect.try({
      try: () => JSON.parse(content),
      catch: (e) => new Error(`Failed to parse auth file ${path}: ${e}`),
    });
    return yield* Schema.decodeUnknown(OAuthCredentials)(json);
  });

export const AuthLive = (paths: ReadonlyArray<string>, dirs: ReadonlyArray<string>) =>
  Layer.effect(
    AuthTag,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ConfigTag;
      const filePaths = [...paths];

      for (const dir of dirs) {
        const files = yield* fs.readDirectory(dir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            filePaths.push(`${dir}/${file}`);
          }
        }
      }

      const credentials = yield* Effect.forEach(filePaths, loadAuthFile, {
        concurrency: 'inherit',
      });

      const index = yield* Ref.make(0);
      const strategy = config['routing-strategy'];

      return make(credentials, strategy, index);
    }),
  );
