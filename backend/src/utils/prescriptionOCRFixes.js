/**
 * Fix common OCR misreads in prescription text before medicine extraction.
 * Handles: digit/letter confusion (l↔1, o↔0), dosage patterns, and medicine-name typos.
 */

/** Medicine name OCR typos: wrong → correct (case-insensitive match) */
const MEDICINE_OCR_TYPOS = {
  amoxidav: "amoxiclav",
  amoxydav: "amoxiclav",
  amoxic1av: "amoxiclav",
  amoxilclav: "amoxiclav",
  coamoxiclav: "amoxiclav",
  omtment: "ointment",
  oinment: "ointment",
  amlokmd: "amlokind",
  amlokind: "amlokind", // no change but in map for consistency
  hmcee: "limcee",
  limcee: "limcee",
  conhnue: "continue",
  continne: "continue",
  pan: "pan", // keep
  chymoral: "chymoral",
  bact: "bact",
  pantop: "pantoprazole",
  pantocid: "pantoprazole",
};

/**
 * Fix dosage/instruction digit–letter confusion (l → 1, o → 0 in number context).
 * E.g. "l-o-l" → "1-0-1", "4o mg" → "40 mg", "b2s" → "625", "x l day" → "x 1 day".
 */
function fixDosageDigitLetterConfusion(text) {
  let t = text;
  // Dosage pattern: l-o-l, l-o-o, l-l-l etc. (single letter l or o between dashes)
  t = t.replace(/\b([lo])-([lo])-([lo])\b/gi, (_, a, b, c) => {
    const toNum = (x) => (x.toLowerCase() === "l" ? "1" : "0");
    return `${toNum(a)}-${toNum(b)}-${toNum(c)}`;
  });
  // "x l day" or "x l days" → "x 1 day(s)"; "x lday" (l glued to day) → "x 1 day"
  t = t.replace(/\bx\s+l\s+day(s?)\b/gi, "x 1 day$1");
  t = t.replace(/\bx\s+lday(s?)\b/gi, "x 1 day$1");
  // Number + letter o (digit then letter o): 4o → 40, 1o → 10 (OCR reads 0 as o)
  t = t.replace(/(\d)o\s+(?=mg|g|mcg|ml|day|days)/gi, "$10 ");
  t = t.replace(/(\d)o\s+/g, "$10 ");
  t = t.replace(/(\d)o\s*$/gm, "$10");
  // b2s, b25 etc. before mg: b→6, s→5 → 625
  t = t.replace(/\bb2s\s*(?=mg|g|mcg|ml)/gi, "625 ");
  t = t.replace(/\bb25\s*(?=mg|g|mcg|ml)/gi, "625 ");
  return t;
}

/**
 * Apply medicine-name OCR typo corrections (whole-word, case-insensitive).
 */
function fixMedicineNameTypos(text) {
  let t = text;
  const words = t.split(/\b/);
  const result = words.map((w) => {
    const lower = w.toLowerCase();
    if (MEDICINE_OCR_TYPOS[lower] !== undefined) {
      const corrected = MEDICINE_OCR_TYPOS[lower];
      return w === lower ? corrected : corrected.charAt(0).toUpperCase() + corrected.slice(1);
    }
    return w;
  });
  return result.join("");
}

/**
 * Run all prescription OCR fixes on raw text. Call this before normalizeText().
 */
export function applyPrescriptionOCRFixes(text) {
  if (!text || typeof text !== "string") return text;
  let t = text;
  t = fixDosageDigitLetterConfusion(t);
  t = fixMedicineNameTypos(t);
  return t;
}

/** Expose for use in extractor when a single token needs correction (e.g. for search fallback) */
export function correctMedicineNameOCRTypo(name) {
  if (!name) return name;
  const lower = name.toLowerCase().trim();
  return MEDICINE_OCR_TYPOS[lower] ?? name;
}
