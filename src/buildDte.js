// Turn a Shopify order (+ the tax-doc fields captured at checkout) into a
// DTE payload. Boleta = tipo 39, Factura = tipo 33.
//
// TAX SOURCE OF TRUTH: Shopify's own order.total_price / order.total_tax.
// We do NOT recompute tax ourselves — different stores tax shipping
// differently, apply exemptions, etc. Shopify already worked that out and
// charged the customer accordingly; we just read it back. If a real order
// is missing those fields (shouldn't happen on a live store, but our own
// test fixtures don't set them), we fall back to summing line items +
// shipping and assuming a flat 19% on everything, purely so tests still run.
//
// CUSTOMER DETAILS: our own extension's fields are optional (nobody has to
// type a name/RUT for a boleta). When they're blank, fall back to (1) the
// merchant's own pre-existing "Chilean RUT" field — its attribute key is
// customer_rut — and (2) Shopify's own customer/shipping_address data, so a
// boleta still carries the real name/address the buyer already gave at
// checkout instead of nothing at all.

const { formatRut } = require('./rut');

const IVA_RATE = 0.19;

function fullNameFromOrder(order) {
  // Prefer the address entered at checkout — it reflects what the buyer
  // actually typed for THIS order. order.customer can carry a stale or
  // partial name from account-level data that doesn't match this purchase.
  const addr = order.shipping_address || order.billing_address;
  if (addr && addr.name) return addr.name;
  if (addr && (addr.first_name || addr.last_name)) {
    return [addr.first_name, addr.last_name].filter(Boolean).join(' ');
  }
  const c = order.customer;
  if (c && (c.first_name || c.last_name)) {
    return [c.first_name, c.last_name].filter(Boolean).join(' ');
  }
  return '';
}

function addressFromOrder(order) {
  const addr = order.shipping_address || order.billing_address;
  if (!addr) return { direccion: '', comuna: '', ciudad: '' };
  return {
    direccion: [addr.address1, addr.address2].filter(Boolean).join(', '),
    comuna: addr.city || '',
    // Shopify doesn't have a "comuna" field; province/city is the closest
    // available match depending on how the merchant's addresses are set up.
    ciudad: addr.province || addr.city || '',
  };
}

// The tax-doc fields the checkout extension wrote onto the order. Here we read
// them from order.note_attributes (works on every plan) OR order metafields.
function readTaxDoc(order) {
  const attrs = {};
  for (const a of order.note_attributes || []) attrs[a.name] = a.value;

  const documentType =
    attrs['billing_documento'] === '33' ? 'factura' : 'boleta';

  const orderAddress = addressFromOrder(order);

  return {
    documentType,
    // customer_rut = the merchant's own pre-existing RUT field.
    rut: attrs['billing_rut'] || attrs['customer_rut'] || '',
    fullName: attrs['billing_full_name'] || fullNameFromOrder(order),
    razonSocial: attrs['billing_rzn_social'] || '',
    giro: attrs['billing_giro'] || '',
    direccion: attrs['billing_direccion'] || orderAddress.direccion,
    comuna: attrs['billing_comuna'] || orderAddress.comuna,
    ciudad: attrs['billing_ciudad'] || orderAddress.ciudad,
    recipientEmail: attrs['billing_email'] || order.email || '',
  };
}

function buildDte(order) {
  const taxDoc = readTaxDoc(order);
  const tipo = taxDoc.documentType === 'factura' ? 33 : 39;

  const lines = (order.line_items || []).map((li) => {
    const lineTotal = Math.round(Number(li.price) * li.quantity);
    return {
      sku: li.sku || '',
      description: li.title,
      quantity: li.quantity,
      lineTotal, // IVA-inclusive, informational only for the printed table
    };
  });

  // Shipping is a line on the printed document, whether or not it's taxed.
  const shipping = Math.round(
    (order.shipping_lines || []).reduce((s, l) => s + Number(l.price || 0), 0)
  );
  if (shipping > 0) {
    lines.push({ sku: 'SHIP', description: 'Despacho', quantity: 1, lineTotal: shipping });
  }

  // --- Totals: trust Shopify's own numbers whenever they're present ---
  const hasRealTotals = order.total_price != null && order.total_tax != null;

  let total, iva, neto;
  if (hasRealTotals) {
    total = Math.round(Number(order.total_price));
    iva = Math.round(Number(order.total_tax));
    neto = total - iva;
  } else {
    // Fallback for fixtures/tests that don't set total_price/total_tax.
    total = lines.reduce((s, l) => s + l.lineTotal, 0);
    neto = Math.round(total / (1 + IVA_RATE));
    iva = total - neto;
  }

  return {
    tipo,
    orderId: order.id,
    orderNumber: order.name, // e.g. "#1234" -> goes in the DTE Referencia
    fecha: new Date().toISOString().slice(0, 10),
    receptor: {
      rut: taxDoc.rut ? formatRut(taxDoc.rut) : '',
      // Boleta uses fullName; factura uses razonSocial + giro + address.
      fullName: taxDoc.fullName,
      razonSocial: taxDoc.razonSocial,
      giro: taxDoc.giro,
      direccion: taxDoc.direccion,
      comuna: taxDoc.comuna,
      ciudad: taxDoc.ciudad,
      email: taxDoc.recipientEmail,
    },
    detalle: lines,
    totales: { neto, iva, total },
    _taxDoc: taxDoc,
  };
}

module.exports = { buildDte, readTaxDoc, IVA_RATE };