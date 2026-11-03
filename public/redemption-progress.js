// Splits one vesting contract into the three parts of the progress bar. Pure
// functions on decimal strings so the Node tests can import them.
import { parseUnits, formatUnits } from './amounts.js';

const clamp = (value, max) => (value < 0n ? 0n : value > max ? max : value);

/**
 * claimed = total - remaining, claimable = releasable now, locked = what is
 * left after the claimable part. Amounts are decimal strings (already divided
 * by `decimals`, as the API returns them) and so are the results; the
 * percentages are widths of the bar, in 0.01 steps, that add up to 100.
 * `claimedShare` is claimed / total as a 0-1 fraction.
 * @param {{ totalAmount: string, remaining: string, claimableNow: string }} redemption
 * @param {number} decimals token decimals
 */
export function redemptionProgress({ totalAmount, remaining, claimableNow }, decimals) {
  const total = parseUnits(totalAmount, decimals);
  const left = clamp(parseUnits(remaining, decimals), total);
  const claimed = total - left;
  const claimable = clamp(parseUnits(claimableNow, decimals), left);
  const locked = left - claimable;

  // Basis points of the total; the locked part takes the rounding remainder.
  const basisPoints = (part) => (total === 0n ? 0 : Number((part * 10_000n) / total));
  const claimedBp = basisPoints(claimed);
  const claimableBp = basisPoints(claimable);
  const lockedBp = total === 0n ? 0 : 10_000 - claimedBp - claimableBp;

  return {
    claimed: formatUnits(claimed, decimals),
    claimable: formatUnits(claimable, decimals),
    locked: formatUnits(locked, decimals),
    claimedPct: claimedBp / 100,
    claimablePct: claimableBp / 100,
    lockedPct: lockedBp / 100,
    claimedShare: total === 0n ? 0 : claimedBp / 10_000,
  };
}
