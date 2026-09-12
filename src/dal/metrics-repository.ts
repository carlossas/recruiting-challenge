/**
 * Metrics repository.
 *
 * Queries go through {@link BaseRepository}, so metrics get the same merchant scoping as every
 * other order query (TD-04), and they use the shared money expressions, so a refund never
 * counts as a sale (TD-06).
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 * @see plans/006-refund-semantics-in-money-math.md
 */
import { BaseRepository } from './base-repository.js';
import { NET_AMOUNT, REFUND_COUNT, SALE_COUNT } from './money.js';
import type { OrderRow } from './orders-repository.js';

/** Headline numbers for one merchant. */
export interface MerchantSummary {
  /** Orders placed (rows of type `sale`). */
  sales_orders: number;
  /** Refund rows. */
  refund_orders: number;
  /** Distinct customers with at least one sale. */
  unique_customers: number;
  /** Average amount of a sale — what a typical order looks like. */
  avg_order_value_cents: number;
  /** Net revenue divided by the number of sales — what a sale is worth after refunds. */
  avg_net_order_value_cents: number;
}

/** One row of the top-customers report. */
export interface TopCustomer {
  customer_email: string;
  /** Sales placed by this customer; refunds are not orders. */
  order_count: number;
  /** Net spend: sales minus refunds. Negative when the customer refunded more than they bought. */
  total_spent: number;
}

/**
 * Read-only aggregates over the caller's orders.
 */
export class MetricsRepository extends BaseRepository<OrderRow> {
  protected readonly table = 'orders';

  /**
   * Sales and refund counts, distinct customers, and both average-order figures.
   */
  summary(): MerchantSummary {
    const row = this.selectFirst<{
      sales_orders: number;
      refund_orders: number;
      unique_customers: number;
      avg_sale: number;
      net: number;
    }>(
      `COALESCE(SUM(${SALE_COUNT}), 0) AS sales_orders,
       COALESCE(SUM(${REFUND_COUNT}), 0) AS refund_orders,
       COUNT(DISTINCT CASE WHEN type = 'sale' THEN customer_email END) AS unique_customers,
       COALESCE(AVG(CASE WHEN type = 'sale' THEN total_amount END), 0) AS avg_sale,
       COALESCE(SUM(${NET_AMOUNT}), 0) AS net`,
    );

    const salesOrders = row?.sales_orders ?? 0;
    return {
      sales_orders: salesOrders,
      refund_orders: row?.refund_orders ?? 0,
      unique_customers: row?.unique_customers ?? 0,
      avg_order_value_cents: Math.round(row?.avg_sale ?? 0),
      avg_net_order_value_cents: salesOrders > 0 ? Math.round((row?.net ?? 0) / salesOrders) : 0,
    };
  }

  /**
   * Customers ranked by net spend.
   *
   * @param limit - Maximum rows to return.
   */
  topCustomers(limit: number): TopCustomer[] {
    return this.select<TopCustomer>(
      `customer_email,
       COALESCE(SUM(${SALE_COUNT}), 0) AS order_count,
       COALESCE(SUM(${NET_AMOUNT}), 0) AS total_spent`,
      {
        tail: 'GROUP BY customer_email ORDER BY total_spent DESC LIMIT ?',
        params: [limit],
      },
    );
  }
}

/** Shared instance; the merchant scope comes from the per-request auth context. */
export const metricsRepository = new MetricsRepository();
