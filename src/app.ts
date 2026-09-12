/**
 * Express application wiring.
 *
 * Split from `server.ts` so tests can drive the app without binding the configured port.
 * Every data route sits behind {@link requireAuth}; adding a new one means adding the guard.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import express from 'express';
import { devAdminSession } from './auth/dev-session.js';
import { requireAuth } from './auth/guard.js';
import { authRouter } from './routes/auth.js';
import { merchantsRouter } from './routes/merchants.js';
import { metricsRouter } from './routes/metrics.js';
import { ordersRouter } from './routes/orders.js';
import { revenueRouter } from './routes/revenue.js';

/** Options for {@link createApp}. */
export interface AppOptions {
  /**
   * Whether local requests may be handed an admin session cookie automatically.
   * Defaults to `true` (and is additionally gated by `DEV_ADMIN_SESSION`).
   */
  enableDevAdminSession?: boolean;
}

/**
 * Builds the Express application.
 *
 * @param options - Wiring options.
 */
export function createApp(options: AppOptions = {}): express.Express {
  const app = express();

  app.use(express.json());
  if (options.enableDevAdminSession ?? true) app.use(devAdminSession());
  app.use(express.static('public'));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/merchants', merchantsRouter);
  app.use('/api/orders', requireAuth(), ordersRouter);
  app.use('/api/revenue', requireAuth(), revenueRouter);
  app.use('/api/metrics', requireAuth(), metricsRouter);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
