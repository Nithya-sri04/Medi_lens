import { normalizeText } from "../utils/textNormalizer.js";
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

  const normalized = normalizeText(text);
  const medicines = await extractMedicines(normalized);

  if (!medicines.length) {
    return res.json({
      warning: "NO_KNOWN_MEDICINES_FOUND",
      rawText: text,
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

  // Prepare clean JSON structure for LLM
  const llmMedicinesData = enrichedMedicines.map(med => ({
    name: med.name || '',
    dosage: med.dosage || '',
    frequency: med.frequency || '',
    timing: med.instructions?.timing?.join(', ') || '',
    food_relation: med.instructions?.foodRelation || '',
    duration: med.instructions?.durationDays ? `${med.instructions.durationDays} days` : '',
    composition: med.composition || '',
    generic_name: med.genericName || '',
    brand_type: med.brandType || '',
    purpose: med.purpose || '',
    food_habits: med.foodHabits?.join('; ') || '',
    verified: med.verified || false
  }));

  // Detect duplicate medicines (same composition)
  const duplicates = detectDuplicates(enrichedMedicines);

  // Calculate enhanced confidence score using Core Accuracy Layer
  const confidence = calculateConfidenceScore(enrichedMedicines, source, normalized);

  // Generate LLM explanations
  let explanations = [];
  try {
    explanations = await llmExplanationService.explainMedicines(llmMedicinesData);
    console.log('LLM explanations generated:', explanations);
  } catch (error) {
    console.error('LLM explanation failed:', error);
    // Fallback explanations
    explanations = llmMedicinesData.map(med => {
      let explanation = `Take ${med.name}`;
      if (med.dosage) explanation += ` ${med.dosage}`;
      if (med.frequency) explanation += ` ${med.frequency}`;
      if (med.timing) explanation += ` at ${med.timing}`;
      if (med.food_relation) explanation += ` ${med.food_relation.toLowerCase()}`;
      if (med.duration) explanation += ` for ${med.duration}`;
      if (med.composition) explanation += `. It contains ${med.composition}`;
      explanation += '.';
      return explanation;
    });
    console.log('Fallback explanations generated:', explanations);
  }
  
  // Ensure explanations array matches medicines length
  if (explanations.length !== enrichedMedicines.length) {
    console.error(`Explanations length (${explanations.length}) doesn't match medicines length (${enrichedMedicines.length})`);
    explanations = enrichedMedicines.map(() => 'Explanation temporarily unavailable');
  }

  // Disclaimer
  const disclaimer = "This analysis is for informational purposes only and does not constitute medical advice. Always consult with a qualified healthcare professional before starting or changing any medication regimen.";

  console.log('Final response:', {
    medicinesCount: enrichedMedicines.length,
    explanationsCount: explanations.length,
    explanations: explanations.map((exp, i) => `Med ${i}: "${exp}"`)
  });
  
  return res.json({
    extractedText: normalized,
    medicines: enrichedMedicines,
    interactions,
    duplicates,
    confidence,
    explanations,
    disclaimer
  });
};
