/**
 * Metrics repository.
 *
 * Replaces the raw SQL and the second SQLite connection that used to live in
 * `src/routes/metrics.ts`, so metrics queries get the same merchant scoping — and any future
 * auditing or caching — as every other order query (TD-04).
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { BaseRepository } from './base-repository.js';
import type { OrderRow } from './orders-repository.js';

/** Aggregated dashboard numbers for one merchant. */
export interface MerchantSummary {
  total_orders: number;
  unique_customers: number;
  avg_order_value_cents: number;
}

/** One row of the top-customers report. */
export interface TopCustomer {
  customer_email: string;
  order_count: number;
  total_spent: number;
}

/**
 * Read-only aggregates over the caller's orders.
 */
export class MetricsRepository extends BaseRepository<OrderRow> {
  protected readonly table = 'orders';

  /**
   * Order count, distinct customers and average order value.
   *
   * Note: refunds are counted like sales — see TD-06 in `tech_debt_backlog.md`.
   */
  summary(): MerchantSummary {
    const row = this.selectFirst<{ total_orders: number; unique_customers: number; avg_order_value: number }>(
      'COUNT(*) AS total_orders, COUNT(DISTINCT customer_email) AS unique_customers, COALESCE(AVG(total_amount), 0) AS avg_order_value',
    );
    return {
      total_orders: row?.total_orders ?? 0,
      unique_customers: row?.unique_customers ?? 0,
      avg_order_value_cents: Math.round(row?.avg_order_value ?? 0),
    };
  }

  /**
   * Customers ranked by amount spent.
   *
   * @param limit - Maximum rows to return.
   */
  topCustomers(limit: number): TopCustomer[] {
    return this.select<TopCustomer>(
      'customer_email, COUNT(*) AS order_count, SUM(total_amount) AS total_spent',
      {
        tail: 'GROUP BY customer_email ORDER BY total_spent DESC LIMIT ?',
        params: [limit],
      },
    );
  }
}

/** Shared instance; the merchant scope comes from the per-request auth context. */
export const metricsRepository = new MetricsRepository();
