import express from 'express';
import { otpRequest, otpVerify } from '../controllers/auth.controller.js';

const router = express.Router();
router.post('/otp-request', otpRequest);
router.post('/otp-verify', otpVerify);
export default router;
