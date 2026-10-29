import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface DbClientOptions {
  path?: string;
  readonly?: boolean;
}

export function createDb(options: DbClientOptions = {}): Database.Database {
  const dbPath = options.path ?? ':memory:';

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath, {
    readonly: options.readonly ?? false,
  });

  // Enforce foreign keys on every connection
  db.pragma('foreign_keys = ON');

  // Use WAL mode for persistent database files to enable concurrent readers safely
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  return db;
}
