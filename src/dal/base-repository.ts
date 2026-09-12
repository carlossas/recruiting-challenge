/**
 * Repository base classes — the only place in the application that touches the database.
 *
 * `BaseRepository` applies the merchant scope itself, reading it from the request's
 * {@link getAuthContext}. Subclasses cannot opt out: they never see the raw connection and
 * never pass the merchant id in, so "the repository forgot the tenancy filter" stops being a
 * possible bug. `AdminRepository` covers the few tables that are not merchant-scoped and
 * requires an admin (mint-scoped) caller instead.
 *
 * `test/architecture.test.ts` enforces that no other module imports the database handle.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { getAuthContext } from '../auth/context.js';
import { db } from '../db.js';

/** Raised when the current caller isn't allowed to run a repository query. */
export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
  }
}

/** Optional fragments appended to a generated query. */
export interface QueryOptions {
  /** Extra condition, ANDed with the scope filter. */
  where?: string;
  /** Trailing clauses, e.g. `GROUP BY … ORDER BY … LIMIT ?`. */
  tail?: string;
  /** Parameters for `where` first, then `tail`. */
  params?: unknown[];
}

/**
 * Base class for every merchant-scoped entity.
 */
export abstract class BaseRepository<TRow> {
  /** Table backing this repository. */
  protected abstract readonly table: string;

  /** Column holding the merchant id. */
  protected readonly merchantColumn: string = 'merchant_id';

  /**
   * Merchant id of the current caller.
   *
   * @throws ScopeError when the caller has no merchant scope (e.g. an admin token).
   */
  protected scope(): string {
    const context = getAuthContext();
    if (!context.merchantId) {
      throw new ScopeError(`${context.role} caller has no merchant scope for ${this.table}`);
    }
    return context.merchantId;
  }

  /**
   * Runs a scoped `SELECT`. The merchant filter is always applied.
   *
   * @param columns - Column list or aggregate expressions.
   * @param options - Extra condition, trailing clauses and their parameters.
   */
  protected select<T>(columns: string, options: QueryOptions = {}): T[] {
    const where = options.where ? ` AND ${options.where}` : '';
    const tail = options.tail ? ` ${options.tail}` : '';
    const sql = `SELECT ${columns} FROM ${this.table} WHERE ${this.merchantColumn} = ?${where}${tail}`;
    return db.prepare(sql).all(this.scope(), ...(options.params ?? [])) as T[];
  }

  /**
   * Runs a scoped `SELECT` and returns the first row, if any.
   *
   * @param columns - Column list or aggregate expressions.
   * @param options - Extra condition, trailing clauses and their parameters.
   */
  protected selectFirst<T>(columns: string, options: QueryOptions = {}): T | undefined {
    return this.select<T>(columns, options)[0];
  }

  /**
   * Inserts a row, forcing the merchant column to the caller's scope.
   *
   * @param values - Column values, excluding the merchant column.
   */
  protected insert(values: Record<string, unknown>): void {
    const row: Record<string, unknown> = { ...values, [this.merchantColumn]: this.scope() };
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${placeholders})`).run(
      ...columns.map((column) => row[column]),
    );
  }
}

/**
 * Base class for tables that are not merchant-scoped (the tenant list itself).
 * Only admin (mint-scoped) callers may read them.
 */
export abstract class AdminRepository {
  /** Table backing this repository. */
  protected abstract readonly table: string;

  /**
   * Ensures the caller is an admin.
   *
   * @throws ScopeError for any non-admin caller.
   */
  protected requireAdmin(): void {
    const context = getAuthContext();
    if (context.role !== 'admin' || context.scope !== 'mint') {
      throw new ScopeError(`${context.role} caller may not read ${this.table}`);
    }
  }

  /**
   * Runs an unscoped `SELECT` on behalf of an admin caller.
   *
   * @param columns - Column list.
   * @param options - Condition, trailing clauses and their parameters.
   */
  protected select<T>(columns: string, options: QueryOptions = {}): T[] {
    this.requireAdmin();
    const where = options.where ? ` WHERE ${options.where}` : '';
    const tail = options.tail ? ` ${options.tail}` : '';
    return db.prepare(`SELECT ${columns} FROM ${this.table}${where}${tail}`).all(...(options.params ?? [])) as T[];
  }

  /**
   * Runs an unscoped `SELECT` and returns the first row, if any.
   *
   * @param columns - Column list.
   * @param options - Condition, trailing clauses and their parameters.
   */
  protected selectFirst<T>(columns: string, options: QueryOptions = {}): T | undefined {
    return this.select<T>(columns, options)[0];
  }
}
