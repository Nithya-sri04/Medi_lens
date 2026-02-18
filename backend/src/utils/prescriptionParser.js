/**
 * Parse Veryfi raw OCR text to extract medicine information
 * Fallback when prescription_list is not available
 */

/**
 * Extract medicine lines from raw OCR text
 * Looks for patterns like: Tab., Cap., Syr., Inj., etc.
 * Also captures multi-line dosage instructions
 */
export function parseMedicinesFromText(ocrText, debug = true) {
  if (!ocrText) return [];

  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
  const medicines = [];

  // Medicine detection patterns (at word boundaries or start of line)
  // 1. Single letter + dot: "T.PAN", "C.AMOX", "S.CETRI", "I.REMDESIVIR"
  // 2. Full prefix: "Tab.", "Cap.", "Inj.", "Syr."
  // 3. OCR errors for Inj: "Luj", "Auj", "Adv" (only at start of line)
  // 4. RX symbol or "B" prefix: "B Acetaminophen", "RX Aspirin"
  const hasMedicinePrefix = /(?:^|\s)([TCSI]|Tab|Cap|Syr|Inj|Iab|Tap|Gap|tab|cap|syr|inj|mj)\.\s*[A-Z]/i;
  const hasOcrInjPrefix = /^(Luj|Auj|Adv)\s/i; // OCR errors for Inj at line start (followed by anything)
  const hasDotPrefix = /^\.\s*[A-Z][a-z]{2,}/; // Lines starting with ". Word" (min 3 letters)
  const hasMedicineLikeName = /[A-Z][A-Z]{2,}[a-z]+[-\d]/; // Words like "AMOXiclav-500" (mixed case with number)
  const hasRxPrefix = /^(?:B|RX|Rx)\s+[A-Z][a-z]+/i; // "B Acetaminophen" or "RX Aspirin"
  const hasCommonMedicine = /\b(Acetaminophen|Paracetamol|Aspirin|Ibuprofen|Amoxicillin|Clopidogrel|Metformin|Atorvastatin|Lisinopril|Omeprazole|Esomeprazole)\b/i;

  if (debug) {
    console.log(`   🔍 Parsing ${lines.length} lines for medicines...`);
    console.log(`   📄 All lines:`);
    lines.forEach((l, idx) => console.log(`      ${idx+1}. "${l.substring(0, 60)}${l.length > 60 ? '...' : ''}"`));
  }

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Preprocess: Strip leading numbers (e.g., "7. T. Medicine" → "T. Medicine")
    // Also handle cases like "7. MEDICINE NAME" → "T. MEDICINE NAME" (assume Tablet if no prefix after number)
    const numberedLinePattern = /^(\d+\.?\s+)(.+)$/;
    const numberedMatch = line.match(numberedLinePattern);
    if (numberedMatch) {
      const afterNumber = numberedMatch[2].trim();
      
      // If the rest doesn't start with a medicine prefix, and has a medicine-like pattern, add "T." prefix
      const hasPrefixAlready = /^([TCSI]|Tab|Cap|Syr|Inj|Luj|Auj|Adv)\./i.test(afterNumber);
      
      if (!hasPrefixAlready) {
        // Check if this looks like a medicine name (uppercase letters, possibly with timing/food patterns)
        const looksLikeMedicine = /^[A-Z][A-Z\-]+.*(?:\d-\d-\d|BF|AF|BD|OD|TDS|QID)/i.test(afterNumber);
        
        if (looksLikeMedicine) {
          line = 'T. ' + afterNumber; // Assume Tablet
        } else {
          line = afterNumber;
        }
      } else {
        line = afterNumber;
      }
    }
    
    // Skip obvious header/footer/non-medicine lines (LESS AGGRESSIVE)
    const skipPatterns = [
      /মোবাইল/,
      /রোড/,
      /ঢাকা/,
      /ঔষধালয়/,
      /বিদ্যালয়/,
      /^[০-৯]+$/, // Bengali numbers only
      /^[\d\-\+\s]+$/, // Numbers/symbols only (but not lines with text)
      /phone|mobile|address|clinic/i,
      /^(DR\.|DOCTOR|PATIENT|NAME|AGE|DATE|SEX|VISIT|NOTE:)/i, // Header info
    ];

    const shouldSkip = skipPatterns.some(pattern => pattern.test(line));
    if (shouldSkip || line.length < 2) {
      if (debug) console.log(`   ⊗ Line ${i+1} skipped (header/footer)`);
      continue;
    }

    // Check if line contains medicine indicators
    const hasPrefix = hasMedicinePrefix.test(line);
    const hasDot = hasDotPrefix.test(line);
    const hasName = hasMedicineLikeName.test(line);
    const hasOcrInj = hasOcrInjPrefix.test(line);
    const hasRx = hasRxPrefix.test(line); // "B Acetaminophen" or "RX Aspirin"
    const hasCommon = hasCommonMedicine.test(line); // Common medicine names
    const hasPattern = hasPrefix || hasDot || hasName || hasOcrInj || hasRx || hasCommon;
    
    if (debug && hasPattern) {
      console.log(`   ✓ Line ${i+1} matches: "${line.substring(0, 50)}..." (prefix=${hasPrefix}, dot=${hasDot}, name=${hasName}, ocrInj=${hasOcrInj}, rx=${hasRx}, common=${hasCommon})`);
    } else if (debug) {
      console.log(`   - Line ${i+1} no pattern: "${line.substring(0, 50)}..."`);
    }
    
    if (hasPattern) {
      // Parse medicine from this line and capture multi-line dosage
      const parsedList = parseMedicineLineMultiple(line, lines, i);
      if (parsedList.length > 0) {
        medicines.push(...parsedList);
        if (debug) {
          parsedList.forEach(p => {
            console.log(`     → Extracted: ${p.name}`);
            console.log(`        Dose: ${p.dose || '(none)'}`);
            console.log(`        Description: ${p.description || '(none)'}`);
          });
        }
      } else if (debug) {
        console.log(`     ✗ Failed to parse this line`);
      }
    }
  }

  return medicines;
}

/**
 * Parse multiple medicines from a single line and capture multi-line dosage
 * Examples:
 *   "Iab. Omiclon 144- Tap. 9. Esonix-20 a a"
 *   "Inj. REMDESIVIR" (followed by dosage on next lines)
 * 
 * @param {string} line - Current line with medicine prefix
 * @param {string[]} allLines - All lines from OCR text
 * @param {number} currentIndex - Index of current line
 */
function parseMedicineLineMultiple(line, allLines = [], currentIndex = 0) {
  const medicines = [];
  
  // Two patterns:
  // 1. Standard prefix with dot: "T.PAN", "Tab. Esonix", "Inj. REMDESIVIR", "C.AMOXICLAV"
  const standardPattern = /(?:^|\s)([TCSI]|Tab|Cap|Syr|Inj|Iab|Tap|Gap|tab|cap|syr|inj|mj)\.?\s*([A-Z][A-Z0-9\s\-\(\)]+?)(?=\s+\d|\s+[A-Z]{2,}\/|\s*$|\s+x|\s+X)/gi;
  
  // 2. OCR error pattern for Inj (only at line start): "Luj Liposomal", "Auj (conventional) Amphotericin", "Adv"
  const ocrInjPattern = /^(Luj|Auj|Adv)\s+(.+?)$/i; // Match everything after the prefix
  
  const seenNames = new Set(); // Avoid duplicates
  
  // Try RX/B prefix pattern first: "B Acetaminophen", "RX Aspirin"
  const rxPattern = /^(B|RX|Rx)\s+([A-Z][a-z]+(?:ofen|illin|phen|prazole|idogrel|vastatin|ipril|formin)?)\s*(.*)$/i;
  const rxMatch = line.match(rxPattern);
  if (rxMatch) {
    let medicineName = rxMatch[2].trim();
    const restOfLine = rxMatch[3].trim();
    
    // Extract dosage from rest of line
    const dosageMatch = restOfLine.match(/(\d+)\s*(mg|ml|gm|g)\b/i);
    const dose = dosageMatch ? dosageMatch[0] : '';
    
    const fullName = medicineName;
    seenNames.add(fullName);
    
    // Collect multi-line description
    let description = restOfLine;
    if (allLines && allLines.length > currentIndex + 1) {
      const nextLines = allLines.slice(currentIndex + 1, currentIndex + 3);
      for (const nextLine of nextLines) {
        const trimmed = nextLine.trim();
        if (trimmed && !/(Dr\.|Patient|Date|Hospital|CHUS)/i.test(trimmed)) {
          description += ' ' + trimmed;
        }
      }
    }
    
    medicines.push({
      name: fullName,
      dose: dose,
      description: description.trim(),
    });
  }
  
  // Try common medicine names: "Aspirin", "Clopidogrel", etc.
  const commonPattern = /\b(Acetaminophen|Paracetamol|Aspirin|Ibuprofen|Amoxicillin|Clopidogrel|Metformin|Atorvastatin|Lisinopril|Omeprazole|Esomeprazole)(?:\s+(\d+\s*(?:mg|ml|gm|g)))?\b/gi;
  let commonMatch;
  while ((commonMatch = commonPattern.exec(line)) !== null) {
    const medicineName = commonMatch[1];
    const dose = commonMatch[2] || '';
    const fullName = medicineName;
    
    if (seenNames.has(fullName)) continue;
    seenNames.add(fullName);
    
    // Get rest of line after medicine name for description
    const afterName = line.substring(commonMatch.index + commonMatch[0].length).trim();
    
    medicines.push({
      name: fullName,
      dose: dose,
      description: afterName,
    });
  }
  
  // Try OCR Inj pattern (for lines starting with Luj, Auj, Adv)
  const ocrInjMatch = line.match(ocrInjPattern);
  if (ocrInjMatch) {
    const prefix = ocrInjMatch[1]; // "Luj", "Auj", or "Adv"
    let medicineName = ocrInjMatch[2].trim();
    
    // Stop at dose patterns
    medicineName = medicineName.replace(/\s*(MG|ML|GM|X|\d+).*$/i, '').trim();
    
    if (medicineName.length >= 3) {
      const fullName = `Inj. ${medicineName}`;
      seenNames.add(fullName);
      
      // Check next lines for dosage
      let description = '';
      if (allLines && allLines.length > currentIndex + 1) {
        const nextLines = allLines.slice(currentIndex + 1, currentIndex + 6);
        const dosageLines = [];
        
        const dosePatterns = [
          /^\d+\s*(?:mg|ml|gm|g)/i,           // "200mg iv Day 1"
          /^followed by/i,                      // "Followed by"
          /^\d+\s*(?:mg|ml|gm).*(?:day|daily|bd|od|tid|qid|wks)/i, // "100mg for 4 days"
          /^\(day\s*\d+.*day\s*\d+\)/i,       // "(Day 2 - Day 5)"
          /^(?:for|after|before|with).*(?:day|meal|food)/i, // "for 4 days", "after meals"
          /^\d+[-+x]\d+[-+x]\d+/,             // "1-0-1", "1+1+1"
          /^song\s*$/i,                       // OCR error: "song" is misread "50mg" - capture it
          /^iv\s*od/i,                        // "IV OD" route + frequency
          /^x\s*\d+\s*(?:wks?|weeks?|days?)/i, // "x 2 wks", "x 5 days"
        ];
        
        for (const nextLine of nextLines) {
          const trimmed = nextLine.trim();
          
          // Skip empty lines
          if (!trimmed || trimmed.length === 0) continue;
          
          // Stop if we hit another medicine or header
          // Include "T.", "C.", "S.", "I." patterns
          if (/(?:^|\s)[TCSI]\.|(?:Tab|Cap|Syr|Inj|Luj|Auj|Adv|Dr\.|Patient|Name|Hospital)\./i.test(trimmed)) {
            break;
          }
          
          // Check if this line contains dosage info
          const isDosage = dosePatterns.some(pattern => pattern.test(trimmed));
          if (isDosage) {
            dosageLines.push(trimmed);
          } else if (dosageLines.length > 0) {
            // Stop after collecting some dosage lines and hitting a non-dosage line
            break;
          }
        }
        
        if (dosageLines.length > 0) {
          description = dosageLines.join(' ');
        }
      }
      
      medicines.push({
        name: fullName,
        dose: '',
        description: description,
      });
    }
  }
  
  // Try standard pattern for medicines with prefixes
  let match;
  while ((match = standardPattern.exec(line)) !== null) {
    const prefix = match[1];
    let medicineName = match[2].trim();
    
    // Stop at dose patterns or end markers
    // IMPORTANT: Use word boundary to avoid removing "X" from medicine names like "AMOXICLAV"
    // Only remove standalone " X " when followed by numbers/days (e.g., " X 1 DAY")
    medicineName = medicineName.replace(/\s+(?:X\s+(?:\d+|TO)|MG|ML|GM).*$/i, '').trim();
    
    // Remove trailing numbers ONLY if they look like dosage mistakenly included
    // But keep numbers that are part of the medicine name (e.g., "FORTE" shouldn't remove "1")
    medicineName = medicineName.replace(/\s+\d+\s*$/i, '').trim();
    
    // Skip if too short or looks like junk
    // Skip instruction phrases like "O CONTINUE", "TO CONTINUE"
    const isOnlyJunk = /^(TO|O\s+CONTINUE|L\/A|B\/F|OF|OR|AND|THE|FOR|CONTINUE)$/i.test(medicineName);
    const isTooShort = medicineName.length < 3;
    
    if (isTooShort || isOnlyJunk) {
      continue;
    }
    
    // Remove trailing " AT" if present (e.g., "AMLOKIND AT" → "AMLOKIND")
    medicineName = medicineName.replace(/\s+AT$/i, '').trim();
    
    // Normalize prefix (including OCR errors like "mj" -> "Inj", "Luj" -> "Inj", "Auj" -> "Inj")
    let normalizedPrefix = 'Tab';
    const upperPrefix = prefix.toUpperCase();
    if (upperPrefix === 'T' || /TAB|IAB|LAB|TAP/i.test(upperPrefix)) {
      normalizedPrefix = 'Tab';
    } else if (upperPrefix === 'C' || /CAP|GAP/i.test(upperPrefix)) {
      normalizedPrefix = 'Cap';
    } else if (upperPrefix === 'S' || /SYR|GYR/i.test(upperPrefix)) {
      normalizedPrefix = 'Syr';
    } else if (upperPrefix === 'I' || /INJ|MJ|LUJ|AUJ|ADV/i.test(upperPrefix)) {
      normalizedPrefix = 'Inj'; // Handle "mj", "Luj", "Auj", "Adv" OCR errors
    } else if (/^[BOE]$/i.test(upperPrefix)) {
      normalizedPrefix = 'Tab'; // OCR errors
    }
    
    const fullName = `${normalizedPrefix}. ${medicineName}`;
    
    // Skip duplicates
    if (seenNames.has(fullName)) {
      continue;
    }
    seenNames.add(fullName);
    
    // Extract dose from current line
    const afterMatch = line.substring(match.index + match[0].length).trim();
    
    let doseSameLine = null;
    let charsToSkip = 0; // Track how many chars to skip for description
    
    // First, check if this starts with a timing pattern (e.g., "0-0-1", "1-0-0")
    // This prevents matching "0" as a dose when it's part of "0-0-1"
    const timingPattern = afterMatch.match(/^(\d+[-+]\d+[-+]\d+)/);
    if (timingPattern) {
      // Don't extract as dose - timing patterns are instructions, not doses
      // Leave doseSameLine as null, charsToSkip as 0
    } else {
      // Try to extract dose with units (most reliable)
      doseSameLine = afterMatch.match(/^(\d{1,4})\s*(MG|ML|GM|MCG|G)\b/i);
      
      if (!doseSameLine) {
        // Try dose without units, but validate it's a realistic dosage
        // Look for common dosage patterns: 5, 10, 20, 25, 40, 50, 75, 100, 200, 250, 500, 1000, etc.
        const doseMatch = afterMatch.match(/^(\d{1,4})\b/);
        if (doseMatch) {
          const potentialDose = parseInt(doseMatch[1]);
          const originalMatch = doseMatch[0]; // e.g., "407"
          
          // Check if it's a realistic dosage (divisible by 5, or very small like 1-4, but not 0)
          if (potentialDose >= 1 && potentialDose <= 4 || potentialDose % 5 === 0 || potentialDose % 10 === 0) {
            doseSameLine = doseMatch;
            charsToSkip = originalMatch.length;
          } else if (potentialDose > 100) {
            // For larger numbers, check if removing last digit makes it valid
            // e.g., "407" → try "40" (which is 40mg, valid), but skip original "407" length
            const withoutLastDigit = Math.floor(potentialDose / 10);
            if (withoutLastDigit >= 5 && (withoutLastDigit % 5 === 0 || withoutLastDigit % 10 === 0)) {
              doseSameLine = [withoutLastDigit.toString(), withoutLastDigit.toString()];
              charsToSkip = originalMatch.length; // Skip the full "407", not just "40"
            }
          }
        }
      } else {
        charsToSkip = doseSameLine[0].length;
      }
    }
    
    let doseInfo = doseSameLine ? doseSameLine[1] : '';
    
      // Check PREVIOUS line for duration markers like "7×", "5x"
      let durationPrefix = '';
      if (currentIndex > 0) {
        const prevLine = allLines[currentIndex - 1].trim();
        const durationMarkerMatch = prevLine.match(/^(\d+)\s*[×x]\s*$/i);
        if (durationMarkerMatch) {
          durationPrefix = durationMarkerMatch[1] + 'x ';
        }
      }
      
      // Start description with the rest of the current line (after medicine name and dose)
      // This captures timing (1-0-1), food relation (BF/AF), etc. on the same line
      let description = afterMatch;
      if (charsToSkip > 0) {
        // Skip the characters we used for dose extraction
        description = afterMatch.substring(charsToSkip).trim();
      }
      
      // Prepend duration marker if found on previous line
      if (durationPrefix) {
        description = durationPrefix + description;
      }
    
      // Check next 5 lines for additional dosage information
      if (allLines && allLines.length > currentIndex + 1) {
        const nextLines = allLines.slice(currentIndex + 1, currentIndex + 6);
        const dosageLines = [];
        
        // Patterns that indicate dosage/instruction lines
        const dosePatterns = [
          /^\d+\s*(?:mg|ml|gm|g)/i,           // "200mg iv Day 1"
          /^followed by/i,                      // "Followed by"
          /^\d+\s*(?:mg|ml|gm).*(?:day|daily|bd|od|tid|qid)/i, // "100mg for 4 days"
          /^\(day\s*\d+.*day\s*\d+\)/i,       // "(Day 2 - Day 5)"
          /^(?:for|after|before|with).*(?:day|meal|food)/i, // "for 4 days", "after meals"
          /^\d+[-+x]\d+[-+x]\d+/,             // "1-0-1", "1+1+1"
          /\d+[-+x]\d+[-+x]\d+\s*(?:bf|af)/i, // "1-0-0 BF", "0-0-1 AF"
          /^song\s*$/i,                       // OCR error: "song" is misread "50mg" - capture it
          /^iv\s*od/i,                        // "IV OD" route + frequency
          /x\s*\d+\s*(?:wks?|weeks?|days?|months?|mos?)/i, // "x 2 wks", "x 5 days", "300mg IV x 2 wks"
          /^\d+\s*[×x]\s*$/i,                 // "7×" or "7x" (duration multiplier on separate line)
          /^\(\s*(?:month|week|day)/i,        // "(month)" or "(month." on separate line
          /\b(?:iv|im|sc|oral)\b/i,           // Route of administration
          /\b(?:od|bd|tds|qid|bf|af)\b/i,     // Frequency and food relation
        ];
      
      for (const nextLine of nextLines) {
        const trimmed = nextLine.trim();
        
        // Skip empty lines
        if (!trimmed || trimmed.length === 0) continue;
        
        // Stop if we hit another medicine or header
        // Also stop at "T.", "C.", "S.", "I." patterns
        if (/(?:^|\s)[TCSI]\.|(?:Tab|Cap|Syr|Inj|Luj|Auj|Adv|Dr\.|Patient|Name|Hospital)\./i.test(trimmed)) {
          break;
        }
        
        // Check if this line contains dosage info
        const isDosage = dosePatterns.some(pattern => pattern.test(trimmed));
        if (isDosage) {
          dosageLines.push(trimmed);
        } else if (dosageLines.length > 0) {
          // Stop after collecting some dosage lines and hitting a non-dosage line
          break;
        }
      }
      
      // Append dosage lines to existing description (don't replace it!)
      if (dosageLines.length > 0) {
        const additionalInfo = dosageLines.join(' ');
        description = description ? `${description} ${additionalInfo}` : additionalInfo;
      }
    }
    
    medicines.push({
      name: fullName,
      dose: doseInfo,
      description: description,
    });
  }
  
  // Fallback: If no matches, try simple pattern at start (including OCR errors)
  if (medicines.length === 0) {
    const simplePattern = /^([TCSI]|mj|MJ|Luj|Auj|Adv|luj|auj|adv)\.?\s*([A-Z][A-Z]+)/i;
    const simpleMatch = line.match(simplePattern);
    if (simpleMatch) {
      const prefix = simpleMatch[1];
      const name = simpleMatch[2];
      
      // Normalize prefix
      let normalizedPrefix = 'Tab';
      const upperPrefix = prefix.toUpperCase();
      if (upperPrefix === 'T') {
        normalizedPrefix = 'Tab';
      } else if (upperPrefix === 'C') {
        normalizedPrefix = 'Cap';
      } else if (upperPrefix === 'S') {
        normalizedPrefix = 'Syr';
      } else if (upperPrefix === 'I' || upperPrefix === 'MJ' || /LUJ|AUJ|ADV/i.test(upperPrefix)) {
        normalizedPrefix = 'Inj';
      }
      
      const restOfLine = line.substring(simpleMatch[0].length).trim();
      
      let doseMatch = null;
      let charsToSkipFallback = 0;
      
      // First check if this starts with a timing pattern (don't extract as dose)
      const timingPatternFallback = restOfLine.match(/^(\d+[-+]\d+[-+]\d+)/);
      if (timingPatternFallback) {
        // Don't extract as dose - leave doseMatch as null
      } else {
        // Try to extract dose with units
        doseMatch = restOfLine.match(/^(\d{1,4})\s*(MG|ML|GM|MCG|G)\b/i);
        
        if (!doseMatch) {
          // Try dose without units, but validate it's realistic
          const potentialMatch = restOfLine.match(/^(\d{1,4})\b/);
          if (potentialMatch) {
            const potentialDose = parseInt(potentialMatch[1]);
            const originalMatch = potentialMatch[0];
            
            if (potentialDose >= 1 && potentialDose <= 4 || potentialDose % 5 === 0 || potentialDose % 10 === 0) {
              doseMatch = potentialMatch;
              charsToSkipFallback = originalMatch.length;
            } else if (potentialDose > 100) {
              const withoutLastDigit = Math.floor(potentialDose / 10);
              if (withoutLastDigit >= 5 && (withoutLastDigit % 5 === 0 || withoutLastDigit % 10 === 0)) {
                doseMatch = [withoutLastDigit.toString(), withoutLastDigit.toString()];
                charsToSkipFallback = originalMatch.length;
              }
            }
          }
        } else {
          charsToSkipFallback = doseMatch[0].length;
        }
      }
      
      // Check PREVIOUS line for duration markers like "7×"
      let durationPrefix = '';
      if (currentIndex > 0) {
        const prevLine = allLines[currentIndex - 1].trim();
        const durationMarkerMatch = prevLine.match(/^(\d+)\s*[×x]\s*$/i);
        if (durationMarkerMatch) {
          durationPrefix = durationMarkerMatch[1] + 'x ';
        }
      }
      
      // Start description with the rest of the current line
      let description = restOfLine;
      if (charsToSkipFallback > 0) {
        description = restOfLine.substring(charsToSkipFallback).trim();
      }
      
      // Prepend duration marker if found
      if (durationPrefix) {
        description = durationPrefix + description;
      }
      
      // Check next lines for additional dosage information
      if (allLines && allLines.length > currentIndex + 1) {
        const nextLines = allLines.slice(currentIndex + 1, currentIndex + 6);
        const dosageLines = [];
        
        const dosePatterns = [
          /^\d+\s*(?:mg|ml|gm|g)/i,
          /^followed by/i,
          /^\d+\s*(?:mg|ml|gm).*(?:day|daily|bd|od|tid|qid)/i,
          /^\(day\s*\d+.*day\s*\d+\)/i,
          /^(?:for|after|before|with).*(?:day|meal|food)/i,
          /^\d+[-+x]\d+[-+x]\d+/,
          /\d+[-+x]\d+[-+x]\d+\s*(?:bf|af)/i,
          /^song\s*$/i,
          /^iv\s*od/i,
          /x\s*\d+\s*(?:wks?|weeks?|days?|months?|mos?)/i,
          /^\d+\s*[×x]\s*$/i,
          /^\(\s*(?:month|week|day)/i,
          /\b(?:iv|im|sc|oral)\b/i,
          /\b(?:od|bd|tds|qid|bf|af)\b/i,
        ];
        
        for (const nextLine of nextLines) {
          const trimmed = nextLine.trim();
          
          // Skip empty lines
          if (!trimmed || trimmed.length === 0) continue;
          
          // Stop if we hit another medicine or header
          // Include "T.", "C.", "S.", "I." patterns
          if (/(?:^|\s)[TCSI]\.|(?:Tab|Cap|Syr|Inj|Luj|Auj|Adv|Dr\.|Patient|Name|Hospital)\./i.test(trimmed)) {
            break;
          }
          
          // Check if this line contains dosage info
          const isDosage = dosePatterns.some(pattern => pattern.test(trimmed));
          if (isDosage) {
            dosageLines.push(trimmed);
          } else if (dosageLines.length > 0) {
            // Stop after collecting some dosage lines and hitting a non-dosage line
            break;
          }
        }
        
        // Append dosage lines to existing description
        if (dosageLines.length > 0) {
          const additionalInfo = dosageLines.join(' ');
          description = description ? `${description} ${additionalInfo}` : additionalInfo;
        }
      }
      
      medicines.push({
        name: `${normalizedPrefix}. ${name}`,
        dose: doseMatch ? doseMatch[1] : '',
        description: description,
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
