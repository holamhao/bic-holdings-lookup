// Every on-chain address the tool reads from lives here, so a new pool or a
// new factory is a one-line change. The "Data sources" Arbiscan links in
// public/index.html repeat the token, factory and pool addresses (the static
// page cannot import this file), so change them there too.

// Public Arbitrum RPC needs no key. Set ARBITRUM_RPC_URL (e.g. an Alchemy URL)
// to switch providers without touching code.
export const RPC_URL = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';

export const BIC_TOKEN = '0xB1C3960aeeAf4C255A877da04b06487BBa698386';

// BICVestingFactory deploys one BICVesting clone per user and records
// beneficiary -> clone in its public `redeemAddress` mapping.
// The "Redemption Operator" wallet (0xE1bb...84ef) is only the factory owner.
export const VESTING_FACTORY = '0x8386b1cb4611a136d6bec5b815aff295c4cac999';

export const STAKING_POOLS = [
  { label: 'Staking 6 months', address: '0x06E852baDe8E67a86d1c26B45Bc0148D9F1E33c9' },
  { label: 'Staking 9 months', address: '0x77ae6c78Bd2e850ca8965f9DafE2f1F7BaA735Dd' },
  { label: 'Staking 12 months', address: '0x908c2D3f55B1703e7e2Af4b10BB6Eac7Db77e5eF' },
  { label: 'Staking 15 months', address: '0x02ED3cb4847dbd7e0664F5AC45F0604024b8cf58' },
];

// Most wallets one /api/lookup-batch request accepts. 50 wallets plus their
// other beneficiaries is at most ~500 reads in one eth_call, far below the
// RPC gas cap and about one second per request on the public RPC. The page
// (public/batch-file.js) sends files in chunks of this size.
export const MAX_BATCH_ADDRESSES = 50;
