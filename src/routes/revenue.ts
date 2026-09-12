/**
 * Revenue endpoint.
 */
import { Router } from 'express';
import { getAuthContext } from '../auth/context.js';
import { ordersRepository } from '../dal/orders-repository.js';

export const revenueRouter = Router();

/**
 * `GET /api/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD`
 *
 * Total revenue for the session's merchant in the given date range.
 */
revenueRouter.get('/', (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (!from || !to) {
    res.status(400).json({ error: 'missing_date_range', detail: 'from and to are required (YYYY-MM-DD)' });
    return;
  }

  const total = ordersRepository.sumAmount(from, to);
  res.json({
    merchant_id: getAuthContext().merchantId,
    from,
    to,
    revenue_cents: total,
    revenue: total / 100,
  });
});
