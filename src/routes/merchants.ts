/**
 * Merchant listing, used by the dashboard's merchant picker.
 *
 * Requires an admin (mint-scoped) token: merchant tokens are bound to a single merchant and
 * have no business enumerating the others.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { Router } from 'express';
import { requireAuth } from '../auth/guard.js';
import { merchantsRepository } from '../dal/merchants-repository.js';

export const merchantsRouter = Router();

/**
 * `GET /api/merchants` — every merchant, so the picker doesn't hardcode them.
 */
merchantsRouter.get('/', requireAuth({ scope: 'mint' }), (_req, res) => {
  res.json({ merchants: merchantsRepository.list() });
});
