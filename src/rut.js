// Chilean RUT: mod-11 check digit validation + normalization.
// Same logic runs in the checkout extension (fast feedback) and here (defensive).

function normalizeRut(input) {
  if (input == null) return '';
  return String(input).replace(/[.\-\s]/g, '').toUpperCase();
}

function isValidRut(input) {
  const clean = normalizeRut(input);
  if (!/^\d{7,8}[0-9K]$/.test(clean)) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  const expected = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return dv === expected;
}

// Pretty form: 76.123.456-7  (for display / storing on the order)
function formatRut(input) {
  const clean = normalizeRut(input);
  if (clean.length < 2) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${dv}`;
}

module.exports = { isValidRut, normalizeRut, formatRut };
