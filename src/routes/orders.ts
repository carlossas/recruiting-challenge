/**
 * Order endpoints. The merchant scope comes from the session token via the repository.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { getAuthContext } from '../auth/context.js';
import { ordersRepository, type OrderExportRow } from '../dal/orders-repository.js';
import { writeCsv } from '../lib/csv.js';
import { asyncHandler } from './async-handler.js';

export const ordersRouter = Router();

/** Columns of the CSV export, in order. */
const EXPORT_COLUMNS = [
  'order_id',
  'created_at',
  'customer_email',
  'type',
  'status',
  'amount_cents',
  'signed_amount_cents',
  'amount',
] as const;

/**
 * `GET /api/orders/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`
 *
 * Streams the caller's orders as CSV. `signed_amount_cents` is negative for refunds, so summing
 * that column in a spreadsheet yields net revenue — the same rule the API applies.
 *
 * Declared **before** `/:id`: registered after it, Express would match `export.csv` as an order
 * id and answer 404.
 */
ordersRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (Boolean(from) !== Boolean(to)) {
      res.status(400).json({ error: 'invalid_date_range', detail: 'from and to must be provided together' });
      return;
    }

    const merchantId = getAuthContext().merchantId ?? 'merchant';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(merchantId, from, to)}"`);

    try {
      await writeCsv(res, EXPORT_COLUMNS, ordersRepository.iterateForExport({ from, to }), toExportValues);
    } catch (error) {
      // Headers are already sent, so this can't become a JSON error: abort the transfer instead
      // of finishing a file that looks complete but isn't.
      console.error('csv export failed mid-stream', error);
      res.destroy();
    }
  }),
);

/**
 * `GET /api/orders` — the caller's orders, newest first.
 */
ordersRouter.get('/', (req, res) => {
  const orders = ordersRepository.list({
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
  });
  res.json({ orders });
});

/**
 * `GET /api/orders/:id` — one order, scoped to the caller's merchant: another merchant's
 * order is reported as missing rather than returned (TD-02).
 */
ordersRouter.get('/:id', (req, res) => {
  const order = ordersRepository.getById(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ order });
});

/**
 * `POST /api/orders` — creates an order for the caller's merchant.
 */
/**
 * Maps an export row to its CSV fields, adding the human-readable decimal amount.
 */
function toExportValues(row: OrderExportRow): readonly unknown[] {
  return [
    row.order_id,
    row.created_at,
    row.customer_email,
    row.type,
    row.status,
    row.amount_cents,
    row.signed_amount_cents,
    (row.amount_cents / 100).toFixed(2),
  ];
}

/**
 * Builds the download filename, e.g. `orders-m_acme-2026-08-13_2026-09-13.csv`.
 */
function exportFilename(merchantId: string, from: string | undefined, to: string | undefined): string {
  const range = from && to ? `${from}_${to}` : 'all';
  return `orders-${merchantId}-${range}.csv`.replace(/[^A-Za-z0-9._-]/g, '-');
}

ordersRouter.post('/', (req, res) => {
  const body = req.body as {
    customer_email?: string;
    total_amount?: number;
    type?: 'sale' | 'refund';
  };
  if (!body.customer_email || typeof body.total_amount !== 'number') {
    res.status(400).json({ error: 'invalid_body' });
    return;
  }
  const order = ordersRepository.create({
    id: randomUUID(),
    customer_email: body.customer_email,
    total_amount: body.total_amount,
    type: body.type ?? 'sale',
    status: 'completed',
  });
  res.status(201).json({ order });
});
