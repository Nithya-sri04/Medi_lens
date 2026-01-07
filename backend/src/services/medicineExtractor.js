import { findMedicine, findInteraction, getMedicineDetails } from "../repositories/medicine.repository.js";
import { extractDosage } from "../utils/dosageParser.js";
import { parseInstructions } from "../utils/instructionParser.js";
import { normalizeMedicineName } from "../utils/normalizeMedicineName.js";
import { verifyMedicine } from "./coreAccuracy/medicineVerificationService.js";
import { detectGenericBrand, getMarketAlternatives } from "./coreAccuracy/genericBrandDetector.js";
import { getFoodHabits, getFoodInteractionWarnings } from "./coreAccuracy/foodHabitsService.js";

/**
 * Extract medicine name patterns from prescription text
 * Handles formats like: T.Amoxycillin 250mg, INJ CEFAZOLIN 1G, C.AMOXICLAV 625 MG
 * Returns array of potential medicine names with and without dosage
 */
const extractMedicinePatterns = (text) => {
  const patterns = [];
  
  // Pattern 1: Prefix + Medicine Name + Dosage (e.g., "T.Amoxycillin 250mg", "INJ CEFAZOLIN 1G", "T.CHYMORAL FORTE")
  // Extract the full medicine entry and parse it
  const prefixPattern = /(?:^|\s)(?:t\.|tab\.?|tablet\.?|c\.|cap\.?|capsule\.?|inj\.?|injection\.?|syp\.?|syrup\.?|ointment\.?|oint\.?)\s+([^\d]+?)(?:\s+(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|%))|\s+(?=\d+-\d+-\d+|\d+\s*x\s*|b\/f|a\/f|l\/a|at\s|to\s+continue))/gi;
  
  let match;
  while ((match = prefixPattern.exec(text)) !== null) {
    let medicineName = match[1].trim();
    const dosage = match[2] ? match[2].trim() : null;
    
    // Clean up medicine name - remove route abbreviations and extra words
    medicineName = medicineName
      .replace(/\s+(b\/f|a\/f|l\/a|at|iv|p\/r|tablet|capsule|injection|syrup|ointment)$/i, '')
      .trim();
    
    if (medicineName && medicineName.length > 2) {
      // Add with dosage if available
      if (dosage) {
        patterns.push({
          original: match[0].trim(),
          nameWithDosage: `${medicineName} ${dosage}`,
          nameWithoutDosage: medicineName,
          normalized: normalizeMedicineName(medicineName)
        });
      } else {
        patterns.push({
          original: match[0].trim(),
          nameWithDosage: null,
          nameWithoutDosage: medicineName,
          normalized: normalizeMedicineName(medicineName)
        });
      }
    }
  }
  
  // Pattern 2: Medicine Name + Dosage without prefix (e.g., "Amoxycillin 250mg Tablet", "amoxycillin 250mg tablet")
  // Case-insensitive pattern to catch both uppercase and lowercase
  // Handles spacing variations: "250mg" or "250 mg"
  const nameDosagePattern = /\b([a-zA-Z]+(?:\s+[a-zA-Z]+)*?)\s+(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|%))\s*(?:tablet|capsule|tab|cap|inj|injection|syrup|syp|ointment)?/gi;
  
  while ((match = nameDosagePattern.exec(text)) !== null) {
    const medicineName = match[1].trim();
    const dosage = match[2].trim();
    
    // Skip if already captured by prefix pattern
    const alreadyCaptured = patterns.some(p => 
      p.nameWithoutDosage.toLowerCase() === medicineName.toLowerCase()
    );
    
    if (!alreadyCaptured && medicineName.length > 2) {
      patterns.push({
        original: match[0].trim(),
        nameWithDosage: `${medicineName} ${dosage}`,
        nameWithoutDosage: medicineName,
        normalized: normalizeMedicineName(medicineName)
      });
    }
  }
  
  // Pattern 3: Simple medicine names (fallback for names without dosage)
  // Case-insensitive to catch lowercase medicine names
  const simpleNamePattern = /\b([a-zA-Z]{3,}(?:\s+[a-zA-Z]+)*?)\b/gi;
  const commonWords = new Set(['tablet', 'capsule', 'injection', 'syrup', 'ointment', 'suppository', 'before', 'after', 'food', 'days', 'day']);
  
  while ((match = simpleNamePattern.exec(text)) !== null) {
    const medicineName = match[1].trim();
    const lowerName = medicineName.toLowerCase();
    
    // Skip common words and already captured patterns
    if (!commonWords.has(lowerName) && 
        !patterns.some(p => p.nameWithoutDosage.toLowerCase() === lowerName)) {
      patterns.push({
        original: medicineName,
        nameWithDosage: null,
        nameWithoutDosage: medicineName,
        normalized: normalizeMedicineName(medicineName)
      });
    }
  }
  
  return patterns;
};

/**
 * Try multiple search strategies to find a medicine
 * 1. Search with dosage (exact match) - STRICT
 * 2. Search without dosage - MODERATE
 * 3. Search normalized name - FALLBACK
 * 
 * When dosage is present, we prioritize exact/close matches to avoid wrong medicine matching
 */
const findMedicineWithStrategies = async (pattern) => {
  let medicine = null;
  let matchedName = null;
  
  // Strategy 1: Search with dosage if available (STRICT - prioritize exact matches)
  if (pattern.nameWithDosage) {
    // Try exact match first
    medicine = await findMedicine(pattern.nameWithDosage);
    if (medicine) {
      const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
      const searchName = pattern.nameWithDosage.toLowerCase();
      
      // Verify it's a good match (name should be very similar)
      if (medicineName.includes(searchName.split(' ')[0]) || searchName.includes(medicineName.split(' ')[0])) {
        matchedName = pattern.nameWithDosage;
        return { medicine, matchedName };
      }
    }
    
    // Try with different spacing variations
    const variations = [
      pattern.nameWithDosage.replace(/(\d+)\s*(mg|g|ml|mcg)/gi, '$1$2'), // "250 mg" -> "250mg"
      pattern.nameWithDosage.replace(/(\d+)(mg|g|ml|mcg)/gi, '$1 $2'), // "250mg" -> "250 mg"
    ];
    
    for (const variation of variations) {
      if (variation !== pattern.nameWithDosage) {
        medicine = await findMedicine(variation);
        if (medicine) {
          const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
          const searchName = variation.toLowerCase();
          
          // Verify it's a good match
          if (medicineName.includes(searchName.split(' ')[0]) || searchName.includes(medicineName.split(' ')[0])) {
            matchedName = variation;
            return { medicine, matchedName };
          }
        }
      }
    }
  }
  
  // Strategy 2: Search without dosage (MODERATE - check if name matches well)
  if (pattern.nameWithoutDosage) {
    medicine = await findMedicine(pattern.nameWithoutDosage);
    if (medicine) {
      const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
      const searchName = pattern.nameWithoutDosage.toLowerCase();
      
      // For names without dosage, be more strict - first word should match
      const searchFirstWord = searchName.split(' ')[0];
      const medicineFirstWord = medicineName.split(' ')[0];
      
      if (searchFirstWord.length >= 3 && 
          (medicineFirstWord.startsWith(searchFirstWord) || searchFirstWord.startsWith(medicineFirstWord))) {
        matchedName = pattern.nameWithoutDosage;
        return { medicine, matchedName };
      }
    }
  }
  
  // Strategy 3: Search normalized name (FALLBACK - use synonym mapping)
  if (pattern.normalized && pattern.normalized.length >= 3) {
    medicine = await findMedicine(pattern.normalized);
    if (medicine) {
      const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
      const searchName = pattern.normalized.toLowerCase();
      
      // For normalized names, verify first word matches
      const searchFirstWord = searchName.split(' ')[0];
      const medicineFirstWord = medicineName.split(' ')[0];
      
      if (searchFirstWord.length >= 3 && 
          (medicineFirstWord.startsWith(searchFirstWord) || searchFirstWord.startsWith(medicineFirstWord))) {
        matchedName = pattern.normalized;
        return { medicine, matchedName };
      }
    }
  }
  
  return { medicine: null, matchedName: null };
};

/**
 * Split prescription text into individual medicine lines
 * Handles formats like: "C.AMOXICLAV 625 MG 1-0-1 X 1 DAY"
 */
const splitIntoMedicineLines = (text) => {
  // Split by newlines, pipes, or multiple spaces
  const lines = text
    .split(/\n|\|/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.match(/^(normal\s+)?diet$/i));
  
  // If no newlines/pipes, try to split by patterns that indicate new medicine
  if (lines.length === 1) {
    // Pattern: T./C./INJ at start of line (case insensitive)
    const medicineLinePattern = /(?:^|\n)(?:t\.|c\.|inj\.?|tab\.?|cap\.?|tablet\.?|capsule\.?|injection\.?)\s+[^\n]+/gi;
    const matches = text.match(medicineLinePattern);
    if (matches && matches.length > 1) {
      return matches.map(m => m.trim().replace(/^\n/, ''));
    }
  }
  
  return lines;
};

export const extractMedicines = async (normalizedText) => {
  const results = [];
  const seen = new Set(); // Track processed medicine names
  
  // Split text into individual medicine lines
  const medicineLines = splitIntoMedicineLines(normalizedText);
  
  console.log('Split into medicine lines:', medicineLines);
  
  // Process each medicine line separately
  for (const line of medicineLines) {
    // Extract medicine patterns from this line only
    const medicinePatterns = extractMedicinePatterns(line);
    
    if (medicinePatterns.length === 0) {
      continue;
    }
    
    // Use the first (most likely) pattern from this line
    const pattern = medicinePatterns[0];
    
    // Skip if already processed
    const key = (pattern.nameWithDosage || pattern.nameWithoutDosage || pattern.normalized || '').toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    
    // Try to find medicine using multiple strategies
    const { medicine, matchedName } = await findMedicineWithStrategies(pattern);
    
    if (medicine && matchedName) {
      const medicineName = medicine.name || medicine.medicine_name;
      
      // Skip if already processed
      if (seen.has(medicineName.toLowerCase())) {
        continue;
      }
      
      seen.add(medicineName.toLowerCase());
      
      // Extract dosage and instructions from THIS LINE ONLY, not entire text
      const { dosage, frequency } = extractDosage(line);
      const instructions = parseInstructions(line);
      
      // Extract dosage from the pattern if available
      let extractedDosage = dosage;
      if (pattern.nameWithDosage) {
        const dosageMatch = pattern.nameWithDosage.match(/(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|%))/i);
        if (dosageMatch) {
          extractedDosage = dosageMatch[1];
        }
      }

      // Verify medicine (check both name and medicine_name fields)
      const verification = verifyMedicine(medicine, matchedName);

      // Detect generic/branded
      const genericBrand = detectGenericBrand(medicine);

      // Get food habits (await async function)
      const foodHabits = await getFoodHabits(medicine);
      const foodWarnings = getFoodInteractionWarnings(medicine);

      // Get market alternatives (function queries DB internally, no need for allMedicines)
      const marketAlternatives = await getMarketAlternatives(medicine);

      // Extract related data from medicine object (already fetched by findMedicine)
      const prices = medicine.prices || [];
      const extended = medicine.extended || {};
      const foodInteractions = medicine.foodInteractions || [];

      // Build complete medicine result object
      results.push({
        name: medicineName,
        originalName: pattern.original,
        dosage: extractedDosage || dosage,
        frequency: frequency || instructions.frequency,
        verified: verification.verified,
        verificationMessage: verification.message,
        instructions,
        
        // Basic medicine info
        purpose: extended.uses || medicine.uses || medicine.purpose || null,
        warning: extended.side_effects || medicine.side_effects || medicine.warning || null,
        composition: medicine.composition || null,
        manufacturer: medicine.manufacturer || null,
        
        // Extended details from medicine_details_extended
        introduction: extended.introduction || null,
        benefits: extended.benefits || null,
        howToUse: extended.how_to_use || null,
        howDrugWorks: extended.how_drug_works || null,
        quickTips: extended.quick_tips || null,
        safetyAdvice: {
          alcohol: extended.safety_alcohol || null,
          pregnancy: extended.safety_pregnancy || null,
          breastfeeding: extended.safety_breastfeeding || null,
          driving: extended.safety_driving || null,
          kidney: extended.safety_kidney || null,
          liver: extended.safety_liver || null
        },
        
        // Prices and alternatives
        prices: prices.map(p => ({
          name: p.name,
          price: p.price,
          manufacturer: p.manufacturer_name,
          packSize: p.pack_size_label,
          type: p.type
        })),
        cheapestAlternative: prices.length > 0 ? prices[0] : null,
        
        // Food interactions
        foodInteractions: foodInteractions.map(fi => ({
          food: fi.food,
          interactions: Array.isArray(fi.interactions) ? fi.interactions : []
        })),
        
        // Generic/Brand info
        genericName: genericBrand.genericName,
        brandType: genericBrand.type,
        brandName: genericBrand.brandName,
        
        // Food habits and warnings
        foodHabits: foodHabits,
        foodInteractionWarnings: foodWarnings,
        
        // Market alternatives
        marketAlternatives: marketAlternatives,
        
        // Review data
        reviews: {
          excellent: medicine.excellent_review_percent || 0,
          average: medicine.average_review_percent || 0,
          poor: medicine.poor_review_percent || 0
        },
        
        // Legacy fields (for backward compatibility)
        alternatives: medicine.alternatives?.split(";").filter(a => a.trim()) || [],
        uses: extended.uses || medicine.uses || null,
        sideEffects: extended.side_effects || medicine.side_effects || null
      });
    }
  }

  return results;
};
