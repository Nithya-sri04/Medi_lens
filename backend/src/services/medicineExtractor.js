import { findMedicine, findMedicineByComposition, findInteraction, getMedicineDetails } from "../repositories/medicine.repository.js";
import { extractDosage } from "../utils/dosageParser.js";
import { parseInstructions } from "../utils/instructionParser.js";
import { normalizeMedicineName } from "../utils/normalizeMedicineName.js";
import { correctMedicineNameOCRTypo, applyPrescriptionOCRFixes } from "../utils/prescriptionOCRFixes.js";
import { verifyMedicine } from "./coreAccuracy/medicineVerificationService.js";
import { detectGenericBrand, getMarketAlternatives } from "./coreAccuracy/genericBrandDetector.js";
import { getFoodHabits, getFoodInteractionWarnings } from "./coreAccuracy/foodHabitsService.js";
import { getBrandToComposition } from "../config/brandToComposition.js";

/**
 * Extract medicine name patterns from prescription text
 * Handles formats like: T.Amoxycillin 250mg, INJ CEFAZOLIN 1G, C.AMOXICLAV 625 MG
 * Returns array of potential medicine names with and without dosage
 */
/** Map prescription prefix to a preferred dosage form for DB ranking */
const prefixToDosageForm = (prefix) => {
  const p = (prefix || '').toLowerCase().replace(/[.\s]/g, '');
  if (['t', 'tab', 'tablet'].includes(p)) return 'Tablet';
  if (['c', 'cap', 'capsule'].includes(p)) return 'Capsule';
  if (['inj', 'injection'].includes(p)) return 'Injection';
  if (['syp', 'syrup'].includes(p)) return 'Syrup';
  if (['ointment', 'oint'].includes(p)) return 'Ointment';
  if (['cream'].includes(p)) return 'Cream';
  if (['drops', 'drop'].includes(p)) return 'Drops';
  return null;
};

const extractMedicinePatterns = (text) => {
  const prefixPatterns = [];
  
  // Pattern 1: Prefix + Medicine Name + Dosage (e.g., "T.Amoxycillin 250mg", "C.AMOXICLAV 625 MG", "T.PAN 40 MG")
  const prefixPattern = /(?:^|\s)(t\.|tab\.?|tablet\.?|c\.|cap\.?|capsule\.?|inj\.?|injection\.?|syp\.?|syrup\.?|ointment\.?|oint\.?)\s*([^\d]+?)(?:\s+(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|%))|\s+(?=\d+-\d+-\d+|[lo]-[lo]-[lo]|\d+\s*x\s*|x\s*\d+\s*(?:day|days)\b|b\/f|a\/f|l\/a|at\s|to\s+(?:continue|conhnue|continne)))/gi;
  
  let match;
  while ((match = prefixPattern.exec(text)) !== null) {
    const prefix = match[1].trim();
    let medicineName = match[2].trim();
    const dosage = match[3] ? match[3].trim() : null;
    
    console.log(`  📝 Regex match: prefix="${prefix}", name="${medicineName}", dosage="${dosage}"`);
    
    // Detect dosage form from prefix AND from words within the captured name
    let dosageForm = prefixToDosageForm(prefix);
    
    // Strip trailing route/form abbreviations from medicine name
    // "bact ointment la" → strip "la" (local application) and "ointment" (dosage form)
    medicineName = medicineName
      .replace(/\s+(b\/f|a\/f|l\/a|la|at|iv|p\/r|tablet|capsule|injection|syrup|ointment|cream|drops|gel|lotion|forte)$/i, (m, word) => {
        // If the word is a dosage form, capture it (overrides prefix-based form)
        const formWord = word.toLowerCase();
        if (['ointment', 'cream', 'gel', 'lotion', 'drops', 'tablet', 'capsule', 'injection', 'syrup'].includes(formWord)) {
          console.log(`    → Found form word at end: "${formWord}"`);
          dosageForm = formWord.charAt(0).toUpperCase() + formWord.slice(1);
        }
        // "forte" is part of the medicine name (e.g. "Chymoral Forte"), keep it
        if (formWord === 'forte') return m;
        return '';
      })
      .trim();
    
    console.log(`    → After stripping trailing: "${medicineName}"`);
    
    // Also check for "ointment" in the middle of the name (e.g. "bact ointment")
    const ointmentInMiddle = medicineName.match(/^(.+?)\s+(ointment|cream|gel|lotion|drops|tablet|capsule|injection|syrup)\b/i);
    if (ointmentInMiddle) {
      console.log(`    → Found form word in middle: "${ointmentInMiddle[2]}"`);
      dosageForm = ointmentInMiddle[2].charAt(0).toUpperCase() + ointmentInMiddle[2].slice(1).toLowerCase();
      medicineName = ointmentInMiddle[1].trim();
      console.log(`    → Extracted name: "${medicineName}"`);
    }
    
    if (medicineName && medicineName.length > 2) {
      const pattern = {
        original: match[0].trim(),
        nameWithDosage: dosage ? `${medicineName} ${dosage}` : null,
        nameWithoutDosage: medicineName,
        normalized: normalizeMedicineName(medicineName),
        source: 'prefix',
        dosageForm: dosageForm
      };
      console.log(`  📋 Extracted pattern: "${pattern.nameWithoutDosage}" (form: ${dosageForm || 'none'})`);
      prefixPatterns.push(pattern);
    }
  }
  
  // If prefix patterns found medicines, return ONLY those (one entry per prescription line prefix).
  // This prevents stray words ("forte", "la", etc.) from being treated as separate medicines.
  if (prefixPatterns.length > 0) {
    return prefixPatterns;
  }
  
  // Fallback Pattern 2: Medicine Name + Dosage without prefix (e.g., "Amoxycillin 250mg Tablet")
  const fallbackPatterns = [];
  const nameDosagePattern = /\b([a-zA-Z]+(?:\s+[a-zA-Z]+)*?)\s+(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|%))\s*(?:tablet|capsule|tab|cap|inj|injection|syrup|syp|ointment)?/gi;
  
  while ((match = nameDosagePattern.exec(text)) !== null) {
    const medicineName = match[1].trim();
    const dosage = match[2].trim();
    if (medicineName.length > 2) {
      fallbackPatterns.push({
        original: match[0].trim(),
        nameWithDosage: `${medicineName} ${dosage}`,
        nameWithoutDosage: medicineName,
        normalized: normalizeMedicineName(medicineName),
        source: 'nameDosage'
      });
    }
  }
  
  if (fallbackPatterns.length > 0) {
    return fallbackPatterns;
  }
  
  // Last resort Pattern 3: Simple medicine names (only used if nothing above matched)
  const simplePatterns = [];
  const simpleNamePattern = /\b([a-zA-Z]{4,}(?:\s+[a-zA-Z]{4,})*?)\b/gi;
  const commonWords = new Set([
    'tablet', 'capsule', 'injection', 'syrup', 'ointment', 'suppository',
    'before', 'after', 'food', 'days', 'day', 'continue', 'forte',
    'with', 'without', 'take', 'apply', 'times', 'daily', 'morning',
    'afternoon', 'night', 'normal', 'diet', 'cream', 'lotion', 'drops',
    'tabs', 'caps', 'injs', 'stat'
  ]);
  
  while ((match = simpleNamePattern.exec(text)) !== null) {
    const medicineName = match[1].trim();
    const lowerName = medicineName.toLowerCase();
    if (!commonWords.has(lowerName) && simplePatterns.length === 0) {
      simplePatterns.push({
        original: medicineName,
        nameWithDosage: null,
        nameWithoutDosage: medicineName,
        normalized: normalizeMedicineName(medicineName),
        source: 'simple'
      });
    }
  }
  
  return simplePatterns;
};

/** Extract dosage number from pattern (e.g. "625" from "amoxiclav 625 mg") for ranking */
const extractDosageForRanking = (pattern) => {
  const src = pattern.nameWithDosage || pattern.nameWithoutDosage || '';
  const m = src.match(/(\d+(?:\.\d+)?)\s*(?:mg|g|ml|mcg|iu|%)/i);
  return m ? m[1] : null;
};

/** Normalize dosage string for comparison (e.g. "625 mg" and "625mg" -> same). */
const normalizeDosageForCompare = (str) => {
  if (!str || typeof str !== 'string') return '';
  const m = String(str).trim().match(/(\d+(?:\.\d+)?)\s*(mg|g|ml|mcg|iu|%)/i);
  return m ? `${m[1]} ${(m[2] || '').toLowerCase()}`.trim() : String(str).replace(/\s+/g, ' ').trim();
};

/** Extract dosage from medicine name (e.g. "Amoxiclav 625mg Tablet" -> "625 mg"). */
const extractDosageFromMedicineName = (name) => {
  if (!name || typeof name !== 'string') return null;
  const m = name.match(/(\d+(?:\.\d+)?)\s*(mg|g|ml|mcg|iu|%)/i);
  return m ? `${m[1]} ${(m[2] || '').toLowerCase()}`.trim() : null;
};

/**
 * Try multiple search strategies. Name-first: search by name first; repository ranks by dosage so we get closest match.
 * If prescription dosage differs from DB medicine dosage, caller will set dosageMismatch and show "take as prescribed".
 */
const findMedicineWithStrategies = async (pattern) => {
  let medicine = null;
  let matchedName = null;
  const prescriptionDosage = extractDosageForRanking(pattern);
  const originalSearchTerm = (pattern.nameWithoutDosage || '').trim().split(/\s+/)[0] || null;
  const preferredForm = pattern.dosageForm || null; // e.g. "Ointment", "Tablet"
  const rankOptions = { prescriptionDosage, originalSearchTerm, preferredForm };

  // Strategy 0 (FIRST): Check brand-to-composition map for known brands
  // This prevents "limcee" from fuzzy-matching "Vitamin C Injection" via Strategy 3
  console.log(`  → Strategy 0: Checking brand-to-composition mapping`);
  const brandToComposition = getBrandToComposition();
  let brandKey = (pattern.nameWithoutDosage || '').toLowerCase().trim().replace(/\s+/g, ' ');
  // If full key not in map (e.g. "limcee x 2 days"), try first word only ("limcee")
  let composition = brandToComposition[brandKey];
  if (!composition && brandKey.includes(' ')) {
    const firstWord = brandKey.split(/\s+/)[0];
    if (firstWord.length >= 3) {
      console.log(`    → Full key "${brandKey}" not in map, trying first word "${firstWord}"`);
      composition = brandToComposition[firstWord];
      if (composition) brandKey = firstWord;
    }
  }
  console.log(`    → Brand key: "${brandKey}", composition: ${composition || 'none'}`);
  if (composition) {
    // Prefer tablet when prescription prefix is t./tab. (pattern.dosageForm can be missing if name included " x 2 days")
    let form = preferredForm;
    if (!form && pattern.original) {
      const o = pattern.original.trim().toLowerCase();
      if (o.startsWith('t.') || o.startsWith('tab.') || o.startsWith('tablet.') || o.startsWith('tab ')) form = 'Tablet';
      else if (o.startsWith('c.') || o.startsWith('cap.') || o.startsWith('capsule.')) form = 'Capsule';
      else if (o.startsWith('inj.') || o.startsWith('injection.')) form = 'Injection';
      else if (o.startsWith('ointment.') || o.startsWith('oint.')) form = 'Ointment';
      else if (o.startsWith('syp.') || o.startsWith('syrup.')) form = 'Syrup';
    }
    console.log(`🔄 Strategy 0: Brand "${brandKey}" → composition "${composition}" (preferredForm: ${form || 'none'})`);
    medicine = await findMedicineByComposition(composition, form);
    if (medicine) {
      matchedName = pattern.nameWithDosage || pattern.nameWithoutDosage;
      console.log(`  ✅ Found equivalent via composition: ${medicine.name || medicine.medicine_name}`);
      return { medicine, matchedName, equivalentBrand: true, searchedAs: pattern.nameWithoutDosage };
    } else {
      console.log(`  ❌ No match found for composition "${composition}"`);
    }
  } else {
    console.log(`    → Brand "${brandKey}" not in map, continuing to regular search`);
  }

  // Strategy 1: Search by NAME first (no dosage). DB ranks by dosage when multiple exist → we get closest match.
  if (pattern.nameWithoutDosage) {
    console.log(`  → Strategy 1: Searching by name "${pattern.nameWithoutDosage}"`);
    medicine = await findMedicine(pattern.nameWithoutDosage, rankOptions);
    if (medicine) {
      const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
      const searchName = pattern.nameWithoutDosage.toLowerCase();
      const searchFirstWord = searchName.split(' ')[0];
      const medicineFirstWord = medicineName.split(' ')[0];
      const nameMatches = searchFirstWord.length >= 3 &&
        (medicineFirstWord.startsWith(searchFirstWord) || searchFirstWord.startsWith(medicineFirstWord) ||
          medicineName.includes(searchFirstWord) || searchName.includes(medicineFirstWord));
      if (nameMatches) {
        console.log(`    ✅ Strategy 1 matched: "${medicineName}"`);
        matchedName = pattern.nameWithDosage || pattern.nameWithoutDosage;
        return { medicine, matchedName };
      } else {
        console.log(`    ❌ Strategy 1 found "${medicineName}" but name doesn't match well enough`);
      }
    } else {
      console.log(`    ❌ Strategy 1: No results`);
    }
  }

  // Strategy 2: Search with dosage (exact match) and spacing variations
  if (pattern.nameWithDosage) {
    console.log(`  → Strategy 2: Searching with dosage "${pattern.nameWithDosage}"`);
    medicine = await findMedicine(pattern.nameWithDosage, rankOptions);
    if (medicine) {
      const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
      const searchName = pattern.nameWithDosage.toLowerCase();
      if (medicineName.includes(searchName.split(' ')[0]) || searchName.includes(medicineName.split(' ')[0])) {
        console.log(`    ✅ Strategy 2 matched: "${medicineName}"`);
        matchedName = pattern.nameWithDosage;
        return { medicine, matchedName };
      } else {
        console.log(`    ❌ Strategy 2 found "${medicineName}" but name doesn't match`);
      }
    } else {
      console.log(`    ❌ Strategy 2: No results`);
    }
    const variations = [
      pattern.nameWithDosage.replace(/(\d+)\s*(mg|g|ml|mcg)/gi, '$1$2'),
      pattern.nameWithDosage.replace(/(\d+)(mg|g|ml|mcg)/gi, '$1 $2'),
    ];
    for (const variation of variations) {
      if (variation !== pattern.nameWithDosage) {
        medicine = await findMedicine(variation, rankOptions);
        if (medicine) {
          const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
          if (medicineName.includes(variation.toLowerCase().split(' ')[0])) {
            matchedName = variation;
            return { medicine, matchedName };
          }
        }
      }
    }
  }

  // Strategy 3: Search normalized name (synonym mapping)
  if (pattern.normalized && pattern.normalized.length >= 3) {
    console.log(`  → Strategy 3: Searching normalized "${pattern.normalized}"`);
    medicine = await findMedicine(pattern.normalized, rankOptions);
    if (medicine) {
      const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
      const searchName = pattern.normalized.toLowerCase();
      const searchFirstWord = searchName.split(' ')[0];
      const medicineFirstWord = medicineName.split(' ')[0];
      if (searchFirstWord.length >= 3 &&
          (medicineFirstWord.startsWith(searchFirstWord) || searchFirstWord.startsWith(medicineFirstWord))) {
        console.log(`    ✅ Strategy 3 matched: "${medicineName}"`);
        matchedName = pattern.nameWithDosage || pattern.normalized;
        return { medicine, matchedName };
      } else {
        console.log(`    ❌ Strategy 3 found "${medicineName}" but doesn't match well`);
      }
    } else {
      console.log(`    ❌ Strategy 3: No results`);
    }
  }

  // Strategy 4: OCR typo correction - try corrected names (e.g. amoxidav→amoxiclav, hmcee→limcee)
  console.log(`  → Strategy 4: OCR typo correction`);
  const toTry = [
    pattern.nameWithoutDosage && correctMedicineNameOCRTypo(pattern.nameWithoutDosage),
    pattern.normalized && correctMedicineNameOCRTypo(pattern.normalized.split(/\s+/)[0]),
    pattern.nameWithDosage && pattern.nameWithDosage.split(/\s+/)[0] && correctMedicineNameOCRTypo(pattern.nameWithDosage.split(/\s+/)[0])
  ].filter(Boolean);
  const seen = new Set();
  for (const candidate of toTry) {
    const key = candidate.toLowerCase();
    if (seen.has(key) || key.length < 3) continue;
    seen.add(key);
    console.log(`    → Trying OCR-corrected: "${candidate}"`);
    medicine = await findMedicine(candidate, rankOptions);
    if (medicine) {
      const medicineName = (medicine.name || medicine.medicine_name || '').toLowerCase();
      if (medicineName.includes(key) || key.includes(medicineName.split(' ')[0])) {
        console.log(`    ✅ Strategy 4 matched: "${medicineName}"`);
        matchedName = pattern.nameWithDosage || medicine.name || medicine.medicine_name;
        return { medicine, matchedName };
      } else {
        console.log(`    ❌ Strategy 4 found "${medicineName}" but doesn't match`);
      }
    }
  }
  console.log(`    ❌ Strategy 4: No matches`);

  console.log(`  ❌ All strategies failed for "${pattern.nameWithoutDosage}"`);
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
  
  // If no newlines/pipes produced multiple lines, try to split by prescription prefixes
  if (lines.length === 1) {
    // Split on whitespace that precedes a prescription prefix followed by a letter (medicine name start)
    const parts = text.split(/\s+(?=(?:t|c|inj|tab|cap|tablet|capsule|injection|syp|syrup|ointment|oint)\.\s*[a-z])/i);
    if (parts.length > 1) {
      return parts.map(p => p.trim()).filter(p => p.length > 0);
    }
  }
  
  return lines;
};

export const extractMedicines = async (normalizedText) => {
  const results = [];
  const seen = new Set(); // Track processed medicine names

  // Re-apply OCR fixes so l-o-o → 1-0-0, conhnue → continue even if caller passed raw text
  const textForExtraction = applyPrescriptionOCRFixes(normalizedText);
  
  // Split text into individual medicine lines
  const medicineLines = splitIntoMedicineLines(textForExtraction);
  
  console.log('Split into medicine lines:', medicineLines);
  
  // Process each medicine line separately; support multiple medicines on one line (e.g. "t.chymoral ... t.limcee ...")
  for (const line of medicineLines) {
    const medicinePatterns = extractMedicinePatterns(line);
    if (medicinePatterns.length === 0) continue;

    const lineLower = line.toLowerCase();
    for (let pi = 0; pi < medicinePatterns.length; pi++) {
      const pattern = medicinePatterns[pi];
      const key = (pattern.nameWithDosage || pattern.nameWithoutDosage || pattern.normalized || '').toLowerCase();
      if (seen.has(key)) continue;

      const { medicine, matchedName, equivalentBrand, searchedAs } = await findMedicineWithStrategies(pattern);
      if (!medicine || !matchedName) continue;

      const medicineName = medicine.name || medicine.medicine_name;
      if (seen.has(medicineName.toLowerCase())) continue;
      seen.add(medicineName.toLowerCase());

      // Use the segment of the line for this medicine only (so "t.limcee 1-0-0 x 2 days" gets its own dosage)
      const segStart = lineLower.indexOf(pattern.original.toLowerCase());
      const segEnd = pi + 1 < medicinePatterns.length
        ? lineLower.indexOf(medicinePatterns[pi + 1].original.toLowerCase())
        : line.length;
      const segment = (segStart >= 0 ? line.slice(segStart, segEnd < 0 ? line.length : segEnd) : line).trim();

      const { dosage, frequency } = extractDosage(segment);
      const instructions = parseInstructions(segment);

      let extractedDosage = dosage;
      if (pattern.nameWithDosage) {
        const dosageMatch = pattern.nameWithDosage.match(/(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|%))/i);
        if (dosageMatch) extractedDosage = dosageMatch[1];
      }

      // Dosage mismatch: prescription says X, DB medicine name has Y → show closest (DB) and advise "take as prescribed"
      const prescriptionDosageNorm = normalizeDosageForCompare(extractedDosage);
      const databaseDosage = extractDosageFromMedicineName(medicineName);
      const databaseDosageNorm = normalizeDosageForCompare(databaseDosage || '');
      const dosageMismatch = prescriptionDosageNorm && databaseDosageNorm && prescriptionDosageNorm !== databaseDosageNorm;
      const dosageMismatchMessage = dosageMismatch
        ? `Our database shows this medicine as ${databaseDosage || 'different strength'}. Your prescription says ${extractedDosage || 'different'}. Please take as prescribed by your doctor.`
        : null;

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
        dosageMismatch: dosageMismatch || undefined,
        dosageMismatchMessage: dosageMismatchMessage || undefined,
        equivalentBrand: equivalentBrand || undefined,
        equivalentBrandName: (equivalentBrand && searchedAs) ? searchedAs : undefined,
        instructions,
        
        // Basic medicine info (clean trailing slashes/whitespace from DB data)
        purpose: (extended.uses || medicine.uses || medicine.purpose || '')
          .replace(/[\/\s]+$/gm, '').replace(/\n\s*\n/g, '\n').trim() || null,
        warning: extended.side_effects || medicine.side_effects || medicine.warning || null,
        composition: medicine.composition || null,
        manufacturer: medicine.manufacturer || null,
        
        // Extended details from medicine_details_extended
        introduction: extended.introduction || null,
        benefits: extended.benefits || null,
        howToUse: extended.how_to_use || null,
        howDrugWorks: extended.how_drug_works || null,
        quickTips: extended.quick_tips || null,
        // Safety advice removed
        
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
