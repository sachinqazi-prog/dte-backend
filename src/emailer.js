// Sends the generated (test) invoice PDF to the recipient email.
//
// Three modes, tried in this order:
//   1. RESEND_API_KEY set -> sends via Resend's HTTP API (recommended —
//      no SMTP config, works great from hosted platforms like Render).
//   2. SMTP_HOST set -> real SMTP (Gmail app password, SendGrid, etc).
//   3. Neither set -> Ethereal Email, a free fake inbox nodemailer spins up
//      automatically, for local testing with zero setup.

const nodemailer = require('nodemailer');
const fs = require('fs');

function tipoLabel(dte) {
  return dte.tipo === 33 ? 'Factura' : 'Boleta';
}

function emailBody(dte, result) {
  return (
    `Adjuntamos tu ${tipoLabel(dte).toLowerCase()} electronica para el pedido ${dte.orderNumber}.\n\n` +
    `Folio: ${result.folio}\n` +
    `Total: CLP ${dte.totales.total.toLocaleString('es-CL')}\n\n` +
    `Este es un documento de PRUEBA sin valor fiscal (ambiente de desarrollo).`
  );
}

// --- Mode 1: Resend ---
async function sendViaResend(dte, result, pdfFilepath) {
  const to = dte.receptor.email;
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  const pdfBase64 = fs.readFileSync(pdfFilepath).toString('base64');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: `${tipoLabel(dte)} electronica N ${result.folio} - Pedido ${dte.orderNumber}`,
      text: emailBody(dte, result),
      attachments: [
        {
          filename: `${tipoLabel(dte).toLowerCase()}-${result.folio}.pdf`,
          content: pdfBase64,
        },
      ],
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${JSON.stringify(body)}`);
  }
  console.log(`[email] sent via Resend to ${to}, id=${body.id}`);
  return { sent: true, provider: 'resend', id: body.id };
}

// --- Mode 2/3: nodemailer (real SMTP, or Ethereal test inbox as fallback) ---
let transporterPromise = null;
let usingTestAccount = false;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;
  if (process.env.SMTP_HOST) {
    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
    );
  } else {
    usingTestAccount = true;
    transporterPromise = nodemailer.createTestAccount().then((account) =>
      nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass },
      })
    );
  }
  return transporterPromise;
}

async function sendViaNodemailer(dte, result, pdfFilepath) {
  const to = dte.receptor.email;
  const transporter = await getTransporter();
  const from = process.env.SMTP_FROM || 'facturacion@tu-empresa.example';

  const info = await transporter.sendMail({
    from,
    to,
    subject: `${tipoLabel(dte)} electronica N ${result.folio} - Pedido ${dte.orderNumber}`,
    text: emailBody(dte, result),
    attachments: [
      {
        filename: `${tipoLabel(dte).toLowerCase()}-${result.folio}.pdf`,
        content: fs.createReadStream(pdfFilepath),
      },
    ],
  });

  if (usingTestAccount) {
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[email] TEST inbox - view it here: ${previewUrl}`);
    return { sent: true, provider: 'ethereal', previewUrl };
  }
  console.log(`[email] sent via SMTP to ${to}, messageId=${info.messageId}`);
  return { sent: true, provider: 'smtp', messageId: info.messageId };
}

// dte: the built DTE payload (has receptor.email, tipo, orderNumber)
// result: signer result (has folio)
// pdfFilepath: absolute path to the generated PDF, from pdfGenerator.js
async function sendInvoiceEmail(dte, result, pdfFilepath) {
  const to = dte.receptor.email;
  if (!to) {
    console.log('[email] skipped - no recipient email on this order');
    return { sent: false, reason: 'no_recipient' };
  }

  if (process.env.RESEND_API_KEY) {
    return sendViaResend(dte, result, pdfFilepath);
  }
  return sendViaNodemailer(dte, result, pdfFilepath);
}

module.exports = { sendInvoiceEmail };