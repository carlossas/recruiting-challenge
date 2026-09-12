/**
 * Money semantics, in one place.
 *
 * A refund row records a reversed sale but stores a **positive** `total_amount`, so any query
 * that sums `total_amount` blindly counts a refund as income — the amount is added instead of
 * subtracted, making the error roughly twice the refunded volume.
 *
 * Every money figure is therefore derived from these expressions, and `test/architecture.test.ts`
 * fails the build if `total_amount` is aggregated anywhere outside `src/dal/`.
 *
 * @see plans/006-refund-semantics-in-money-math.md
 */

/** Signed amount: sales add, refunds subtract. Sums to net revenue. */
export const NET_AMOUNT = "CASE WHEN type = 'refund' THEN -total_amount ELSE total_amount END";

/** Sale amounts only; refunds contribute zero. Sums to gross sales. */
export const SALES_ONLY = "CASE WHEN type = 'sale' THEN total_amount ELSE 0 END";

/** Refund amounts only, as positive numbers. Sums to the refunded total. */
export const REFUNDS_ONLY = "CASE WHEN type = 'refund' THEN total_amount ELSE 0 END";

/** 1 for a sale, 0 otherwise. Sums to the number of sales. */
export const SALE_COUNT = "CASE WHEN type = 'sale' THEN 1 ELSE 0 END";

/** 1 for a refund, 0 otherwise. Sums to the number of refunds. */
export const REFUND_COUNT = "CASE WHEN type = 'refund' THEN 1 ELSE 0 END";
