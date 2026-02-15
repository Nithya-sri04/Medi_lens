import { normalizeText } from "../utils/textNormalizer.js";
import { applyPrescriptionOCRFixes } from "../utils/prescriptionOCRFixes.js";
import { extractMedicines } from "../services/medicineExtractor.js";
import { findInteraction, findMedicine } from "../repositories/medicine.repository.js";
import { calculateConfidenceScore } from "../services/coreAccuracy/confidenceCalculator.js";
import { detectDuplicates } from "../services/coreAccuracy/duplicateDetector.js";
import llmExplanationService from "../services/llmExplanationService.js";

export const analyzePrescription = async (req, res) => {
  const { text, source } = req.body;

  if (!text) {
    return res.status(400).json({ error: "TEXT_REQUIRED" });
  }

  const ocrCorrected = applyPrescriptionOCRFixes(text);
  const normalized = normalizeText(ocrCorrected);
  const medicines = await extractMedicines(normalized);

  if (!medicines.length) {
    return res.json({
      warning: "NO_KNOWN_MEDICINES_FOUND",
      rawText: text,
      extractedText: normalized,
      disclaimer: "This is not medical advice. Consult a healthcare professional.",
      confidence: 0
    });
  }

  // Check for drug interactions
  const interactions = [];
  const medicineNames = medicines.map(m => m.name.toLowerCase());
  for (let i = 0; i < medicineNames.length; i++) {
    for (let j = i + 1; j < medicineNames.length; j++) {
      const interaction = await findInteraction(medicineNames[i], medicineNames[j]);
      if (interaction) {
        interactions.push({
          medicines: [medicines[i].name, medicines[j].name],
          severity: interaction.severity,
          warning: interaction.warning
        });
      }
    }
  }

  // Enrich medicines with database data
  const enrichedMedicines = await Promise.all(medicines.map(async (med) => {
    const dbData = await findMedicine(med.name);
    return {
      ...med,
      ...dbData,
      verified: !!dbData
    };
  }));

  // Prepare clean JSON structure for LLM (no warning/side_effects - we don't show general warnings)
  const llmMedicinesData = enrichedMedicines.map(med => {
    const isContinue = med.instructions?.isContinue === true;
    const duration = med.instructions?.durationDays
      ? `${med.instructions.durationDays} days`
      : (isContinue ? 'Continue as prescribed' : '');
    return {
      name: med.name || '',
      dosage: med.dosage || '',
      frequency: med.frequency || '',
      timing: med.instructions?.timing?.join(', ') || '',
      food_relation: med.instructions?.foodRelation || '',
      duration,
      composition: med.composition || '',
      generic_name: med.genericName || '',
      brand_type: med.brandType || '',
      purpose: med.purpose || '',
      food_habits: med.foodHabits?.join('; ') || '',
      verified: med.verified || false
    };
  });

  // Detect duplicate medicines (same composition)
  const duplicates = detectDuplicates(enrichedMedicines);

  // Calculate enhanced confidence score using Core Accuracy Layer
  const confidence = calculateConfidenceScore(enrichedMedicines, source, normalized);

  // Generate LLM explanations (general warnings removed; pregnancy/liver from DB shown via safetyAdvice only)
  let explanations = [];
  try {
    explanations = await llmExplanationService.explainMedicines(llmMedicinesData);
    console.log('LLM explanations generated:', explanations);
  } catch (error) {
    console.error('LLM explanation failed:', error);
    explanations = llmMedicinesData.map(med => {
      let explanation = `Take ${med.name}`;
      if (med.dosage) explanation += ` ${med.dosage}`;
      if (med.frequency) explanation += ` ${med.frequency}`;
      if (med.timing) explanation += ` at ${med.timing}`;
      if (med.food_relation) explanation += ` ${med.food_relation.toLowerCase()}`;
      if (med.duration) explanation += med.duration === 'Continue as prescribed' ? ` ${med.duration}` : ` for ${med.duration}`;
      if (med.composition) explanation += `. It contains ${med.composition}`;
      explanation += '.';
      return explanation;
    });
    console.log('Fallback explanations generated:', explanations);
  }

  // Ensure explanations array matches medicines length — pad or trim, never replace all
  if (explanations.length !== enrichedMedicines.length) {
    console.warn(`Explanations length (${explanations.length}) doesn't match medicines length (${enrichedMedicines.length}) — padding/trimming`);
    if (explanations.length < enrichedMedicines.length) {
      while (explanations.length < enrichedMedicines.length) {
        explanations.push('Explanation temporarily unavailable');
      }
    } else {
      explanations = explanations.slice(0, enrichedMedicines.length);
    }
  }

  // Safety Advice removed — strip raw warning/sideEffects from response, no LLM safety call
  const medicinesForResponse = enrichedMedicines.map((med) => {
    const { warning, warningSummary, sideEffects, ...rest } = med;
    return {
      ...rest,
      safetyAdviceSummary: null
    };
  });

  // Disclaimer
  const disclaimer = "This analysis is for informational purposes only and does not constitute medical advice. Always consult with a qualified healthcare professional before starting or changing any medication regimen.";

  console.log('Final response:', {
    medicinesCount: enrichedMedicines.length,
    explanationsCount: explanations.length,
    explanations: explanations.map((exp, i) => `Med ${i}: "${exp}"`)
  });

  return res.json({
    extractedText: normalized,
    medicines: medicinesForResponse,
    interactions,
    duplicates,
    confidence,
    explanations,
    disclaimer
  });
};
