// The heart of the back half. Given a paid order, run it through:
//   validate -> build -> sign(mock) -> record result.
// Idempotent on order.id. Rejects land in an in-memory failure queue you can
// inspect and retry. In production, swap the Map for a real DB/queue.

const { isValidRut } = require('./rut');
const { buildDte } = require('./buildDte');
const { signAndSubmit } = require('./signingService');
const { generateInvoicePdf } = require('./pdfGenerator');

// In-memory stores (testing only). Replace with your DB at go-live.
const emitted = new Map();      // orderId -> result record
const failureQueue = new Map(); // orderId -> failure record

function preValidate(dte) {
  const errors = [];
  const t = dte._taxDoc;

  // RUT: required for factura; for boleta it's optional (see spec note).
  if (dte.tipo === 33 && !t.rut) errors.push('Factura requires RUT');
  if (t.rut && !isValidRut(t.rut)) errors.push(`Invalid RUT: ${t.rut}`);

  if (dte.tipo === 33) {
    if (!t.razonSocial) errors.push('Factura requires razon social');
    if (!t.giro) errors.push('Factura requires giro');
    if (!t.direccion) errors.push('Factura requires direccion');
    if (!t.comuna) errors.push('Factura requires comuna');
  }
  return errors;
}

async function emitForOrder(order) {
  const orderId = order.id;

  // Idempotency: webhooks retry; never emit a second folio.
  if (emitted.has(orderId)) {
    return { status: 'already_emitted', record: emitted.get(orderId) };
  }

  const dte = buildDte(order);

  // Pre-flight validation (cheap, catches most problems before hitting SII).
  const preErrors = preValidate(dte);
  if (preErrors.length) {
    const rec = {
      orderId,
      orderNumber: dte.orderNumber,
      status: 'rejected',
      stage: 'pre_validation',
      errors: preErrors,
      at: new Date().toISOString(),
    };
    failureQueue.set(orderId, rec);
    return { status: 'rejected', record: rec };
  }

  // Sign + submit (mock -> real LibreDTE/Maullin later).
  const result = await signAndSubmit(dte);

  if (!result.accepted) {
    const rec = {
      orderId,
      orderNumber: dte.orderNumber,
      status: 'rejected',
      stage: 'sii',
      errorCode: result.errorCode,
      errors: [result.errorMessage],
      at: new Date().toISOString(),
    };
    failureQueue.set(orderId, rec);
    return { status: 'rejected', record: rec };
  }

// Generate the actual (test-marked) PDF file — automatic, every order.
  const { filename } = await generateInvoicePdf(dte, result);

  // Accepted → this is what you'd write back onto the order's metafields.
  const rec = {
    orderId,
    orderNumber: dte.orderNumber,
    status: 'accepted',
    dteType: dte.tipo,
    folio: result.folio,
    trackId: result.trackId,
    pdfUrl: `/documents/${filename}`,
    xmlUrl: result.xmlUrl,
    totals: dte.totales,
    recipientEmail: dte.receptor.email,
    at: new Date().toISOString(),
  };
  emitted.set(orderId, rec);
  failureQueue.delete(orderId); // clear any prior failure on retry
  return { status: 'accepted', record: rec };
}

// Operator fixes the data (e.g. corrects the RUT) and retries.
async function retryOrder(order) {
  emitted.delete(order.id); // allow re-emit after correction
  return emitForOrder(order);
}

module.exports = { emitForOrder, retryOrder, emitted, failureQueue };
