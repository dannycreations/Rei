import { FileSystem } from '@effect/platform';
import { Context, Effect, Layer, Ref, Schema } from 'effect';

import { ConfigTag } from './Config.js';

export interface AuthSession<T> {
  readonly data: T;
  readonly save: (data: T) => Effect.Effect<void, Error>;
}

export const AuthTag = Context.GenericTag<Auth>('@rei/core/Auth');

export interface Auth {
  readonly next: <T, I>(providerId: string, schema: Schema.Schema<T, I>) => Effect.Effect<AuthSession<T>, Error>;
  readonly load: <T, I>(providerId: string, idOrPath: string, schema: Schema.Schema<T, I>) => Effect.Effect<AuthSession<T>, Error>;
}

interface InternalCredential {
  readonly providerId: string;
  readonly path: string;
  readonly data: any;
}

export const AuthLive = (paths: ReadonlyArray<string>, dirs: ReadonlyArray<string>) =>
  Layer.effect(
    AuthTag,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ConfigTag;
      const filePathsSet = new Set<string>(paths);

      for (const dir of dirs) {
        try {
          const files = yield* fs.readDirectory(dir);
          for (const file of files) {
            if (file.endsWith('.json')) {
              filePathsSet.add(`${dir}/${file}`);
            }
          }
        } catch (e) {
          yield* Effect.logWarning(`Failed to read directory ${dir}: ${e}`);
        }
      }

      const loadInternal = (path: string) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(path);
          const json = yield* Effect.try({
            try: () => JSON.parse(content),
            catch: (e) => new Error(`Failed to parse auth file ${path}: ${e}`),
          });
          const providerId = json.provider || json.providerId || 'unknown';
          return { providerId, path, data: json } as InternalCredential;
        });

      const rawCredentials = yield* Effect.forEach(Array.from(filePathsSet), loadInternal, {
        concurrency: 'inherit',
      });

      const credentialsRef = yield* Ref.make(rawCredentials);
      const indicesRef = yield* Ref.make<Record<string, number>>({});
      const strategy = config['routing-strategy'];

      const createSession = <T, I>(cred: InternalCredential, schema: Schema.Schema<T, I>): Effect.Effect<AuthSession<T>, Error> =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknown(schema)(cred.data);

          return {
            data: decoded,
            save: (newData: T) =>
              Effect.gen(function* () {
                const encoded = yield* Schema.encodeUnknown(schema)(newData);
                const toSave = { ...cred.data, ...(encoded as any), provider: cred.providerId };
                yield* fs.writeFileString(cred.path, JSON.stringify(toSave, null, 2)).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e)))));

                yield* Ref.update(credentialsRef, (prev) => prev.map((p) => (p.path === cred.path ? { ...p, data: toSave } : p)));
              }),
          };
        });

      const next = <T, I>(providerId: string, schema: Schema.Schema<T, I>): Effect.Effect<AuthSession<T>, Error> =>
        Effect.gen(function* () {
          const all = yield* Ref.get(credentialsRef);
          const filtered = all.filter((c) => c.providerId === providerId);

          if (filtered.length === 0) {
            return yield* Effect.fail(new Error(`No credentials available for provider: ${providerId}`));
          }

          const indices = yield* Ref.get(indicesRef);
          const i = indices[providerId] ?? 0;
          const cred = strategy === 'round-robin' ? filtered[i % filtered.length] : filtered[0];

          if (strategy === 'round-robin') {
            yield* Ref.update(indicesRef, (prev) => ({
              ...prev,
              [providerId]: (i + 1) % filtered.length,
            }));
          }

          return yield* createSession(cred, schema);
        });

      const load = <T, I>(providerId: string, idOrPath: string, schema: Schema.Schema<T, I>): Effect.Effect<AuthSession<T>, Error> =>
        Effect.gen(function* () {
          const all = yield* Ref.get(credentialsRef);

          // Try to find by path or some internal ID (if we added it)
          let cred = all.find((c) => (c.path === idOrPath || c.data.id === idOrPath) && c.providerId === providerId);

          if (!cred) {
            // If not found in memory, try to load from disk directly (it might be a new path)
            try {
              cred = yield* loadInternal(idOrPath);
              if (cred.providerId !== providerId) {
                return yield* Effect.fail(new Error(`Credential at ${idOrPath} belongs to ${cred.providerId}, not ${providerId}`));
              }
              yield* Ref.update(credentialsRef, (prev) => [...prev, cred!]);
            } catch (e) {
              return yield* Effect.fail(new Error(`Failed to load credential for ${providerId} at ${idOrPath}: ${e}`));
            }
          }

          return yield* createSession(cred, schema);
        });

      return {
        next,
        load,
      };
    }),
  );
