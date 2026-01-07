import levenshtein from "fast-levenshtein";
import { getAllMedicines } from "../repositories/medicine.repository.js";
import { MEDICINE_SYNONYMS } from "../data/medicine.synonyms.js";

/**
 * Enhanced OCR fixes - common OCR mistakes in prescription handwriting
 */
const OCR_FIXES = {
  // Common character misreads
  "0": "o",
  "1": "l",
  "5": "s",
  "6": "b",
  "8": "b",
  "rn": "m",
  "cl": "d",
  "ii": "u",
  "vv": "w",
  "ri": "n",
  "li": "h",
  "ti": "h",
  "in": "m",
  "io": "u",
  // Common word misreads in prescriptions
  "tab": "tab",
  "cap": "cap",
  "tabs": "tabs",
  "caps": "caps",
};

/**
 * Common medicine name patterns that OCR often misreads
 */
const MEDICINE_PATTERNS = {
  "paracetamol": ["paracetamol", "paracetamoi", "paracetamo1", "paracetamoi", "paracetamoi"],
  "amoxicillin": ["amoxicillin", "amoxiciiin", "amoxicil1in", "amoxicillrn"],
  "azithromycin": ["azithromycin", "azithromycm", "azithromycn", "azithromycn"],
  "cetirizine": ["cetirizine", "cetirizrne", "cetirizme"],
  "ibuprofen": ["ibuprofen", "ibuprofen", "ibuprofcn"],
  "pantoprazole": ["pantoprazole", "pantoprazolc", "pantoprazolc"],
};

/**
 * Expand OCR fixes with context-aware replacements
 */
function applyOCRFixes(text) {
  let normalized = text.toLowerCase();
  
  // Apply character-level fixes
  for (const [wrong, correct] of Object.entries(OCR_FIXES)) {
    normalized = normalized.replace(new RegExp(wrong, "gi"), correct);
  }
  
  // Apply common prescription patterns
  normalized = normalized
    .replace(/\b(tab|tablet)\b/gi, "tab")
    .replace(/\b(cap|capsule)\b/gi, "cap")
    .replace(/\b(mg|mcg|ml)\b/gi, (match) => match.toLowerCase())
    .replace(/\b(bf|before food)\b/gi, "bf")
    .replace(/\b(af|after food)\b/gi, "af")
    .replace(/\b(od|once daily)\b/gi, "od")
    .replace(/\b(bd|twice daily)\b/gi, "bd")
    .replace(/\b(tds|thrice daily)\b/gi, "tds")
    .replace(/\b(qid|four times)\b/gi, "qid")
    .replace(/\b(hs|at bedtime)\b/gi, "hs")
    .replace(/\b(sos|as needed)\b/gi, "sos");
  
  return normalized;
}

/**
 * Fuzzy match medicine names against database
 */
function fuzzyMatchMedicineName(input, threshold = 3) {
  const allMedicines = getAllMedicines();
  const inputLower = input.toLowerCase().trim();
  
  let bestMatch = null;
  let bestDistance = Infinity;
  let bestSimilarity = 0;
  
  for (const medicine of allMedicines) {
    const medName = medicine.medicine_name.toLowerCase();
    
    // Exact match
    if (medName === inputLower) {
      return { match: medicine.medicine_name, confidence: 1.0, distance: 0 };
    }
    
    // Check synonyms
    if (MEDICINE_SYNONYMS[inputLower] === medName) {
      return { match: medicine.medicine_name, confidence: 0.95, distance: 1 };
    }
    
    // Levenshtein distance
    const distance = levenshtein.get(inputLower, medName);
    const similarity = 1 - (distance / Math.max(inputLower.length, medName.length));
    
    if (distance < bestDistance && distance <= threshold) {
      bestDistance = distance;
      bestMatch = medicine.medicine_name;
      bestSimilarity = similarity;
    }
    
    // Also check against generic name
    if (medicine.generic_name) {
      const genericName = medicine.generic_name.toLowerCase();
      const genericDistance = levenshtein.get(inputLower, genericName);
      const genericSimilarity = 1 - (genericDistance / Math.max(inputLower.length, genericName.length));
      
      if (genericDistance < bestDistance && genericDistance <= threshold) {
        bestDistance = genericDistance;
        bestMatch = medicine.medicine_name;
        bestSimilarity = genericSimilarity;
      }
    }
  }
  
  if (bestMatch && bestSimilarity > 0.6) {
    return { 
      match: bestMatch, 
      confidence: bestSimilarity, 
      distance: bestDistance 
    };
  }
  
  return null;
}

/**
 * Normalize and correct OCR text with medicine database suggestions
 */
export function normalizeOCRText(rawText) {
  if (!rawText || !rawText.trim()) {
    return { normalizedText: "", corrections: [] };
  }
  
  const corrections = [];
  let normalizedText = applyOCRFixes(rawText);
  
  // Extract potential medicine names (words that look like medicine names)
  // Medicine names are typically 4+ characters, not numbers, not common words
  const words = normalizedText.split(/\s+/);
  const commonWords = new Set([
    "tab", "caps", "tablet", "capsule", "mg", "g", "ml", "mcg",
    "bf", "af", "od", "bd", "tds", "qid", "hs", "sos",
    "before", "after", "food", "with", "without", "times", "daily"
  ]);
  
  const medicineWords = words.filter(word => 
    word.length >= 4 && 
    !commonWords.has(word.toLowerCase()) &&
    !/^\d+$/.test(word) &&
    !/^\d+[mgmlmcg]$/i.test(word)
  );
  
  // Try to match each potential medicine word
  for (const word of medicineWords) {
    const match = fuzzyMatchMedicineName(word);
    if (match && match.confidence > 0.7) {
      const originalIndex = words.indexOf(word);
      if (originalIndex !== -1) {
        words[originalIndex] = match.match;
        corrections.push({
          original: word,
          corrected: match.match,
          confidence: match.confidence
        });
      }
    }
  }
  
  normalizedText = words.join(" ");
  
  return {
    normalizedText,
    corrections,
    originalText: rawText
  };
}

/**
 * Get suggestions for a given text input (for auto-complete/correction)
 */
export function getTextSuggestions(text) {
  if (!text || text.length < 3) {
    return [];
  }
  
  const allMedicines = getAllMedicines();
  const suggestions = [];
  const textLower = text.toLowerCase();
  
  for (const medicine of allMedicines) {
    const medName = medicine.medicine_name.toLowerCase();
    
    // Check if text is a prefix
    if (medName.startsWith(textLower)) {
      suggestions.push({
        text: medicine.medicine_name,
        type: "prefix",
        confidence: 0.9
      });
      continue;
    }
    
    // Fuzzy match
    const distance = levenshtein.get(textLower, medName);
    const similarity = 1 - (distance / Math.max(textLower.length, medName.length));
    
    if (similarity > 0.7 && distance <= 3) {
      suggestions.push({
        text: medicine.medicine_name,
        type: "fuzzy",
        confidence: similarity
      });
    }
  }
  
  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);
  
  return suggestions.slice(0, 5); // Return top 5
}

