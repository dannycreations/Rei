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
  readonly data: unknown;
}

export const AuthLive = (paths: ReadonlyArray<string>, dirs: ReadonlyArray<string>) =>
  Layer.effect(
    AuthTag,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ConfigTag;

      const scanDirs = Effect.forEach(
        dirs,
        (dir) =>
          fs.readDirectory(dir).pipe(
            Effect.map((files) => files.filter((f) => f.endsWith('.json')).map((f) => `${dir}/${f}`)),
            Effect.catchAll((e) => Effect.logWarning(`Failed to read directory ${dir}: ${e}`).pipe(Effect.as([] as string[]))),
          ),
        { concurrency: 'inherit' },
      ).pipe(Effect.map((paths) => paths.flat()));

      const allPaths = yield* scanDirs.pipe(Effect.map((dirPaths) => Array.from(new Set([...paths, ...dirPaths]))));

      const loadInternal = (path: string) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(path);
          const json = yield* Effect.try({
            try: () => JSON.parse(content),
            catch: (e) => new Error(`Failed to parse auth file ${path}: ${e}`),
          });
          const providerId = (json as Record<string, unknown>).provider || (json as Record<string, unknown>).providerId || 'unknown';
          return { providerId: String(providerId), path, data: json };
        });

      const rawCredentials = yield* Effect.forEach(allPaths, loadInternal, {
        concurrency: 'inherit',
      });

      const credentialsByProvider = new Map<string, InternalCredential[]>();
      for (const cred of rawCredentials) {
        const list = credentialsByProvider.get(cred.providerId) || [];
        list.push(cred);
        credentialsByProvider.set(cred.providerId, list);
      }

      const credentialsRef = yield* Ref.make(rawCredentials);
      const credentialsByProviderRef = yield* Ref.make(credentialsByProvider);
      const indicesRef = yield* Ref.make<Record<string, number>>({});
      const strategy = config['routing-strategy'];

      const updateCredentials = (cred: InternalCredential, toSave: unknown) =>
        Effect.all([
          Ref.update(credentialsRef, (prev) => prev.map((p) => (p.path === cred.path ? { ...p, data: toSave } : p))),
          Ref.update(credentialsByProviderRef, (prev) => {
            const next = new Map(prev);
            const list = next.get(cred.providerId) || [];
            next.set(
              cred.providerId,
              list.map((p) => (p.path === cred.path ? { ...p, data: toSave } : p)),
            );
            return next;
          }),
        ]);

      const createSession = <T, I>(cred: InternalCredential, schema: Schema.Schema<T, I>): Effect.Effect<AuthSession<T>, Error> =>
        Effect.gen(function* () {
          const decoded = yield* Schema.decodeUnknown(schema)(cred.data).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e)))));

          return {
            data: decoded,
            save: (newData: T) =>
              Effect.gen(function* () {
                const encoded = yield* Schema.encodeUnknown(schema)(newData).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e)))));
                const toSave = {
                  ...(cred.data as Record<string, unknown>),
                  ...(encoded as Record<string, unknown>),
                  provider: cred.providerId,
                };
                yield* fs.writeFileString(cred.path, JSON.stringify(toSave, null, 2)).pipe(Effect.catchAll((e) => Effect.fail(new Error(String(e)))));

                yield* updateCredentials(cred, toSave);
              }),
          };
        });

      const next = <T, I>(providerId: string, schema: Schema.Schema<T, I>): Effect.Effect<AuthSession<T>, Error> =>
        Effect.gen(function* () {
          const byProvider = yield* Ref.get(credentialsByProviderRef);
          const filtered = byProvider.get(providerId) || [];

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

          const existing = all.find(
            (c) => (c.path === idOrPath || (c.data as Record<string, unknown>).id === idOrPath) && c.providerId === providerId,
          );

          if (existing) {
            return yield* createSession(existing, schema);
          }

          const cred = yield* loadInternal(idOrPath).pipe(
            Effect.map((c) => (c.providerId === 'unknown' ? { ...c, providerId } : c)),
            Effect.filterOrFail(
              (c) => c.providerId === providerId,
              (c) => new Error(`Credential at ${idOrPath} belongs to ${c.providerId}, not ${providerId}`),
            ),
            Effect.tap((c) =>
              Effect.all([
                Ref.update(credentialsRef, (prev) => [...prev, c]),
                Ref.update(credentialsByProviderRef, (prev) => {
                  const next = new Map(prev);
                  const list = next.get(c.providerId) || [];
                  next.set(c.providerId, [...list, c]);
                  return next;
                }),
              ]),
            ),
            Effect.catchAll((e) => Effect.fail(new Error(`Failed to load credential for ${providerId} at ${idOrPath}: ${e}`))),
          );

          return yield* createSession(cred, schema);
        });

      return {
        next,
        load,
      };
    }),
  );
