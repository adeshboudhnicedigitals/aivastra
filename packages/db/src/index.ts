import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type DB = PostgresJsDatabase<typeof schema>;

export function createDb(url: string): {
  db: DB;
  close: () => Promise<void>;
  withAdvisoryLock: <T>(lockKey: string, fn: (db: DB) => Promise<T>) => Promise<T>;
} {
  const client = postgres(url, { max: 10, prepare: false });
  const db = drizzle(client, { schema });

  /**
   * Holds a SESSION-scoped Postgres advisory lock (`pg_advisory_lock`, not the
   * transaction-scoped `pg_advisory_xact_lock` used elsewhere in this codebase)
   * across the whole callback, including any awaited external calls inside it.
   *
   * A transaction-scoped lock releases at its own transaction's COMMIT, which
   * cannot span an external network call (e.g. a Shopify charge) without
   * either (a) holding one giant transaction open across that call — which
   * would roll back an already-committed audit row on a mid-call crash, or
   * (b) releasing the lock before the external call even starts, reopening
   * the window for a second caller to slip in. This reserves a single
   * connection out of the pool for the duration, acquires the lock on it, and
   * releases both in a `finally` regardless of outcome — so the caller can
   * still commit intermediate transactions on `db` (the scoped client passed
   * to `fn`) as separate, durable steps while the lock keeps a second caller
   * out for the full operation.
   */
  async function withAdvisoryLock<T>(lockKey: string, fn: (db: DB) => Promise<T>): Promise<T> {
    const reserved = await client.reserve();
    // postgres.js's reserve() returns a bare Sql handle built from its inner
    // Sql(handler) factory. Two things the top-level pooled client gets via a
    // separate Object.assign in its own factory are missing from it, both
    // confirmed with isolated repro scripts (not a race — reproduces every
    // single time, on the very first call):
    //
    // 1. `.options` — drizzle-orm's postgres-js driver unconditionally reads
    //    client.options.parsers/serializers at construction time, so passing
    //    `reserved` straight to drizzle() throws "Cannot read properties of
    //    undefined (reading 'parsers')". `options` describes shared parsing/
    //    serialization config for the whole pool (every pooled connection is
    //    built from this same object internally, per postgres.js's own
    //    source), not per-connection state, so borrowing the reference from
    //    `client` is correct, not a workaround that changes behavior.
    // 2. `.begin` / `.savepoint` — drizzle's `db.transaction()` calls
    //    `client.begin(cb)`, and a transaction's own nested `tx.transaction()`
    //    (used by `grantStore` when composed inside a caller's transaction,
    //    e.g. `grantStore(tx as never, ...)`) calls `client.savepoint(cb)`.
    //    Neither exists on a reserved connection — postgres.js's own docs
    //    scope `reserve()` to raw tagged-template queries only ("This can be
    //    used for running queries on an isolated connection"); `.begin`'s
    //    real implementation lives in the pool factory and reserves its own
    //    connection internally, incompatible with reusing one we already
    //    reserved. Since `reserved` is already a single dedicated connection
    //    for the whole withAdvisoryLock call, everything issued through it is
    //    inherently serialized on one session — so BEGIN/COMMIT/ROLLBACK and
    //    SAVEPOINT/RELEASE/ROLLBACK TO are safe to issue by hand here and
    //    give drizzle exactly the interface it expects. Verified against
    //    nested transactions, sequential (non-nested) transactions, and
    //    rollback-on-throw, all on one reserved connection, before wiring
    //    this into any real code path.
    const txCapable = reserved as unknown as {
      options: typeof client.options;
      begin<R>(fn: (sql: typeof reserved) => R | Promise<R>): Promise<R>;
      savepoint<R>(fn: (sql: typeof reserved) => R | Promise<R>): Promise<R>;
    };
    txCapable.options = client.options;
    txCapable.begin = async (fn2) => {
      await reserved`BEGIN`;
      try {
        const result = await fn2(reserved);
        await reserved`COMMIT`;
        return result;
      } catch (e) {
        await reserved`ROLLBACK`;
        throw e;
      }
    };
    let savepointCounter = 0;
    txCapable.savepoint = async (fn2) => {
      // Postgres savepoint names must be valid identifiers; a per-connection
      // counter is enough since only one call ever owns this reserved
      // connection at a time.
      const name = `sp_${savepointCounter++}`;
      await reserved.unsafe(`SAVEPOINT ${name}`);
      try {
        const result = await fn2(reserved);
        await reserved.unsafe(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (e) {
        await reserved.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
        throw e;
      }
    };

    const scopedDb = drizzle(reserved, { schema });
    try {
      await reserved`select pg_advisory_lock(hashtextextended(${lockKey}, 0))`;
      return await fn(scopedDb);
    } finally {
      await reserved`select pg_advisory_unlock(hashtextextended(${lockKey}, 0))`;
      reserved.release();
    }
  }

  return { db, close: () => client.end({ timeout: 5 }), withAdvisoryLock };
}

export { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
export * as schema from './schema/index.js';
export type {
  ShopifyWidgetBehavior,
  ShopifyWidgetConfig,
  ShopifyWidgetCopy,
  ShopifyWidgetTheme,
} from './schema/shopify.js';
