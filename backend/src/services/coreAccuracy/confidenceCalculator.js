/**
 * Enhanced Confidence Score Calculator
 * Multi-factor scoring system for prescription analysis accuracy
 */

export const calculateConfidenceScore = (medicines, source, extractedText) => {
  if (!medicines || medicines.length === 0) {
    return 0;
  }

  let totalScore = 0;
  let maxPossibleScore = 0;

  medicines.forEach((med) => {
    let medicineScore = 0;
    let medicineMaxScore = 100;

    // Factor 1: Medicine found in database (30 points)
    if (med.verified) {
      medicineScore += 30;
    }
    // Unverified medicines get 0 points for this factor

    // Factor 2: Dosage extracted (20 points)
    if (med.dosage && med.dosage.trim()) {
      medicineScore += 20;
    }

    // Factor 3: Frequency extracted (15 points)
    if (med.frequency || med.instructions?.frequency || med.instructions?.frequencyText) {
      medicineScore += 15;
    }

    // Factor 4: Timing instructions (1-0-1 pattern) (15 points)
    if (med.instructions?.timing && med.instructions.timing.length > 0) {
      medicineScore += 15;
    }

    // Factor 5: Food relation (BF/AF) (10 points)
    if (med.instructions?.foodRelation) {
      medicineScore += 10;
    }

    // Factor 6: Duration extracted (10 points)
    if (med.instructions?.durationDays) {
      medicineScore += 10;
    }

    totalScore += medicineScore;
    maxPossibleScore += medicineMaxScore;
  });

  // Base confidence from individual medicine scores
  let confidence = (totalScore / maxPossibleScore) * 100;

  // Source-based penalty (OCR may have errors)
  if (source === 'ocr') {
    confidence = confidence * 0.85; // 15% penalty for OCR
  }

  // Additional penalties for missing critical information
  const hasNoDosage = medicines.every(m => !m.dosage);
  const hasNoFrequency = medicines.every(m => !m.frequency && !m.instructions?.frequency);
  
  if (hasNoDosage) confidence -= 10;
  if (hasNoFrequency) confidence -= 10;

  // Ensure confidence is between 0 and 100
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return confidence;
};

