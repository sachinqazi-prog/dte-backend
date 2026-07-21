// Generates a real PDF file from a DTE payload — automatically, on every
// accepted emission. This is a VISUAL MOCKUP: it reproduces the layout of a
// real boleta/factura using the actual captured order data, but it carries
// NO fiscal value because nothing has signed it (no firma electronica, no
// real CAF folio, no SII round-trip). That is stated on the document itself.
//
// At go-live, this module stays as-is for internal previews; the REAL
// customer-facing PDF comes back from the signing service (LibreDTE), which
// returns its own SII-generated PDF/XML. Swap signingService.js, not this file.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUTPUT_DIR = path.join(__dirname, '..', 'documents');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const INK = '#2C2C2A';
const MUTED = '#5F5E5A';
const RED = '#A32D2D';
const RED_BG = '#FCEBEB';
const GRAY_BG = '#F1EFE8';
const GREEN_BG = '#E1F5EE';
const CORAL_BG = '#FAECE7';

function money(n) {
  return Math.round(n).toLocaleString('es-CL');
}

// dte: the object built by buildDte.js
// result: the {folio, trackId, ...} returned by the signer (mock or real)
// issuer: your business details (placeholder until real firma/CAF are wired)
function generateInvoicePdf(dte, result, issuer = {}) {
  const biz = {
    name: issuer.name || 'Tu Empresa SpA',
    rut: issuer.rut || '76.161.199-0',
    giro: issuer.giro || 'Venta al por menor',
    address: issuer.address || 'Direccion no configurada',
  };

  const tipoLabel = dte.tipo === 33 ? 'FACTURA ELECTRONICA' : 'BOLETA ELECTRONICA';
  const filename = `${dte.tipo}-${result.folio}.pdf`;
  const filepath = path.join(OUTPUT_DIR, filename);

  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const stream = fs.createWriteStream(filepath);
  doc.pipe(stream);

  // Test banner
  doc.rect(0, 0, doc.page.width, 34).fill(RED_BG);
  doc.fillColor(RED).fontSize(11).font('Helvetica-Bold')
    .text('DOCUMENTO DE PRUEBA - SIN VALOR FISCAL - NO EMITIDO ANTE EL SII', 0, 12, {
      align: 'center',
    });

  let y = 60;

  // Issuer header
  doc.fillColor(INK).fontSize(13).font('Helvetica-Bold').text(biz.name, 40, y);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text(`RUT: ${biz.rut}`, 40, y + 18)
    .text(`Giro: ${biz.giro}`, 40, y + 30)
    .text(biz.address, 40, y + 42);

  // Folio box
  const boxX = 380, boxY = y - 4, boxW = 170, boxH = 66;
  doc.lineWidth(1.2).strokeColor(RED).rect(boxX, boxY, boxW, boxH).stroke();
  doc.fillColor(RED).fontSize(9).font('Helvetica-Bold')
    .text(`R.U.T. ${biz.rut}`, boxX, boxY + 8, { width: boxW, align: 'center' })
    .fontSize(11)
    .text(tipoLabel, boxX, boxY + 24, { width: boxW, align: 'center' })
    .fontSize(10)
    .text(`N. ${result.folio}`, boxX, boxY + 44, { width: boxW, align: 'center' });

  y += 70;

  // Meta line
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text(`Fecha de emision: ${dte.fecha}`, 40, y)
    .text(`Referencia: pedido Shopify ${dte.orderNumber}`, 250, y);
  y += 20;

  // Receptor box (only meaningful content for factura; boleta usually blank)
  const r = dte.receptor;
  const hasReceptor = dte.tipo === 33 || r.rut || r.fullName || r.direccion;
  if (hasReceptor) {
    // Count how many lines will actually print, so the box is always tall
    // enough — a hardcoded guess here is exactly what caused text to spill
    // past the box edge.
    let lineCount = 0;
    if (r.rut) lineCount++;
    if (dte.tipo === 33) {
      if (r.razonSocial) lineCount++;
      if (r.giro) lineCount++;
      if (r.direccion) lineCount++;
    } else {
      if (r.fullName) lineCount++;
      if (r.direccion) lineCount++;
    }
    const boxH2 = 22 + Math.max(lineCount, 1) * 14 + 10; // header + lines + bottom padding

    doc.rect(40, y, doc.page.width - 80, boxH2).fill(GRAY_BG);
    doc.fillColor(INK).fontSize(9).font('Helvetica-Bold').text('SENOR(ES)', 48, y + 8);
    doc.font('Helvetica').fontSize(9);
    let ry = y + 22;
    if (r.rut) { doc.text(`RUT: ${r.rut}`, 48, ry); ry += 14; }
    if (dte.tipo === 33) {
      if (r.razonSocial) { doc.text(`Razon social: ${r.razonSocial}`, 48, ry); ry += 14; }
      if (r.giro) { doc.text(`Giro: ${r.giro}`, 48, ry); ry += 14; }
      if (r.direccion) {
        doc.text(`Direccion: ${r.direccion}, ${r.comuna}, ${r.ciudad}`, 48, ry, {
          width: doc.page.width - 96,
        });
        ry += 14;
      }
    } else {
      if (r.fullName) { doc.text(`Nombre: ${r.fullName}`, 48, ry); ry += 14; }
      if (r.direccion) {
        doc.text(`Direccion: ${r.direccion}, ${r.comuna}, ${r.ciudad}`, 48, ry, {
          width: doc.page.width - 96,
        });
        ry += 14;
      }
    }
    y += boxH2 + 16;
  } else {
    y += 8;
  }

  // Line items
  doc.fillColor(INK).fontSize(9).font('Helvetica-Bold')
    .text('Descripcion', 40, y)
    .text('Cant.', 320, y, { width: 50, align: 'right' })
    .text('P. unit neto', 380, y, { width: 80, align: 'right' })
    .text('Total', 470, y, { width: 90, align: 'right' });
  y += 14;
  doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#D3D1C7').lineWidth(0.5).stroke();
  y += 10;

  doc.font('Helvetica').fontSize(9);
  for (const item of dte.detalle) {
    const unitNet = Math.round(item.lineTotal / (1.19) / item.quantity);
    doc.text(item.description, 40, y)
      .text(String(item.quantity), 320, y, { width: 50, align: 'right' })
      .text(money(unitNet), 380, y, { width: 80, align: 'right' })
      .text(money(Math.round(item.lineTotal / 1.19)), 470, y, { width: 90, align: 'right' });
    y += 16;
  }
  y += 10;

  // Totals box
  const totBoxX = 340, totBoxW = 220, totBoxH = 70;
  doc.rect(totBoxX, y, totBoxW, totBoxH).fill(GREEN_BG);
  doc.fillColor(INK).fontSize(9).font('Helvetica')
    .text('Monto neto', totBoxX + 10, y + 10)
    .text(money(dte.totales.neto), totBoxX, y + 10, { width: totBoxW - 10, align: 'right' })
    .text('IVA 19%', totBoxX + 10, y + 28)
    .text(money(dte.totales.iva), totBoxX, y + 28, { width: totBoxW - 10, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(10)
    .text('Total', totBoxX + 10, y + 48)
    .text(`CLP ${money(dte.totales.total)}`, totBoxX, y + 48, { width: totBoxW - 10, align: 'right' });
  y += totBoxH + 20;

  // Footer / fake stamp
  doc.rect(40, y, doc.page.width - 80, 66).fill(CORAL_BG);
  doc.fillColor(RED).fontSize(8).font('Helvetica-Bold')
    .text('Timbre electronico (simulado - sin firma SII)', 48, y + 10);
  doc.font('Helvetica').fontSize(7.5)
    .text(`Track ID de prueba: ${result.trackId}`, 48, y + 24)
    .text('Este documento no ha sido timbrado por el Servicio de Impuestos Internos.', 48, y + 38);

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve({ filename, filepath }));
    stream.on('error', reject);
  });
}

module.exports = { generateInvoicePdf, OUTPUT_DIR };