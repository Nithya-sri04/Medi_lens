export const extractDosage = (text) => {
  const frequencyRegex =
    /(once daily|twice daily|thrice daily|bd|tds|od|qid|2x|3x|after meals|before meals)/i;

  // Try to match dosage with explicit units first (e.g. "150mg", "500g")
  let dosageMatch = text.match(/(\d+(?:\.\d+)?)\s?(mg|g|ml|mcg|gm)/i);
  
  // If no unit found, try to match standalone numbers before frequency abbreviations
  // (e.g. "150 bd x 5days" → capture "150")
  if (!dosageMatch) {
    dosageMatch = text.match(/(\d+(?:\.\d+)?)\s+(?:bd|tds|od|qid|bd\s|tds\s|od\s|qid\s)/i);
  }
  
  // If still no match, try any number at the start of the line/after prefix
  if (!dosageMatch) {
    dosageMatch = text.match(/^(?:tab\.|cap\.|inj\.|syr\.?)?\s*(?:[a-z]+\s+)?(\d+(?:\.\d+)?)/i);
  }

  return {
    dosage: dosageMatch?.[1] || null,
    frequency: text.match(frequencyRegex)?.[0] || null
  };
};
