import { parseAbi } from 'viem';

// Only the read functions this tool calls. Full sources are verified on
// Sourcify: BicTokenPaymaster, BICVestingFactory, BICVesting, TieredStakingPool.

export const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
]);

export const vestingFactoryAbi = parseAbi([
  'function redeemAddress(address beneficiary) view returns (address)',
]);

export const vestingAbi = parseAbi([
  'function getBeneficiaries() view returns (address[])',
  'function redeemTotalAmount() view returns (uint256)',
  // Returns (amount claimable now, number of weekly stacks it covers).
  'function releasable() view returns (uint256, uint256)',
]);

export const stakingPoolAbi = parseAbi([
  'struct Deposit { uint256 amount; uint256 tierIndex; uint256 depositTime; bool withdrawn; }',
  'function getUserDeposits(address user) view returns (Deposit[])',
]);
