// Sample orders shaped like the real Shopify orders/paid webhook payload.
// note_attributes is exactly where the checkout extension writes the tax-doc
// fields, so these are realistic end-to-end inputs.

function baseOrder(id, name, attributes) {
  return {
    id,
    name,
    email: 'buyer@example.com',
    line_items: [
      { title: 'Sofá 2 cuerpos Mahoney pebble', sku: 'SOFA-001', quantity: 1, price: '359990' },
    ],
    shipping_lines: [{ price: '0' }],
    note_attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
  };
}

// Boleta, no RUT (the common case — no nominativa).
const boletaNoRut = baseOrder(5001, '#1001', {
  billing_documento: '39',
});

// Boleta with a valid RUT (nominativa).
const boletaWithRut = baseOrder(5002, '#1002', {
  billing_documento: '39',
  billing_rut: '12.345.678-5',
  billing_full_name: 'María González',
});

// Factura, all fields valid.
const facturaValid = baseOrder(5003, '#1003', {
  billing_documento: '33',
  billing_rut: '76.123.456-0',
  billing_rzn_social: 'Acme Ingeniería SpA',
  billing_giro: 'Servicios de ingeniería',
  billing_direccion: 'Av. Providencia 1234',
  billing_comuna: 'Providencia',
  billing_ciudad: 'Santiago',
  billing_email: 'contabilidad@acme.cl',
});

// Factura, RUT fails the check digit -> blocked at pre-validation.
const facturaBadRut = baseOrder(5004, '#1004', {
  billing_documento: '33',
  billing_rut: '76.123.456-5', // wrong DV (correct is 0)
  billing_rzn_social: 'Bad RUT SpA',
  billing_giro: 'Comercio',
  billing_direccion: 'Calle Falsa 123',
  billing_comuna: 'Santiago',
});

// Factura, valid-format RUT but unregistered at SII -> rejected by signer.
const facturaUnregistered = baseOrder(5005, '#1005', {
  billing_documento: '33',
  billing_rut: '11.111.111-1', // in signingService UNREGISTERED set
  billing_rzn_social: 'Ghost SpA',
  billing_giro: 'Comercio',
  billing_direccion: 'Calle Falsa 123',
  billing_comuna: 'Santiago',
});

// Factura missing giro -> blocked at pre-validation (your spec gap).
const facturaMissingGiro = baseOrder(5006, '#1006', {
  billing_documento: '33',
  billing_rut: '76.123.456-0',
  billing_rzn_social: 'No Giro SpA',
  billing_direccion: 'Av. Siempre Viva 742',
  billing_comuna: 'Providencia',
});

module.exports = {
  boletaNoRut,
  boletaWithRut,
  facturaValid,
  facturaBadRut,
  facturaUnregistered,
  facturaMissingGiro,
};
