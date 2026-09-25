import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A migration that rebuilds a table must not take that table's children with it.
 *
 * SQLite cannot alter a column, so making one nullable — or dropping one — means building a new table,
 * copying the rows, dropping the old one and renaming. With foreign keys enforced, that `DROP TABLE`
 * performs the `ON DELETE CASCADE` of every child: the migration deletes the operator's history and
 * reports success.
 *
 * drizzle-kit knows this and writes `PRAGMA foreign_keys=OFF` into the top of every rebuild it
 * generates. **It has never done anything.** The migrator runs each file inside a transaction
 * (`drizzle-orm/sqlite-core/dialect.js`), and SQLite ignores that pragma inside one. The only place it
 * takes effect is around the migrator, which is where `createDb` sets it.
 *
 * This guard owns no migration of its own. It builds the smallest database that can demonstrate the
 * failure — one parent, one cascading child — and applies a rebuild through the real migrator, so it
 * keeps holding as migrations come and go.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A migrations folder holding exactly the SQL given, in order. */
function folderOf(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'opswatch-fk-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const entries = files.map((sql, index) => {
    const tag = `000${index}_step`;
    writeFileSync(join(dir, `${tag}.sql`), sql);
    return { idx: index, version: '6', when: index + 1, tag, breakpoints: true };
  });
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries }));
  return dir;
}

const CREATE = `
CREATE TABLE \`parent\` (\`id\` text PRIMARY KEY NOT NULL, \`name\` text NOT NULL);--> statement-breakpoint
CREATE TABLE \`child\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`parent_id\` text NOT NULL,
  FOREIGN KEY (\`parent_id\`) REFERENCES \`parent\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`;

/** Exactly the shape drizzle-kit emits to alter a column: rebuild, drop, rename. */
const REBUILD = `
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE \`__new_parent\` (\`id\` text PRIMARY KEY NOT NULL, \`name\` text);--> statement-breakpoint
INSERT INTO \`__new_parent\`("id", "name") SELECT "id", "name" FROM \`parent\`;--> statement-breakpoint
DROP TABLE \`parent\`;--> statement-breakpoint
ALTER TABLE \`__new_parent\` RENAME TO \`parent\`;--> statement-breakpoint
PRAGMA foreign_keys=ON;`;

function seeded(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle({ client: sqlite }), { migrationsFolder: folderOf([CREATE]) });
  sqlite.prepare('insert into parent (id, name) values (?, ?)').run('p1', 'production');
  sqlite.prepare('insert into child (id, parent_id) values (?, ?)').run('c1', 'p1');
  return sqlite;
}

const children = (db: Database.Database) => (db.prepare('select count(*) as n from child').get() as { n: number }).n;

describe('a table rebuild during a migration', () => {
  it('THE RULING: with foreign keys off around the migrator, the children survive', () => {
    const db = seeded();
    // What `createDb` does, and the only place the pragma has any effect.
    db.pragma('foreign_keys = OFF');
    try {
      migrate(drizzle({ client: db }), { migrationsFolder: folderOf([CREATE, REBUILD]) });
    } finally {
      db.pragma('foreign_keys = ON');
    }

    expect(children(db)).toBe(1);
  });

  it('and the pragma drizzle-kit writes into the file does not, which is why the line above exists', () => {
    const db = seeded();
    // Exactly the same migration, run the way it would be without that line.
    migrate(drizzle({ client: db }), { migrationsFolder: folderOf([CREATE, REBUILD]) });

    // Not a hypothetical: this is the state an operator's database would be in.
    expect(children(db)).toBe(0);
  });

  it('leaves foreign keys enforced afterwards, so the running application is not unprotected', () => {
    const db = seeded();
    db.pragma('foreign_keys = OFF');
    try {
      migrate(drizzle({ client: db }), { migrationsFolder: folderOf([CREATE, REBUILD]) });
    } finally {
      db.pragma('foreign_keys = ON');
    }

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(() => db.prepare('insert into child (id, parent_id) values (?, ?)').run('c2', 'nobody')).toThrow();
  });
});
