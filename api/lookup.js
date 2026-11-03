import { lookupWallet, InvalidAddressError } from '../lib/bic-lookup.js';
import { sendJson } from '../lib/http.js';

// GET /api/lookup?address=0x...
// Uses only plain Node req/res APIs so the same handler runs as a Vercel
// serverless function and under the local dev-server.js.
export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Only GET is supported.' });

  const address = new URL(req.url, 'http://localhost').searchParams.get('address');
  try {
    const report = await lookupWallet(address);
    // Let Vercel's CDN reuse an answer for 15s so repeated lookups of the same
    // wallet do not each hit the public RPC.
    res.setHeader('Cache-Control', 'public, s-maxage=15');
    return sendJson(res, 200, report);
  } catch (error) {
    if (error instanceof InvalidAddressError) return sendJson(res, 400, { error: error.message });
    console.error('lookup failed', address, error);
    return sendJson(res, 502, { error: 'Could not read data from the Arbitrum RPC. Please try again later.' });
  }
}
