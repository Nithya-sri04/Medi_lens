/**
 * Medicine Verification Service
 * Determines if a medicine is verified (exists in database) or unverified
 */

/**
 * Verifies if a medicine exists in the database
 * @param {Object} medicine - Medicine object from database lookup
 * @param {string} originalName - Original medicine name from prescription
 * @returns {Object} { verified: boolean, message: string }
 */
export const verifyMedicine = (medicine, originalName) => {
  // Check both name and medicine_name fields (different tables use different field names)
  if (medicine && (medicine.name || medicine.medicine_name)) {
    return {
      verified: true,
      message: null,
      medicineName: medicine.name || medicine.medicine_name
    };
  }

  return {
    verified: false,
    message: 'Please consult a doctor - Medicine not found in our database',
    medicineName: originalName || 'Unknown'
  };
};

