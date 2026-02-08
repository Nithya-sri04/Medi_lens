import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth.js';
import { setOtpEmail, getOtpByEmail, upsertUserByEmail } from '../repositories/authRepository.js';
import { sendOtpEmail as sendEmailOtp, isEmailConfigured } from '../services/emailService.js';

const OTP_EXPIRY_MINUTES = 10;

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Request OTP for email. Sends OTP via SMTP if configured.
 */
export const otpRequest = async (req, res) => {
  const { name, email } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  if (!normalized || !valid) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid email address required' });
  }
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  try {
    await setOtpEmail(normalized, code, expiresAt, (name || '').trim());

    if (isEmailConfigured()) {
      try {
        await sendEmailOtp(normalized, code);
      } catch (emailErr) {
        console.error('otpRequest email send failed:', emailErr.message);
        return res.json({
          success: true,
          message: 'OTP could not be sent. Check SMTP config.',
        });
      }
    } else {
      return res.json({
        success: true,
        message: 'Set SMTP_* in .env to send OTP by email.',
      });
    }

    return res.json({
      success: true,
      message: 'OTP sent to your email',
    });
  } catch (err) {
    console.error('otpRequest error:', err);
    return res.status(500).json({ error: 'OTP_REQUEST_FAILED' });
  }
};

/**
 * Verify OTP and return JWT + user.
 */
export const otpVerify = async (req, res) => {
  const { email, otp } = req.body || {};
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !otp) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and OTP required' });
  }

  try {
    const row = await getOtpByEmail(normalized);
    if (!row) {
      return res.status(400).json({ error: 'INVALID_OTP', message: 'OTP not found or expired' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'OTP_EXPIRED', message: 'OTP has expired' });
    }
    if (String(row.code).trim() !== String(otp).trim()) {
      return res.status(400).json({ error: 'INVALID_OTP', message: 'Invalid OTP' });
    }

    const name = (row.name || '').trim() || 'User';
    const user = await upsertUserByEmail(normalized, name);
    if (!user) {
      return res.status(500).json({ error: 'LOGIN_FAILED' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    return res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error('otpVerify error:', err);
    return res.status(500).json({ error: 'LOGIN_FAILED' });
  }
};
