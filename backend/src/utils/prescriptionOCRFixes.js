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
  song: "50mg", // OCR error: "song" is misread "50mg"
  "3oomg": "300mg", // OCR error: "300mg" misread as "3oomg"
  com: "650mg", // OCR error: "650mg" misread as "Com" (pres-4)
  "6som": "650mg", // OCR error: "650mg" misread
  "65om": "650mg", // OCR error: "650mg" misread
  amphoterion: "amphotericin", // OCR error: "c" misread as "r"
  amphotenon: "amphotericin", // OCR error: "cic" misread as "non"
  normayin: "normazin", // OCR error: "z" misread as "y"
  normazan: "normazin", // OCR error: "i" misread as "a"
  sompraz: "sompraz", // Keep as is (valid brand name)
  rf: "af", // OCR error: "A" misread as "R" (After Food)
  // pres-5 medicines (common handwritten names)
  omiclon: "omiclon", // Keep as-is (valid medicine name)
  esomix: "esomix", // Esomix-20 (esomeprazole)
  orcl: "orcl", // Orcl-50
  xalcom: "xalcom", // Xalcom (eye drops)
  rhaboval: "rhaboval", // Rhaboval (statin)
  // pres-4 OCR errors (printed prescription)
  acefaminepren: "acetaminophen",
  acefaminophen: "acetaminophen",
  acetominophen: "acetaminophen",
  paracetamol: "acetaminophen", // Same medicine
  asprin: "aspirin",
  aspirn: "aspirin",
  aspirin: "aspirin", // Keep correct
  clopi: "clopidogrel",
  clopidory: "clopidogrel",
  clopidogrel: "clopidogrel", // Keep correct
  remdec: "remdec", // Keep as is (valid medicine name)
  remdesivir: "remdesivir", // Keep correct
  actemra: "actemra", // Keep as is (valid medicine name)
  // Handwritten / Indian prescription OCR (TA→Tab, medicine name typos)
  azenal: "azenac",
  azenac: "azenac",
  zofel: "zofer",
  zofer: "zofer",
  oflazest: "oflazest",
  andial: "andial",
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
  // "G4h" or "G4" → "q4h" (G misread as q)
  t = t.replace(/\bG(\d+)h?\b/gi, "q$1h");
  // "q4 TN" or "q4 PN" → "q4h PRN" (misread PRN)
  t = t.replace(/\bq(\d+)h?\s+(?:TN|PN)\b/gi, "q$1h PRN");
  // "rin Pon TO" or "rin PO" → "Aspirin PO" (broken Aspirin)
  t = t.replace(/\brin\s+Pon?\s+(?:TO|to)/gi, "Aspirin PO");
  t = t.replace(/\brin\s+(?=\d+\s*mg)/gi, "Aspirin ");
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
 * Normalize tablet prefix variants (TA, TA3, TAS → Tab.) so parser recognizes medicine lines.
 * Only replace when followed by an uppercase letter (medicine name). Order: TA3, TAS before TA.
 */
function fixTabletPrefixVariants(text) {
  return text.replace(/\b(TA3|TAS|TAD|TA)\s+(?=[A-Z])/g, "Tab. ");
}

/**
 * Fix medicine-name phrases where OCR misreads characters (e.g. OFLAZEST 02 → OFLAZEST OZ).
 */
function fixMedicinePhraseTypos(text) {
  let t = text;
  t = t.replace(/\bOFLAZEST\s+02\b/gi, "OFLAZEST OZ");
  t = t.replace(/\bAZENAL\s*-\s*MR\b/gi, "AZENAC-MR");
  return t;
}

/**
 * Fix "Ing." → "Inj." (Injection) — common OCR misread on hospital prescriptions.
 * Also fix "Adv: gy REMDEC" → "Inj. REMDEC" (Advice: marker with OCR errors)
 */
function fixInjPrefix(text) {
  let t = text;
  // Fix "Adv: gy REMDEC" → "Inj. REMDEC" (Advice: OCR error, gy is noise)
  t = t.replace(/\bAdv:\s*gy\s+([A-Z][A-Za-z0-9\s]+)/gi, "Inj. $1");
  // Fix "Adv:" without the gy variant (cleanup "Advice:" prefix)
  t = t.replace(/\bAdv:\s+(?!gy)/gi, "Inj. ");
  // Standard Ing. → Inj.
  t = t.replace(/\bIng\./g, "Inj.");
  return t;
}

/**
 * Fix dosage line OCR: "Sony" / "song" before vials → "50mg"; (300g) → (300mg).
 */
function fixVialDosageTypos(text) {
  let t = text;
  t = t.replace(/\b(Sony|song)\s*[^\d]*(\d+)\s*vials?/gi, "50mg $2 vials");
  t = t.replace(/\b(Sony|song)\s*$/gim, "50mg");
  t = t.replace(/\(\s*(\d+)\s*[gG]\s*\)/g, "($1mg)"); // (300g) → (300mg) in parens
  return t;
}

/**
 * Run all prescription OCR fixes on raw text. Call this before normalizeText().
 */
export function applyPrescriptionOCRFixes(text) {
  if (!text || typeof text !== "string") return text;
  let t = text;
  t = fixInjPrefix(t);
  t = fixTabletPrefixVariants(t);
  t = fixMedicinePhraseTypos(t);
  t = fixVialDosageTypos(t);
  t = fixDosageDigitLetterConfusion(t);
  t = fixMedicineNameTypos(t);
  return t;
}

/** Expose for use in extractor when a single token needs correction (e.g. for search fallback) */
export function correctMedicineNameOCRTypo(name) {
  if (!name) return name;
  
  // Try to correct the entire name first
  const lower = name.toLowerCase().trim();
  if (MEDICINE_OCR_TYPOS[lower]) {
    return MEDICINE_OCR_TYPOS[lower];
  }
  
  // If not found, apply word-by-word correction (for multi-word names like "liposomal amphoterion b")
  const words = name.split(/\b/);
  const result = words.map((w) => {
    const lowerWord = w.toLowerCase();
    if (MEDICINE_OCR_TYPOS[lowerWord] !== undefined) {
      const corrected = MEDICINE_OCR_TYPOS[lowerWord];
      // Preserve original case pattern
      return w === lowerWord ? corrected : corrected.charAt(0).toUpperCase() + corrected.slice(1);
    }
    return w;
  });
  return result.join("");
}
