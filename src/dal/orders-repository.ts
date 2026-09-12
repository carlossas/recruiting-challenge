/**
 * Orders repository. Every query is scoped to the caller's merchant by {@link BaseRepository}.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { BaseRepository } from './base-repository.js';

/** A row of the `orders` table. */
export interface OrderRow {
  id: string;
  merchant_id: string;
  customer_email: string;
  total_amount: number;
  type: 'sale' | 'refund';
  status: string;
  created_at: string;
}

/** Values needed to create an order; the merchant comes from the auth context. */
export interface NewOrder {
  id: string;
  customer_email: string;
  total_amount: number;
  type: 'sale' | 'refund';
  status: string;
}

/** Filters accepted when listing orders. */
export interface ListOrdersOptions {
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Data access for orders.
 */
export class OrdersRepository extends BaseRepository<OrderRow> {
  protected readonly table = 'orders';

  /**
   * Lists the caller's orders, newest first.
   *
   * @param options - Optional date range and row limit.
   */
  list(options: ListOrdersOptions = {}): OrderRow[] {
    const limit = options.limit ?? 100;
    if (options.from && options.to) {
      return this.select<OrderRow>('*', {
        where: 'created_at >= ? AND created_at < ?',
        tail: 'ORDER BY created_at DESC LIMIT ?',
        params: [options.from, options.to, limit],
      });
    }
    return this.select<OrderRow>('*', {
      tail: 'ORDER BY created_at DESC LIMIT ?',
      params: [limit],
    });
  }

  /**
   * Reads one of the caller's orders.
   *
   * @param id - Order id.
   * @returns The order, or `undefined` when it doesn't exist **or belongs to another merchant**.
   */
  getById(id: string): OrderRow | undefined {
    return this.selectFirst<OrderRow>('*', { where: 'id = ?', params: [id] });
  }

  /**
   * Creates an order for the caller's merchant.
   *
   * @param order - Order values.
   * @returns The stored row.
   */
  create(order: NewOrder): OrderRow {
    this.insert({
      id: order.id,
      customer_email: order.customer_email,
      total_amount: order.total_amount,
      type: order.type,
      status: order.status,
    });
    return this.getById(order.id)!;
  }

  /**
   * Sums order amounts over a date range.
   *
   * Note: refunds are stored as positive amounts and are summed like sales — see TD-05 in
   * `tech_debt.md`. Behavior is unchanged here on purpose; the fix is its own change.
   *
   * @param from - Inclusive lower bound (`YYYY-MM-DD`).
   * @param to - Exclusive upper bound (`YYYY-MM-DD`).
   */
  sumAmount(from: string, to: string): number {
    const row = this.selectFirst<{ total: number }>('COALESCE(SUM(total_amount), 0) AS total', {
      where: 'created_at >= ? AND created_at < ?',
      params: [from, to],
    });
    return row?.total ?? 0;
  }
}

/** Shared instance; the merchant scope comes from the per-request auth context. */
export const ordersRepository = new OrdersRepository();
