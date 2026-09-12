/**
 * Merchants repository.
 *
 * The merchants table is the tenant list itself, so it isn't merchant-scoped: only admin
 * (mint-scoped) callers may read it, which is what {@link AdminRepository} enforces.
 *
 * @see plans/005-jwt-auth-and-scoped-repositories.md
 */
import { AdminRepository } from './base-repository.js';

/** A row of the `merchants` table. */
export interface MerchantRow {
  id: string;
  name: string;
}

/**
 * Data access for merchants.
 */
export class MerchantsRepository extends AdminRepository {
  protected readonly table = 'merchants';

  /**
   * Lists every merchant, by name.
   */
  list(): MerchantRow[] {
    return this.select<MerchantRow>('id, name', { tail: 'ORDER BY name' });
  }

  /**
   * Whether a merchant exists.
   *
   * @param id - Merchant id.
   */
  exists(id: string): boolean {
    return this.selectFirst<{ id: string }>('id', { where: 'id = ?', params: [id] }) !== undefined;
  }
}

/** Shared instance. */
export const merchantsRepository = new MerchantsRepository();
