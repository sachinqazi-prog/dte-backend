// ---------------------------------------------------------------------------
// MOCK SIGNING SERVICE  —  stands in for LibreDTE -> SII Maullin.
//
// This is the ONLY module you replace at go-live. Its job is to take a built
// DTE payload and return { accepted, folio, trackId, pdfUrl, xmlUrl } OR a
// rejection. The real LibreDTE call has the same shape: build XML, sign with
// the firma, send to SII, return the folio/track_id it hands back.
//
// To make the test loop realistic it simulates the two failure modes you WILL
// hit in production so you can prove your failure queue works:
//   1. RUT valid in format but "not registered as contribuyente" at the SII.
//   2. Razon social mismatch vs SII records (factura only).
// ---------------------------------------------------------------------------

const { isValidRut, normalizeRut } = require('./rut');

// Fake "SII registry" — in Maullin the real service decides this. For testing,
// any RUT ending in these bodies is treated as unregistered so you can trigger
// the reject path on demand.
const UNREGISTERED_TEST_RUTS = new Set(['11111111', '99999999']);

let folioCounter = 1000; // test folios; real ones come from your CAF file

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function signAndSubmit(dte) {
  // Simulate network + SII processing latency (real Maullin takes seconds).
  await sleep(150);

  const clean = normalizeRut(dte.receptor.rut);

  // Defensive: this should already have been caught upstream.
  if (dte.receptor.rut && !isValidRut(dte.receptor.rut)) {
    return {
      accepted: false,
      errorCode: 'RUT_INVALID',
      errorMessage: `RUT ${dte.receptor.rut} failed check digit`,
    };
  }

  // Business reject #1: unregistered RUT.
  const body = clean.slice(0, -1);
  if (dte.receptor.rut && UNREGISTERED_TEST_RUTS.has(body)) {
    return {
      accepted: false,
      errorCode: 'RUT_NOT_REGISTERED',
      errorMessage: `RUT ${dte.receptor.rut} is not a registered contribuyente`,
    };
  }

  // Business reject #2: factura with an empty razon social.
  if (dte.tipo === 33 && !dte.receptor.razonSocial) {
    return {
      accepted: false,
      errorCode: 'RAZON_SOCIAL_MISSING',
      errorMessage: 'Factura (DTE 33) requires razon social',
    };
  }

  // Accepted → issue a test folio and fake document URLs.
  const folio = ++folioCounter;
  const trackId = `TEST-${Date.now()}-${folio}`;
  return {
    accepted: true,
    folio,
    trackId,
    pdfUrl: `https://maullin.example/test/dte/${dte.tipo}/${folio}.pdf`,
    xmlUrl: `https://maullin.example/test/dte/${dte.tipo}/${folio}.xml`,
    note: 'TEST DOCUMENT — no fiscal value',
  };
}

module.exports = { signAndSubmit };
