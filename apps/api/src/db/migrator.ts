import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Migration {
  id: string;
  sql: string;
}

export function loadMigrationsFromDir(migrationsDir?: string): Migration[] {
  const dir = migrationsDir ?? path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  return files.map((file) => ({
    id: file,
    sql: fs.readFileSync(path.join(dir, file), 'utf-8'),
  }));
}

export function migrate(db: Database.Database, migrationsDir?: string): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrations = loadMigrationsFromDir(migrationsDir);
  const appliedMigrations = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row: unknown) => (row as { id: string }).id),
  );

  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    if (!appliedMigrations.has(migration.id)) {
      const applyTx = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
          migration.id,
          new Date().toISOString(),
        );
      });

      applyTx();
      newlyApplied.push(migration.id);
    }
  }

  return newlyApplied;
}
