/**
 * Dashboard metrics.
 *
 * Queries go through {@link MetricsRepository}; this module neither opens a database connection
 * nor does money math of its own.
 */
import { Router } from 'express';
import { getAuthContext } from '../auth/context.js';
import { metricsRepository } from '../dal/metrics-repository.js';

export const metricsRouter = Router();

/**
 * `GET /api/metrics/summary` — headline numbers for the session's merchant. Sales and refunds
 * are reported separately so neither figure hides the other.
 */
metricsRouter.get('/summary', (_req, res) => {
  const summary = metricsRepository.summary();
  res.json({ merchant_id: getAuthContext().merchantId, ...summary });
});

/**
 * `GET /api/metrics/top-customers` — customers ranked by net spend.
 */
metricsRouter.get('/top-customers', (req, res) => {
  const limit = Number(req.query.limit ?? 5);
  res.json({ customers: metricsRepository.topCustomers(limit) });
});
