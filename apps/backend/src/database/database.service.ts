import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { Collection, FlatDb } from '@loewen-digital/flatdb';
import { databaseSchema, tableOptions, type DatabaseSchema, type TableName } from './database.schema';
import { Table, type TableSchema } from './table';

/** Folder the database writes its JSON files to. Without it, data is kept in memory (tests). */
export const DATABASE_DIR = Symbol('DATABASE_DIR');

/**
 * JSON file database, backed by `@loewen-digital/flatdb`.
 *
 * Every table registered in `databaseSchema` (see `database.schema.ts`) is a folder under the
 * database directory, with one JSON file per row: `<DATABASE_DIR>/<table>/<id>.json`.
 *
 *   constructor(private readonly db: DatabaseService) {}
 *
 *   const examples = this.db.table('examples'); // Table<typeof ExampleSchema>
 *
 * `DatabaseService` is a singleton (provided by the global `DatabaseModule`), so all services
 * share the same data. In the app, data persists across restarts (delete the folder to start
 * fresh). When `DatabaseService` is provided directly, e.g. in a testing module, it keeps the
 * data in memory instead.
 * 
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly db: Promise<FlatDb<Record<string, never>>>;
  private readonly tables = new Map<string, Table<TableSchema>>();

  constructor(@Optional() @Inject(DATABASE_DIR) dir?: string) {
    // flatdb is ESM-only, so it is loaded with a dynamic import.
    this.db = import('@loewen-digital/flatdb').then(({ flatdb, collection, FsAdapter, MemoryAdapter }) => {
      const collections = Object.fromEntries(
        Object.keys(databaseSchema).map((name) => [name, collection(undefined, tableOptions[name as TableName])]),
      );
      return flatdb(dir ? new FsAdapter(dir) : new MemoryAdapter(), collections);
    });
    this.db.catch(() => undefined);

    for (const [name, schema] of Object.entries(databaseSchema) as [string, TableSchema][]) {
      const collection = this.db.then((db) => db[name] as Collection);
      collection.catch(() => undefined);
      this.tables.set(name, new Table(name, schema, collection));
    }
  }

  /** Returns the (typed) table registered under `name` in `databaseSchema`. */
  table<K extends TableName>(name: K): Table<DatabaseSchema[K]> {
    return this.tables.get(name) as unknown as Table<DatabaseSchema[K]>;
  }

  /** Dump of the whole database, e.g. `console.dir(await db.snapshot(), { depth: null })`. */
  async snapshot(): Promise<Record<string, unknown[]>> {
    const entries = await Promise.all([...this.tables].map(async ([name, table]) => [name, await table.findMany()]));
    return Object.fromEntries(entries);
  }

  /** Deletes all rows of every table. Useful in tests. */
  async reset(): Promise<void> {
    await Promise.all([...this.tables.values()].map((table) => table.clear()));
  }

  async onModuleInit(): Promise<void> {
    await this.db;
  }

  async onModuleDestroy(): Promise<void> {
    await (await this.db).close();
  }
}
