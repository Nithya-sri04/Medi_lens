import { MEDICINE_SYNONYMS } from "../data/medicine.synonyms.js";

// Enhanced medicine name normalization with abbreviation handling and fuzzy matching
// Handles real-world variations like: T.PAN, C.AMOXICLAV, INJ CEFAZOLIN, T.AMLOKIND, etc.
export const normalizeMedicineName = (rawName) => {
  if (!rawName) return null;

  let cleaned = rawName
    .toLowerCase()
    .trim()
    // Remove common prefixes/abbreviations (expanded list)
    // Handles: T., Tab., Tablet, C., Cap., Capsule, INJ, Injection, Syp., Syrup
    .replace(/^(t\.|tab\.?|tablet\.?|c\.|cap\.?|capsule\.?|inj\.?|injection\.?|syp\.?|syrup\.?|ointment\.?|oint\.?|suppository\.?|supp\.?)\s*/i, '')
    // Remove dosage information (numbers followed by units)
    .replace(/\d+(\.\d+)?\s*(mg|g|ml|mcg|iu|units?|%|micrograms?|milligrams?|grams?|milliliters?)\b/gi, '')
    // Remove route abbreviations (IV, P/R, B/F, L/A, AT, etc.)
    .replace(/\b(iv|p\/r|b\/f|l\/a|at|oral|topical|local)\b/gi, '')
    // Remove common separators and special characters but keep spaces
    .replace(/[^a-z0-9\s]/g, '')
    // Normalize multiple spaces to single space
    .replace(/\s+/g, ' ')
    .trim();

  // Check for exact synonym match first
  if (MEDICINE_SYNONYMS[cleaned]) {
    return MEDICINE_SYNONYMS[cleaned];
  }

  // Check for partial matches (for spelling mistakes)
  for (const [key, value] of Object.entries(MEDICINE_SYNONYMS)) {
    if (cleaned.includes(key) || key.includes(cleaned)) {
      return value;
    }
  }

  // If no synonym found, return the cleaned version
  return cleaned || null;
};

// Additional function to extract medicine name patterns from text
export const extractMedicinePatterns = (text) => {
  if (!text) return [];

  const patterns = [
    // Common medicine patterns: Name + dosage
    /\b([a-zA-Z]+(?:\s+[a-zA-Z]+)*?)\s*\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu|%)\b/gi,
    // Just medicine names
    /\b([a-zA-Z]+(?:\s+[a-zA-Z]+){0,2})\b/gi
  ];

  const matches = new Set();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const medicine = normalizeMedicineName(match[1]);
      if (medicine && medicine.length > 2) { // Avoid very short matches
        matches.add(medicine);
      }
    }
  }

  return Array.from(matches);
};
