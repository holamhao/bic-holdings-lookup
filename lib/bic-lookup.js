import { createPublicClient, http, getAddress, isAddress, isAddressEqual, formatUnits, zeroAddress } from 'viem';
import { arbitrum } from 'viem/chains';
import { RPC_URL, BIC_TOKEN, VESTING_FACTORY, STAKING_POOLS } from './config.js';
import { erc20Abi, vestingFactoryAbi, vestingAbi, stakingPoolAbi } from './abis.js';

// viem's multicall bundles many reads into one RPC request through the
// Multicall3 contract that Arbitrum already has, which keeps us well under
// the public RPC's rate limit.
const client = createPublicClient({ chain: arbitrum, transport: http(RPC_URL) });

// viem splits a multicall into parallel eth_calls of this much calldata (its
// default is 1 KB, about 28 reads). A full batch lookup is ~500 reads, so a
// larger chunk keeps it to one request per round instead of ~18 parallel ones.
const MULTICALL_BATCH_BYTES = 32_768;

const multicall = async (contracts) =>
  contracts.length
    ? client.multicall({ allowFailure: false, batchSize: MULTICALL_BATCH_BYTES, contracts })
    : [];

export class InvalidAddressError extends Error {}

const invalidAddressMessage = (input) =>
  `Invalid wallet address: ${String(input ?? '').trim() || '(empty)'}`;

/** Checksummed address, or null when the input is not a 20-byte hex address. */
function normalizeAddress(input) {
  const trimmed = String(input ?? '').trim();
  return isAddress(trimmed, { strict: false }) ? getAddress(trimmed) : null;
}

/**
 * Looks up BIC holdings for a wallet: its own balance, its redemption contract
 * (if any) with the other beneficiary wallet, and active stakes of every wallet.
 * @param {string} input wallet address, any letter case
 */
export async function lookupWallet(input) {
  const wallet = normalizeAddress(input);
  if (!wallet) throw new InvalidAddressError(invalidAddressMessage(input));
  const { token, reports: [report] } = await lookupHoldings([wallet]);
  return { token, ...report };
}

/**
 * Same lookup for many wallets in the same three multicall rounds. Invalid
 * inputs do not fail the batch: they come back as `{ input, error }`.
 * @param {string[]} inputs wallet addresses, any letter case
 */
export async function lookupWallets(inputs) {
  const wallets = inputs.map(normalizeAddress);
  const unique = [...new Set(wallets.filter(Boolean))];
  const { token, reports } = await lookupHoldings(unique);
  const reportByWallet = new Map(unique.map((wallet, i) => [wallet, reports[i]]));
  const results = inputs.map((input, i) =>
    wallets[i] ? { input, ...reportByWallet.get(wallets[i]) } : { input, error: invalidAddressMessage(input) },
  );
  return { token, results };
}

/**
 * Three sequential multicall rounds, each depending on the previous one.
 * @param {string[]} wallets checksummed, unique addresses
 */
async function lookupHoldings(wallets) {
  // Round 1: token metadata and each wallet's redemption contract.
  const [symbol, decimals, ...vestingAddresses] = await multicall([
    { address: BIC_TOKEN, abi: erc20Abi, functionName: 'symbol' },
    { address: BIC_TOKEN, abi: erc20Abi, functionName: 'decimals' },
    ...wallets.map((wallet) => ({
      address: VESTING_FACTORY, abi: vestingFactoryAbi, functionName: 'redeemAddress', args: [wallet],
    })),
  ]);
  const format = (amount) => formatUnits(amount, decimals);

  // Round 2: each distinct redemption contract once, since both beneficiaries
  // of one contract may be in the same batch.
  const vestings = [...new Set(vestingAddresses.filter((v) => !isAddressEqual(v, zeroAddress)))];
  const vestingResults = await multicall(vestings.flatMap((vesting) => [
    { address: vesting, abi: vestingAbi, functionName: 'getBeneficiaries' },
    { address: vesting, abi: vestingAbi, functionName: 'redeemTotalAmount' },
    { address: vesting, abi: vestingAbi, functionName: 'releasable' },
    { address: BIC_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [vesting] },
  ]));
  const vestingByAddress = new Map(vestings.map((vesting, i) => {
    const [beneficiaries, totalAmount, [claimableNow], remaining] = vestingResults.slice(i * 4, (i + 1) * 4);
    const redemption = {
      contract: vesting,
      totalAmount: format(totalAmount),
      // Tokens still locked in the contract, i.e. not yet claimed.
      remaining: format(remaining),
      claimableNow: format(claimableNow),
    };
    return [vesting, { beneficiaries, redemption }];
  }));

  // Entered wallet first, then the other beneficiary.
  const walletLists = wallets.map((wallet, i) => {
    const vesting = vestingByAddress.get(vestingAddresses[i]);
    return vesting ? [wallet, ...vesting.beneficiaries.filter((b) => !isAddressEqual(b, wallet))] : [wallet];
  });

  // Round 3, per distinct holder: one balanceOf, then one getUserDeposits per pool.
  const holders = [...new Set(walletLists.flat())];
  const callsPerHolder = 1 + STAKING_POOLS.length;
  const holdingResults = await multicall(holders.flatMap((address) => [
    { address: BIC_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
    ...STAKING_POOLS.map((pool) => ({
      address: pool.address, abi: stakingPoolAbi, functionName: 'getUserDeposits', args: [address],
    })),
  ]));
  const holdingByAddress = new Map(holders.map((address, i) => {
    const [balance, ...depositsPerPool] = holdingResults.slice(i * callsPerHolder, (i + 1) * callsPerHolder);
    let totalStaked = 0n;
    const staking = STAKING_POOLS.map((pool, p) => {
      // A withdrawn deposit stays in the array with withdrawn = true.
      const staked = depositsPerPool[p]
        .filter((d) => !d.withdrawn)
        .reduce((sum, d) => sum + d.amount, 0n);
      totalStaked += staked;
      return { label: pool.label, pool: pool.address, staked: format(staked) };
    });
    return [address, { balance: format(balance), staking, totalStaked: format(totalStaked) }];
  }));

  return {
    token: { address: BIC_TOKEN, symbol, decimals },
    reports: wallets.map((wallet, i) => ({
      wallets: walletLists[i].map((address, j) => ({ address, isInput: j === 0, ...holdingByAddress.get(address) })),
      redemption: vestingByAddress.get(vestingAddresses[i])?.redemption ?? null,
    })),
  };
}
