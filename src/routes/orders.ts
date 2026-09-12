/**
 * Order endpoints. The merchant scope comes from the session token via the repository.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { ordersRepository } from '../dal/orders-repository.js';

export const ordersRouter = Router();

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
