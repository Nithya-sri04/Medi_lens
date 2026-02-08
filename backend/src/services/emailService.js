/**
 * Send OTP via email. No DLT, no SMS provider needed.
 * Set SMTP vars in .env (e.g. Gmail app password). If unset, OTP can still be returned in API response.
 */
import nodemailer from 'nodemailer';

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM || user || 'noreply@medilens.local';
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

export function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Send OTP to the given email address.
 * Resolves when sent; rejects on error. If SMTP not configured, rejects so caller can return OTP in response.
 */
export async function sendOtpEmail(email, code) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('Email not configured: set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@medilens.local';
  await transporter.sendMail({
    from: `MediLens <${from}>`,
    to: email,
    subject: 'Your MediLens OTP',
    text: `Your MediLens OTP is ${code}. Valid for 10 minutes.`,
    html: `<p>Your MediLens OTP is <strong>${code}</strong>. Valid for 10 minutes.</p>`
  });
}
