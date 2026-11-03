// Plain Node res helper shared by the API handlers, so they run unchanged as
// Vercel serverless functions and under dev-server.js.
export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
