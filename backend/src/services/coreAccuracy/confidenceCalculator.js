/**
 * Enhanced Confidence Score Calculator v2.0
 * Multi-factor scoring system for prescription analysis accuracy
 * Updated to account for multi-phase dosing, route extraction, and improved OCR
 */

export const calculateConfidenceScore = (medicines, source, extractedText) => {
  if (!medicines || medicines.length === 0) {
    return 0;
  }

  let totalScore = 0;
  let maxPossibleScore = 0;
  let bonusPoints = 0;

  medicines.forEach((med) => {
    let medicineScore = 0;
    let medicineMaxScore = 120; // Increased from 100 to account for new factors

    // ========================================
    // CORE FACTORS (100 points total)
    // ========================================

    // Factor 1: Medicine found in database (35 points - increased from 30)
    if (med.verified) {
      medicineScore += 35;
      
      // Bonus: Medicine found via composition matching (shows robust search)
      if (med.equivalentBrand || med.compositionAlternatives?.length > 0) {
        medicineScore += 5;
      }
    }

    // Factor 2: Dosage extracted (20 points)
    if (med.dosage && med.dosage.trim()) {
      medicineScore += 20;
      
      // Bonus: Multi-phase dosing successfully parsed (shows complex understanding)
      if (med.hasMultiplePhases && med.dosingPhases?.length > 1) {
        medicineScore += 10;
        bonusPoints += 10;
      }
    }

    // Factor 3: Frequency extracted (15 points)
    if (med.frequency || med.instructions?.frequency || med.instructions?.frequencyText) {
      medicineScore += 15;
    }

    // Factor 4: Route of administration (NEW - 10 points)
    if (med.instructions?.route) {
      medicineScore += 10;
    }

    // Factor 5: Timing instructions (10 points - reduced from 15)
    if (med.instructions?.timing && med.instructions.timing.length > 0) {
      medicineScore += 10;
    }

    // Factor 6: Duration extracted (15 points - increased from 10)
    if (med.instructions?.durationDays || med.totalDuration) {
      medicineScore += 15;
      
      // Bonus: Duration includes weeks/months (not just days)
      if (med.instructions?.durationText && 
          (med.instructions.durationText.includes('week') || 
           med.instructions.durationText.includes('month'))) {
        medicineScore += 5;
        bonusPoints += 5;
      }
    }

    // Factor 7: Food relation (5 points - reduced from 10)
    if (med.instructions?.foodRelation) {
      medicineScore += 5;
    }

    // ========================================
    // QUALITY INDICATORS (Bonus Points)
    // ========================================

    // Composition information available
    if (med.composition && med.composition.trim()) {
      medicineScore += 5;
      bonusPoints += 5;
    }

    // Generic/brand information detected
    if (med.genericName || med.brandType) {
      medicineScore += 3;
      bonusPoints += 3;
    }

    // Food interaction warnings provided
    if (med.foodHabits && Array.isArray(med.foodHabits) && med.foodHabits.length > 0) {
      medicineScore += 2;
      bonusPoints += 2;
    }

    totalScore += medicineScore;
    maxPossibleScore += medicineMaxScore;
  });

  // Base confidence from individual medicine scores
  let confidence = (totalScore / maxPossibleScore) * 100;

  // ========================================
  // SOURCE-BASED ADJUSTMENTS
  // ========================================

  // Reduced penalty for OCR (from 15% to 10%) due to improved Veryfi + parser
  if (source === 'ocr') {
    confidence = confidence * 0.90; // 10% penalty (reduced from 15%)
  }

  // Bonus for Veryfi OCR (better than Tesseract)
  if (source === 'veryfi' || (extractedText && extractedText.includes('Veryfi'))) {
    confidence = confidence * 1.05; // 5% bonus
  }

  // ========================================
  // CONTEXTUAL ADJUSTMENTS
  // ========================================

  // Penalty only if ALL medicines are missing critical info
  const hasNoDosage = medicines.every(m => !m.dosage && !m.hasMultiplePhases);
  const hasNoFrequency = medicines.every(m => !m.frequency && !m.instructions?.frequency);
  
  if (hasNoDosage) confidence -= 8; // Reduced from 10
  if (hasNoFrequency) confidence -= 5; // Reduced from 10

  // Bonus for complex prescriptions handled well
  const hasComplexDosing = medicines.some(m => m.hasMultiplePhases);
  if (hasComplexDosing) {
    confidence += 5;
  }

  // Bonus for all medicines verified
  const allVerified = medicines.every(m => m.verified);
  if (allVerified && medicines.length > 0) {
    confidence += 5;
  }

  // ========================================
  // FINAL ADJUSTMENTS
  // ========================================

  // Ensure confidence is between 0 and 100
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return confidence;
};

