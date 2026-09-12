/**
 * Orders repository. Every query is scoped to the caller's merchant by {@link BaseRepository}.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 * @see plans/006-refund-semantics-in-money-math.md
 */
import { BaseRepository } from './base-repository.js';
import { NET_AMOUNT, REFUNDS_ONLY, SALES_ONLY } from './money.js';

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

/** One row of the CSV export. */
export interface OrderExportRow {
  order_id: string;
  created_at: string;
  customer_email: string;
  type: 'sale' | 'refund';
  status: string;
  /** Amount as stored: always positive. */
  amount_cents: number;
  /** Negative for refunds, so the column sums to net revenue. */
  signed_amount_cents: number;
}

/** Revenue over a period, split so the net figure can be audited. */
export interface RevenueBreakdown {
  /** Gross sales minus refunds. Negative when refunds exceed sales. */
  netCents: number;
  /** Sales only. */
  grossSalesCents: number;
  /** Refunds only, as a positive number. */
  refundsCents: number;
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
   * Yields the caller's orders for export, oldest first (a ledger reads chronologically).
   *
   * Rows are produced lazily, so exporting a large history does not materialize it in memory.
   *
   * @param options - Optional date range; both bounds or neither.
   */
  iterateForExport(options: { from?: string; to?: string } = {}): IterableIterator<OrderExportRow> {
    const columns = `id AS order_id, created_at, customer_email, type, status,
       total_amount AS amount_cents, ${NET_AMOUNT} AS signed_amount_cents`;

    if (options.from && options.to) {
      return this.iterate<OrderExportRow>(columns, {
        where: 'created_at >= ? AND created_at < ?',
        tail: 'ORDER BY created_at ASC',
        params: [options.from, options.to],
      });
    }
    return this.iterate<OrderExportRow>(columns, { tail: 'ORDER BY created_at ASC' });
  }

  /**
   * Revenue over a date range: net, plus the gross and refunded amounts it is made of.
   *
   * Refunds subtract, so a period with more refunds than sales reports a negative net — that
   * is a real state of the business and is not clamped to zero.
   *
   * @param from - Inclusive lower bound (`YYYY-MM-DD`).
   * @param to - Exclusive upper bound (`YYYY-MM-DD`).
   */
  revenue(from: string, to: string): RevenueBreakdown {
    const row = this.selectFirst<{ net: number; gross: number; refunds: number }>(
      `COALESCE(SUM(${NET_AMOUNT}), 0) AS net,
       COALESCE(SUM(${SALES_ONLY}), 0) AS gross,
       COALESCE(SUM(${REFUNDS_ONLY}), 0) AS refunds`,
      { where: 'created_at >= ? AND created_at < ?', params: [from, to] },
    );
    return {
      netCents: row?.net ?? 0,
      grossSalesCents: row?.gross ?? 0,
      refundsCents: row?.refunds ?? 0,
    };
  }
}

/** Shared instance; the merchant scope comes from the per-request auth context. */
export const ordersRepository = new OrdersRepository();
