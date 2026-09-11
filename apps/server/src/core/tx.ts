import type { DB } from './db.js';

/** Crash-atomic wrapper for multi-statement mutations. Savepoints nest, so engine ops
 * can compose (buyListing → postTx) without tracking transaction state. */
let txDepth = 0;
export function withTx<T>(db: DB, fn: () => T): T {
  const name = `sp${txDepth++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (e) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw e;
  } finally {
    txDepth--;
  }
}
