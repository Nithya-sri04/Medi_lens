/**
 * Parse Veryfi raw OCR text to extract medicine information
 * Fallback when prescription_list is not available
 */

/**
 * Extract medicine lines from raw OCR text
 * Looks for patterns like: Tab., Cap., Syr., Inj., etc.
 */
export function parseMedicinesFromText(ocrText, debug = true) {
  if (!ocrText) return [];

  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
  const medicines = [];

  // Medicine detection patterns (must be at word boundaries, not inside words)
  // 1. Single letter + dot: "T.PAN", "C.AMOX", "S.CETRI"
  // 2. Full prefix: "Tab.", "Cap.", "Inj.", "Syr."
  // 3. OCR errors: "Iab.", "Tap.", "Gap."
  const hasMedicinePrefix = /\b([TCSIBEtcsiabe]|Tab|Cap|Syr|Inj|Iab|Tap|Gap|tab|cap|syr|inj)\.\s*[A-Z]/i;
  const hasDotPrefix = /^\.\s*[A-Z][a-z]{2,}/; // Lines starting with ". Word" (min 3 letters)
  const hasMedicineLikeName = /[A-Z][A-Z]{2,}[a-z]+[-\d]/; // Words like "AMOXiclav-500" (mixed case with number)

  if (debug) {
    console.log(`   🔍 Parsing ${lines.length} lines for medicines...`);
    console.log(`   📄 All lines:`);
    lines.forEach((l, idx) => console.log(`      ${idx+1}. "${l.substring(0, 60)}${l.length > 60 ? '...' : ''}"`));
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip obvious header/footer/non-medicine lines
    const skipPatterns = [
      /মোবাইল/,
      /রোড/,
      /ঢাকা/,
      /ঔষধালয়/,
      /বিদ্যালয়/,
      /^[০-৯]+$/, // Bengali numbers only
      /^[\d\-\+\s]+$/, // Numbers/symbols only
      /phone|mobile|address|clinic/i,
      /^(NORMAL|SOFT|LIGHT|HEAVY|REST|AVOID|TAKE|FOLLOW|CONTINUE|DIET|FOOD|WATER)/i, // Instructions
      /^(DR\.|DOCTOR|PATIENT|NAME|AGE|DATE|SEX|VISIT)/i, // Header info
    ];

    const shouldSkip = skipPatterns.some(pattern => pattern.test(line));
    if (shouldSkip || line.length < 3) {
      if (debug) console.log(`   ⊗ Line ${i+1} skipped (header/footer/instruction)`);
      continue;
    }

    // Check if line contains medicine indicators
    const hasPrefix = hasMedicinePrefix.test(line);
    const hasDot = hasDotPrefix.test(line);
    const hasName = hasMedicineLikeName.test(line);
    const hasPattern = hasPrefix || hasDot || hasName;
    
    if (debug && hasPattern) {
      console.log(`   ✓ Line ${i+1} matches: "${line.substring(0, 50)}..." (prefix=${hasPrefix}, dot=${hasDot}, name=${hasName})`);
    } else if (debug) {
      console.log(`   - Line ${i+1} no pattern: "${line.substring(0, 50)}..."`);
    }
    
    if (hasPattern) {
      // Parse ALL medicines in this line (there might be multiple)
      const parsedList = parseMedicineLineMultiple(line);
      if (parsedList.length > 0) {
        medicines.push(...parsedList);
        if (debug) {
          parsedList.forEach(p => console.log(`     → Extracted: ${p.name} ${p.dose}`));
        }
      } else if (debug) {
        console.log(`     ✗ Failed to parse this line`);
      }
    }
  }

  return medicines;
}

/**
 * Parse multiple medicines from a single line (Veryfi sometimes puts multiple on one line)
 * Examples:
 *   "Iab. Omiclon 144- Tap. 9. Esonix-20 a a"
 */
function parseMedicineLineMultiple(line) {
  const medicines = [];
  
  // Pattern: Prefix at word boundary followed by medicine name
  // Must start with prefix (not match it in the middle of words)
  // Matches: "T.PAN", "C.AMOXICLAV", "Tab. Esonix", "Iab. Omiclon"
  const prefixPattern = /\b([TtCcSsIiEeBbGgLlOo]|Tab|Cap|Syr|Inj|tab|cap|syr|inj)\.?\s*([A-Z][A-Z0-9\s\-]+?)(?=\s+\d|\s+[A-Z]{2,}\/|\s*$|\s+x|\s+X)/gi;
  
  let match;
  const seenNames = new Set(); // Avoid duplicates
  
  while ((match = prefixPattern.exec(line)) !== null) {
    const prefix = match[1];
    let medicineName = match[2].trim();
    
    // Stop at dose patterns or end markers
    medicineName = medicineName.replace(/\s*(MG|ML|GM|X|\d+).*$/i, '').trim();
    
    // Skip if too short or looks like junk
    if (medicineName.length < 3 || /^(TO|AT|L\/A|B\/F|OF|OR|AND|THE|FOR)$/i.test(medicineName)) {
      continue;
    }
    
    // Normalize prefix
    let normalizedPrefix = 'Tab';
    const upperPrefix = prefix.toUpperCase();
    if (upperPrefix === 'T' || /TAB|IAB|LAB|TAP/i.test(upperPrefix)) {
      normalizedPrefix = 'Tab';
    } else if (upperPrefix === 'C' || /CAP|GAP/i.test(upperPrefix)) {
      normalizedPrefix = 'Cap';
    } else if (upperPrefix === 'S' || /SYR|GYR/i.test(upperPrefix)) {
      normalizedPrefix = 'Syr';
    } else if (upperPrefix === 'I' || /INJ/i.test(upperPrefix)) {
      normalizedPrefix = 'Inj';
    } else if (/^[BOE]$/i.test(upperPrefix)) {
      normalizedPrefix = 'Tab'; // OCR errors
    }
    
    const fullName = `${normalizedPrefix}. ${medicineName}`;
    
    // Skip duplicates
    if (seenNames.has(fullName)) {
      continue;
    }
    seenNames.add(fullName);
    
    // Extract dose: look for patterns like "625 MG", "40 MG", "1-0-1"
    const afterMatch = line.substring(match.index + match[0].length).trim();
    const doseMatch = afterMatch.match(/^(\d+\s*(?:MG|ML|GM)?|\d+[-+]\d+[-+]\d+)/i);
    const dose = doseMatch ? doseMatch[1] : '';
    
    medicines.push({
      name: fullName,
      dose: dose,
      description: '',
    });
  }
  
  // Fallback: If no matches, try simple single-letter prefix at start
  if (medicines.length === 0) {
    const simplePattern = /^([TCSI])\.([A-Z][A-Z]+)/;
    const simpleMatch = line.match(simplePattern);
    if (simpleMatch) {
      const prefix = simpleMatch[1];
      const name = simpleMatch[2];
      const normalizedPrefix = prefix === 'T' ? 'Tab' : prefix === 'C' ? 'Cap' : prefix === 'S' ? 'Syr' : 'Inj';
      
      const restOfLine = line.substring(simpleMatch[0].length).trim();
      const doseMatch = restOfLine.match(/^(\d+\s*(?:MG|ML|GM)?|\d+[-+]\d+[-+]\d+)/i);
      
      medicines.push({
        name: `${normalizedPrefix}. ${name}`,
        dose: doseMatch ? doseMatch[1] : '',
        description: '',
      });
    }
  }
  
  return medicines;
}

/**
 * Parse a single medicine line (legacy, keeping for reference)
 * Examples:
 *   "Tab. Omidon 1+1+1"
 *   "Cap. Esonix-20 20mg"
 *   "B. Ovel-500 500"
 */
function parseMedicineLine(line) {
  // Very permissive pattern to catch OCR errors
  // Matches: Tab./Iab./Tap., Cap./Gap., El./B., etc. + medicine name
  const match = line.match(/([TtIiLlGg][aA][bBpP]|[CcGg][aA][pP]|[SsGg][yY][rRpP]|[IiLl][nN][jJ]|[EeBb][lL]|[TtIi]|[Cc]|[SsGg]|[BbEe])\.?\s*(?:\d+\.\s*)?([A-Z][A-Za-z0-9\-]+)/i);
  
  if (!match) return null;
  
  const prefix = match[1];
  const medicineName = match[2];
  
  // Normalize prefix (convert OCR errors to standard)
  let normalizedPrefix = prefix.toUpperCase();
  if (/[TIL]AB|TAP|IAB/i.test(normalizedPrefix)) {
    normalizedPrefix = 'Tab';
  } else if (/[CG]AP/i.test(normalizedPrefix)) {
    normalizedPrefix = 'Cap';
  } else if (/[SG]YR/i.test(normalizedPrefix)) {
    normalizedPrefix = 'Syr';
  } else if (/[EBL]L/i.test(normalizedPrefix)) {
    normalizedPrefix = 'Tab'; // El. is likely Tab. OCR error
  }
  
  const fullName = `${normalizedPrefix}. ${medicineName}`;
  
  // Get rest of line for dose
  const restOfLine = line.substring(line.indexOf(match[0]) + match[0].length).trim();
  
  // Extract dose/frequency patterns: 1+1+1, 1-0-1, numbers, mg, ml
  const doseMatch = restOfLine.match(/[\d\+\-x×]+|^\d+\s*(mg|ml)?/i);
  const dose = doseMatch ? doseMatch[0] : '';

  return {
    name: fullName,
    dose: dose || '',
    description: '',
  };
}

/**
 * Format medicines array as text for display
 */
export function formatMedicinesAsText(medicines) {
  return medicines
    .map(med => {
      const parts = [med.name, med.dose, med.description].filter(Boolean);
      return parts.join(' ');
    })
    .join('\n');
}
