// Minimal HTTP server, zero dependencies. Two roles:
//   POST /webhooks/orders-paid   <- Shopify calls this when an order is paid
//   GET  /admin/failures         <- the failure queue (rejected orders)
//   POST /admin/retry            <- re-emit after correcting data
//
// HMAC verification is included but skipped when SHOPIFY_WEBHOOK_SECRET is
// unset, so you can test locally with curl before wiring the real dev store.

const http = require('http');
const crypto = require('crypto');
const { emitForOrder, retryOrder, emitted, failureQueue } = require('./emission');
const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR } = require('./pdfGenerator');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function verifyHmac(raw, header) {
  if (!SECRET) return true; // local testing
  const digest = crypto.createHmac('sha256', SECRET).update(raw).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(header || ''));
  } catch {
    return false;
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
if (req.method === 'GET' && req.url.startsWith('/documents/')) {
    const filename = path.basename(req.url.replace('/documents/', ''));
    const filepath = path.join(OUTPUT_DIR, filename);
    if (!fs.existsSync(filepath)) return json(res, 404, { error: 'Document not found' });
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    });
    return fs.createReadStream(filepath).pipe(res);
  }
  if (req.method === 'POST' && req.url === '/webhooks/orders-paid') {
    const raw = await readBody(req);
    if (!verifyHmac(raw, req.headers['x-shopify-hmac-sha256'])) {
      return json(res, 401, { error: 'HMAC verification failed' });
    }
    let order;
    try {
      order = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(res, 400, { error: 'Invalid JSON' });
    }
    // ACK Shopify immediately; do emission async so the webhook never blocks.
    json(res, 200, { received: true, orderId: order.id });
    emitForOrder(order)
      .then((r) => console.log(`[emit] order ${order.id}: ${r.status}`,
        r.record.folio ? `folio ${r.record.folio}` : (r.record.errors || []).join('; ')))
      .catch((e) => console.error('[emit] error', e));
    return;
  }

  if (req.method === 'GET' && req.url === '/admin/failures') {
    return json(res, 200, { count: failureQueue.size, failures: [...failureQueue.values()] });
  }

  if (req.method === 'GET' && req.url === '/admin/emitted') {
    return json(res, 200, { count: emitted.size, emitted: [...emitted.values()] });
  }

  if (req.method === 'POST' && req.url === '/admin/retry') {
    const raw = await readBody(req);
    let order;
    try { order = JSON.parse(raw.toString('utf8')); }
    catch { return json(res, 400, { error: 'Invalid JSON (send the corrected order)' }); }
    const r = await retryOrder(order);
    return json(res, 200, r);
  }

  json(res, 404, { error: 'Not found' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`DTE test server on http://localhost:${PORT}`);
    console.log('  POST /webhooks/orders-paid   GET /admin/failures   GET /admin/emitted   POST /admin/retry');
  });
}

module.exports = { server };
