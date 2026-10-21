import { z } from 'zod';
import type { Row, TableSchema } from './table';

/**
 * Database schema registry.
 *
 * The database has NO tables yet - defining them is part of the assessment.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * How to define a table
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * 1. Describe the row shape with a zod object schema. Do NOT declare `id`, `createdAt` or
 *    `updatedAt`: the database adds them to every row (see `BaseRecord`).
 *    Rows are stored as JSON files, so use `z.coerce.date()` for `Date` columns.
 *
 *      import { z } from 'zod';
 *
 *      export const ExampleSchema = z.object({
 *        title: z.string().min(1),
 *        done: z.boolean().default(false),
 *        dueAt: z.coerce.date().optional(),
 *      });
 *
 * 2. Register it in `databaseSchema` below. The key is the table name:
 *
 *      export const databaseSchema = {
 *        examples: ExampleSchema,
 *      } satisfies Record<string, TableSchema>;
 *
 * 3. Inject `DatabaseService` and use the table. It is fully typed and every call is async:
 *
 *      const examples = this.db.table('examples');            // Table<typeof ExampleSchema>
 *      const row = await examples.insert({ title: 'a' });     // validated with ExampleSchema
 *      await examples.findOne({ title: 'a' });                // Row<Example> | undefined
 *      await examples.findMany({ dueAt: { $lt: new Date() } });
 *      await examples.update(row.id, { done: true });
 *
 *    Need the row type elsewhere? `TableRow<'examples'>` (or `z.infer<typeof ExampleSchema>`
 *    for the shape without the auto-managed columns).
 *
 * See `table.ts` for the full table API.
 */

/** A registered account. Only created after the phone passed OTP verification. */
export const UserSchema = z.object({
  /** E.164, e.g. `+15551234567`. Unique. */
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  name: z.string().trim().min(1).max(100),
  /** Lowercased. Unique. */
  email: z.email().max(254),
});

/**
 * One row per OTP sent. The code itself is never stored, only its HMAC (see `AuthService`).
 *
 * A challenge is active while it is not consumed, not invalidated, not expired and has attempts
 * left. `createdAt` doubles as the send time for resend cooldowns and hourly caps.
 */
export const OtpChallengeSchema = z.object({
  phone: z.string(),
  codeHash: z.string(),
  expiresAt: z.coerce.date(),
  attempts: z.number().int().min(0).default(0),
  /** Set once the correct code was entered: a code can only be used once. */
  consumedAt: z.coerce.date().optional(),
  /** Set when a newer code was requested for the same phone. */
  invalidatedAt: z.coerce.date().optional(),
});

/** Table name -> row schema. */
export const databaseSchema = {
  users: UserSchema,
  otpChallenges: OtpChallengeSchema,
} satisfies Record<string, TableSchema>;

/**
 * Per-table storage options. `unique` columns are enforced by flatdb with a compare-and-swap on
 * its index, so two concurrent inserts of the same value cannot both succeed.
 */
export const tableOptions: { [K in keyof typeof databaseSchema]?: { unique?: string[] } } = {
  users: { unique: ['phone', 'email'] },
};

export type DatabaseSchema = typeof databaseSchema;

/** Union of all registered table names. */
export type TableName = Extract<keyof DatabaseSchema, string>;

/** A stored row of table `K`, including `id`, `createdAt` and `updatedAt`. */
export type TableRow<K extends TableName> = Row<z.output<DatabaseSchema[K]>>;
