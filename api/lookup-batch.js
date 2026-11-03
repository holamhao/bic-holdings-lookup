import { lookupWallets } from '../lib/bic-lookup.js';
import { MAX_BATCH_ADDRESSES } from '../lib/config.js';
import { sendJson } from '../lib/http.js';

// GET /api/lookup-batch?addresses=0x...,0x...
// GET rather than POST so the handler needs no body parsing, which differs
// between Vercel and plain Node. 50 addresses fit easily in the URL.
export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Only GET is supported.' });

  const param = new URL(req.url, 'http://localhost').searchParams.get('addresses') ?? '';
  const addresses = param.split(',').map((a) => a.trim()).filter(Boolean);
  if (!addresses.length) return sendJson(res, 400, { error: 'Missing wallet address list (addresses).' });
  if (addresses.length > MAX_BATCH_ADDRESSES) {
    return sendJson(res, 400, { error: `At most ${MAX_BATCH_ADDRESSES} wallet addresses per request.` });
  }

  try {
    const report = await lookupWallets(addresses);
    res.setHeader('Cache-Control', 'public, s-maxage=15');
    return sendJson(res, 200, report);
  } catch (error) {
    console.error('batch lookup failed', addresses.length, error);
    return sendJson(res, 502, { error: 'Could not read data from the Arbitrum RPC. Please try again later.' });
  }
}
