/**
 * Dashboard metrics.
 *
 * Queries go through {@link MetricsRepository}; this module no longer opens its own SQLite
 * connection, so metrics get the same merchant scoping as every other order query (TD-04).
 */
import { Router } from 'express';
import { getAuthContext } from '../auth/context.js';
import { metricsRepository } from '../dal/metrics-repository.js';

export const metricsRouter = Router();

/**
 * `GET /api/metrics/summary` — headline numbers for the session's merchant.
 */
metricsRouter.get('/summary', (_req, res) => {
  const summary = metricsRepository.summary();
  res.json({ merchant_id: getAuthContext().merchantId, ...summary });
});

/**
 * `GET /api/metrics/top-customers` — customers ranked by amount spent.
 */
metricsRouter.get('/top-customers', (req, res) => {
  const limit = Number(req.query.limit ?? 5);
  res.json({ customers: metricsRepository.topCustomers(limit) });
});
