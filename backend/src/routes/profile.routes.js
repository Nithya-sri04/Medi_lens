import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listPrescriptions,
  savePrescription,
  getPrescription,
  updatePrescription,
  deletePrescription
} from '../controllers/profile.controller.js';

const router = express.Router();
router.use(requireAuth);

router.get('/prescriptions', listPrescriptions);
router.post('/prescriptions', savePrescription);
router.get('/prescriptions/:id', getPrescription);
router.patch('/prescriptions/:id', updatePrescription);
router.delete('/prescriptions/:id', deletePrescription);

export default router;
