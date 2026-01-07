export const extractDosage = (text) => {
  const dosageRegex =
    /(\d+(\.\d+)?\s?(mg|g|ml|mcg))/i;

  const frequencyRegex =
    /(once daily|twice daily|thrice daily|bd|tds|od|2x|3x|after meals|before meals)/i;

  return {
    dosage: text.match(dosageRegex)?.[0] || null,
    frequency: text.match(frequencyRegex)?.[0] || null
  };
};
