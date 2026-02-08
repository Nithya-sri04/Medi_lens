import {
  listPrescriptionsByUserId,
  createPrescription,
  getPrescriptionByIdAndUser,
  updatePrescriptionByIdAndUser,
  deletePrescriptionByIdAndUser
} from '../repositories/authRepository.js';

/**
 * List saved prescriptions for the authenticated user.
 */
export const listPrescriptions = async (req, res) => {
  const { userId } = req.user || {};
  if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  try {
    const prescriptions = await listPrescriptionsByUserId(userId);
    return res.json({ prescriptions });
  } catch (err) {
    console.error('listPrescriptions error:', err);
    return res.status(500).json({ error: 'LIST_FAILED' });
  }
};

/**
 * Save a new prescription to the user's profile.
 */
export const savePrescription = async (req, res) => {
  const { userId } = req.user || {};
  if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const { title, description, data: prescriptionData } = req.body || {};
  const titleStr = (title || 'Prescription').trim().slice(0, 200);
  const descStr = (description || '').trim().slice(0, 500);

  if (!prescriptionData || typeof prescriptionData !== 'object') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Prescription data required' });
  }

  try {
    const prescription = await createPrescription(userId, titleStr || 'Prescription', descStr, prescriptionData);
    return res.status(201).json({ prescription });
  } catch (err) {
    console.error('savePrescription error:', err);
    return res.status(500).json({ error: 'SAVE_FAILED' });
  }
};

/**
 * Get one saved prescription by id (must belong to user).
 */
export const getPrescription = async (req, res) => {
  const { userId } = req.user || {};
  const { id } = req.params;
  if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });
  if (!id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Prescription id required' });

  try {
    const prescription = await getPrescriptionByIdAndUser(id, userId);
    if (!prescription) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Prescription not found' });
    }
    return res.json({ prescription });
  } catch (err) {
    console.error('getPrescription error:', err);
    return res.status(500).json({ error: 'FETCH_FAILED' });
  }
};

/**
 * Update title/description of a saved prescription.
 */
export const updatePrescription = async (req, res) => {
  const { userId } = req.user || {};
  const { id } = req.params;
  const { title, description } = req.body || {};
  if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });
  if (!id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Prescription id required' });

  const updates = {};
  if (title !== undefined) updates.title = String(title).trim().slice(0, 200) || 'Prescription';
  if (description !== undefined) updates.description = String(description).trim().slice(0, 500);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Provide title or description to update' });
  }

  try {
    const prescription = await updatePrescriptionByIdAndUser(id, userId, updates);
    if (!prescription) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.json({ prescription });
  } catch (err) {
    console.error('updatePrescription error:', err);
    return res.status(500).json({ error: 'UPDATE_FAILED' });
  }
};

/**
 * Delete a saved prescription.
 */
export const deletePrescription = async (req, res) => {
  const { userId } = req.user || {};
  const { id } = req.params;
  if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });
  if (!id) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Prescription id required' });

  try {
    const deleted = await deletePrescriptionByIdAndUser(id, userId);
    if (!deleted) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('deletePrescription error:', err);
    return res.status(500).json({ error: 'DELETE_FAILED' });
  }
};
