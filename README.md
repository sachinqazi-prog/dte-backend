# dte-backend

Reads paid Shopify orders, validates the tax-document fields the checkout
extension saved, and produces a boleta (DTE 39) or factura (DTE 33). The
signing step is mocked so you can test the whole pipeline with zero SII
credentials.

## Run

```bash
npm test          # -> node src/test.js  (24 tests)
npm start         # -> node src/server.js  (server on :3000)
```

## Try it

```bash
curl -X POST localhost:3000/webhooks/orders-paid \
  -H "Content-Type: application/json" \
  -d @src/sample-order.json

curl localhost:3000/admin/emitted     # successful documents
curl localhost:3000/admin/failures    # rejected orders + reasons
```

## Files

| File | What it does |
|---|---|
| `rut.js` | Chilean RUT mod-11 validation (same code as the checkout extension) |
| `buildDte.js` | Turns a Shopify order into a DTE payload, back-computes neto/IVA |
| `signingService.js` | **Mock** signer — the ONE file you replace at go-live |
| `emission.js` | Validate → build → sign → record. Idempotent. Failure queue. |
| `server.js` | HTTP server: webhook + admin endpoints |
| `fixtures.js` | Sample orders covering boleta, factura, and every failure case |
| `test.js` | Automated test suite |

## Endpoints

- `POST /webhooks/orders-paid` — point your Shopify `orders/paid` webhook here
- `GET /admin/emitted` — successfully issued documents
- `GET /admin/failures` — rejected orders, with reasons, for correction
- `POST /admin/retry` — resend a corrected order to re-emit

## Connect to a real dev store

```bash
npx ngrok http 3000
```

Copy the `https://...` URL ngrok prints, then in the dev store admin add an
**Order payment** webhook pointing to `<that-url>/webhooks/orders-paid`.

## Go-live

Replace `signingService.js`'s `signAndSubmit()` with a real call to LibreDTE
(self-hosted, free), first against the SII's Maullín test environment, then
production, once the business has its firma electrónica and CAF folios.
Nothing else in this app changes.
