// End-to-end test of the emission pipeline against the MOCK signer.
// Run: node src/test.js

const { emitForOrder, retryOrder, failureQueue } = require('./emission');
const { isValidRut } = require('./rut');
const F = require('./fixtures');

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' -> ' + detail : ''}`); }
}

async function run() {
  console.log('\n--- RUT validation ---');
  check('valid RUT 76.123.456-0', isValidRut('76.123.456-0'));
  check('valid RUT with K digit 12.345.678-5', isValidRut('12.345.678-5'));
  check('reject bad DV 76.123.456-5', !isValidRut('76.123.456-5'));
  check('reject garbage', !isValidRut('abc'));

  console.log('\n--- Boleta (39) ---');
  let r = await emitForOrder(F.boletaNoRut);
  check('boleta no RUT -> accepted', r.status === 'accepted', r.record.errors);
  check('boleta emits DTE 39', r.record.dteType === 39);
  check('total preserved 359990', r.record.totals.total === 359990, JSON.stringify(r.record.totals));
  check('neto+iva = total', r.record.totals.neto + r.record.totals.iva === 359990);

  r = await emitForOrder(F.boletaWithRut);
  check('boleta with valid RUT -> accepted', r.status === 'accepted', r.record.errors);

  console.log('\n--- Factura (33) ---');
  r = await emitForOrder(F.facturaValid);
  check('factura valid -> accepted', r.status === 'accepted', r.record.errors);
  check('factura emits DTE 33', r.record.dteType === 33);
  check('folio assigned', typeof r.record.folio === 'number');
  check('recipient email overrides buyer', r.record.recipientEmail === 'contabilidad@acme.cl');

  console.log('\n--- Failure paths ---');
  r = await emitForOrder(F.facturaBadRut);
  check('bad RUT -> rejected', r.status === 'rejected');
  check('rejected at pre_validation', r.record.stage === 'pre_validation', r.record.stage);

  r = await emitForOrder(F.facturaUnregistered);
  check('unregistered RUT -> rejected', r.status === 'rejected');
  check('rejected at SII stage', r.record.stage === 'sii', r.record.stage);
  check('carries error code', r.record.errorCode === 'RUT_NOT_REGISTERED', r.record.errorCode);

  r = await emitForOrder(F.facturaMissingGiro);
  check('missing giro -> rejected', r.status === 'rejected');
  check('giro error present', (r.record.errors || []).some((e) => /giro/i.test(e)));

  console.log('\n--- Idempotency ---');
  r = await emitForOrder(F.facturaValid); // already emitted above
  check('re-delivery does not double-emit', r.status === 'already_emitted', r.status);

  console.log('\n--- Failure queue + retry ---');
  check('failure queue holds 3 rejects', failureQueue.size === 3, `size=${failureQueue.size}`);
  // Operator corrects the bad-RUT order and retries.
  const corrected = JSON.parse(JSON.stringify(F.facturaBadRut));
  for (const a of corrected.note_attributes) {
    if (a.name === 'billing_rut') a.value = '76.123.456-0'; // valid now
  }
  r = await retryOrder(corrected);
  check('corrected order -> accepted on retry', r.status === 'accepted', r.record.errors);
  check('failure queue drained to 2', failureQueue.size === 2, `size=${failureQueue.size}`);

  console.log(`\n==== ${pass} passed, ${fail} failed ====\n`);
  process.exit(fail ? 1 : 0);
}

run();
