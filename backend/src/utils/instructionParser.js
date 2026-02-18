export const parseInstructions = (text) => {
  // Apply OCR corrections before parsing
  text = text.replace(/\bRF\b/g, 'AF'); // OCR error: "AF" misread as "RF"
  
  console.log(`📋 parseInstructions called with: "${text}"`);
  
  const instructions = {
    timing: [],
    foodRelation: null,
    durationDays: null,
    durationText: null,
    frequencyText: null,
    frequency: null,
    isContinue: false,
    route: null  // Route of administration (IV, IM, SC, Oral, etc.)
  };

  // Map for Unicode circled digits to numbers
  const circledDigitMap = {
    '⓪': 0, '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
    '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
    '⓵': 21, '⓶': 22, '⓷': 23, '⓸': 24, '⓹': 25, '⓺': 26, '⓻': 27, '⓼': 28, '⓽': 29, '⓾': 30,
    '⓿': 0, '❶': 1, '❷': 2, '❸': 3, '❹': 4, '❺': 5, '❻': 6, '❼': 7, '❽': 8, '❾': 9, '❿': 10,
    '➀': 1, '➁': 2, '➂': 3, '➃': 4, '➄': 5, '➅': 6, '➆': 7, '➇': 8, '➈': 9, '➉': 10
  };

  // 1-0-1 / 1-1-1 pattern (Morning-Afternoon-Night); allow OCR l/o as 1/0
  // ALSO handle spaces around dashes: "1- 0 - 1" or "1 - 0 - 1"
  let normalizedForTiming = text.replace(/\b([lo])\s*-\s*([lo])\s*-\s*([lo])\b/gi, (_, a, b, c) => {
    const n = (x) => (String(x).toLowerCase() === 'l' ? '1' : '0');
    return `${n(a)}-${n(b)}-${n(c)}`;
  });
  const pattern101 = /(\d)\s*-\s*(\d)\s*-\s*(\d)/;  // Allow optional spaces around dashes
  const match = normalizedForTiming.match(pattern101);

  if (match) {
    const [fullMatch, morning, afternoon, night] = match;
    if (morning === "1") instructions.timing.push("Morning");
    if (afternoon === "1") instructions.timing.push("Afternoon");
    if (night === "1") instructions.timing.push("Night");
    instructions.frequencyText = fullMatch;
    
    // Calculate frequency from pattern
    const count = parseInt(morning) + parseInt(afternoon) + parseInt(night);
    if (count === 1) instructions.frequency = "Once daily";
    else if (count === 2) instructions.frequency = "Twice daily";
    else if (count === 3) instructions.frequency = "Three times daily";
  }

  // OD / BD / TDS / QID frequency patterns
  if (/od\b/i.test(text) && !instructions.frequency) {
    instructions.timing.push("Once daily");
    instructions.frequency = "Once daily";
    instructions.frequencyText = "OD";
  }
  if (/bd\b/i.test(text) && !instructions.frequency) {
    instructions.timing.push("Twice daily");
    instructions.frequency = "Twice daily";
    instructions.frequencyText = "BD";
  }
  if (/tds\b/i.test(text) && !instructions.frequency) {
    instructions.timing.push("Three times daily");
    instructions.frequency = "Three times daily";
    instructions.frequencyText = "TDS";
  }
  if (/qid\b/i.test(text) && !instructions.frequency) {
    instructions.timing.push("Four times daily");
    instructions.frequency = "Four times daily";
    instructions.frequencyText = "QID";
  }
  
  // PRN (as needed) - often used with pain medication
  if (/\bprn\b/i.test(text)) {
    instructions.frequency = "As needed (PRN)";
    instructions.frequencyText = (instructions.frequencyText || '') + " PRN";
  }
  
  // q4h, q6h, q8h patterns (every X hours)
  const qPatternMatch = text.match(/\bq(\d+)h?\b/i);
  if (qPatternMatch && !instructions.frequency) {
    const hours = qPatternMatch[1];
    instructions.frequency = `Every ${hours} hours`;
    instructions.frequencyText = `q${hours}h`;
  }

  // BF / AF (Before Food / After Food)
  if (/\b(bf|before\s+food)\b/i.test(text)) {
    instructions.foodRelation = "Before Food";
  }
  if (/\b(af|after\s+food|with\s+food)\b/i.test(text)) {
    instructions.foodRelation = "After Food";
  }

  // Route of Administration
  if (/\biv\b/i.test(text)) {
    instructions.route = "Intravenous (IV)";
  } else if (/\bim\b/i.test(text)) {
    instructions.route = "Intramuscular (IM)";
  } else if (/\bsc\b/i.test(text)) {
    instructions.route = "Subcutaneous (SC)";
  } else if (/\bintradermal\b/i.test(text)) {
    instructions.route = "Intradermal";
  } else if (/\btopical\b/i.test(text)) {
    instructions.route = "Topical";
  } else if (/\bpo\b/i.test(text) || /\boral\b/i.test(text)) {
    instructions.route = "Oral (PO)";
  } else if (/\brectal\b/i.test(text)) {
    instructions.route = "Rectal";
  } else if (/\bsublingual\b/i.test(text)) {
    instructions.route = "Sublingual";
  }

  // Duration: handle "X TO CONTINUE" first (include OCR typos: conhnue, continne)
  if (/\bx\s+to\s+(?:continue|conhnue|continne)\b/i.test(text)) {
    instructions.durationDays = null;
    instructions.isContinue = true;
    instructions.durationText = 'Continue as prescribed';
    instructions.frequencyText = (instructions.frequencyText || '') + ' (Continue)';
  } else {
  // Duration patterns: (5), 5 days, 2 wks, ×5, 5/, circled digits, etc.
  const durationPatterns = [
    // PRIORITY: "x5days", "x 5 days" - number comes AFTER x (must come BEFORE the "7× ... (month" patterns!)
    { pattern: /[×x]\s*(\d+)\s*(?:wks?|weeks?)/i, multiplier: 7 },  // X2WKS, X 2 WKS, X 2 WEEKS
    { pattern: /[×x]\s*(\d+)\s*(?:months?|mos?)\b/i, multiplier: 30 },  // X2MONTHS, X 2 MONTHS
    { pattern: /[×x]\s*(\d+)\s*days?/i, multiplier: 1 },  // X5DAYS, X5days, X 1 DAY, X 7 DAYS
    
    // Special pattern: "7x ... (month" - duration marker with unit later in text
    // Matches "7x 1-0-0 BF (month." or "7× (month." (with optional content in between)
    // These must come AFTER the "x5days" patterns to avoid false matches
    { pattern: /(\d+)\s*[×x].*?\(?\s*(?:months?|mos?)\.?/i, multiplier: 30 },  // 7× ... (month., 7x(month
    { pattern: /(\d+)\s*[×x].*?\(?\s*(?:wks?|weeks?)\.?/i, multiplier: 7 },  // 7× ... (week., 7x(week
    { pattern: /(\d+)\s*[×x].*?\(?\s*(?:days?)\.?/i, multiplier: 1 },  // 7× ... (day., 7x(day
    
    // Other weeks patterns
    { pattern: /for\s+(\d+)\s*(?:wks?|weeks?)/i, multiplier: 7 },  // for 2 weeks
    { pattern: /\((\d+)\s*(?:wks?|weeks?)\)/i, multiplier: 7 },  // (2 weeks)
    { pattern: /\b(\d+)\s*(?:wks?|weeks?)/i, multiplier: 7 },  // 2 weeks
    
    // Other months patterns
    { pattern: /for\s+(\d+)\s*(?:months?|mos?)\b/i, multiplier: 30 },  // for 2 months
    { pattern: /\b(\d+)\s*(?:months?|mos?)\b/i, multiplier: 30 },  // 2 months
    
    // Other days patterns
    { pattern: /\((\d+)\s*days?\)/i, multiplier: 1 },  // (5 days)
    { pattern: /for\s+(\d+)\s*days?/i, multiplier: 1 },  // for 5 days
    { pattern: /\b(\d+)\s*days?/i, multiplier: 1 },  // 5 days
    { pattern: /\bduration:?\s*(\d+)\s*days?/i, multiplier: 1 },  // duration: 5 days
    { pattern: /\bcourse:?\s*(\d+)\s*days?/i, multiplier: 1 },  // course: 5 days
    { pattern: /\b(\d+)\s*day\s*course/i, multiplier: 1 },  // 5 day course
    { pattern: /\bcourse\s*of\s*(\d+)\s*days?/i, multiplier: 1 },  // course of 5 days
    
    // Generic patterns (no units specified - assume days)
    { pattern: /\((\d+)\)/, multiplier: 1 },  // (5)
    { pattern: /×(\d+)/, multiplier: 1 },  // ×5
    { pattern: /(\d+)\//, multiplier: 1 },  // 5/
    { pattern: /\/(\d+)/, multiplier: 1 },  // /5
    { pattern: /\b(\d+)\s*x\s*(\d+)/i, multiplier: 1, useSecond: true },  // 1 x 5 (use second number)
  ];
  
  for (const { pattern, multiplier, useSecond } of durationPatterns) {
    const durationMatch = text.match(pattern);
    if (durationMatch) {
      console.log(`  ✓ Duration pattern matched: ${pattern} → matched="${durationMatch[0]}", groups=[${durationMatch.slice(1).join(',')}]`);
      let durationValue = useSecond ? durationMatch[2] : durationMatch[1];
      if (durationValue) {
        durationValue = Number(durationValue) * multiplier;
        console.log(`  → Calculated duration: ${durationValue} days (multiplier=${multiplier})`);
        if (durationValue > 0 && durationValue <= 365) {
          instructions.durationDays = durationValue;
          
          // Set human-readable duration text
          if (multiplier === 7) {
            const weeks = durationValue / 7;
            instructions.durationText = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
          } else if (multiplier === 30) {
            const months = durationValue / 30;
            instructions.durationText = `${months} ${months === 1 ? 'month' : 'months'}`;
          }
          
          break;
        }
      }
    }
  }
  }
  
  // Check for Unicode circled digits (only if not "to continue")
  if (!instructions.isContinue) {
  const circledDigits = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳', '⓵', '⓶', '⓷', '⓸', '⓹', '⓺', '⓻', '⓼', '⓽', '⓾', '⓿', '❶', '❷', '❸', '❹', '❺', '❻', '❼', '❽', '❾', '❿', '➀', '➁', '➂', '➃', '➄', '➅', '➆', '➇', '➈', '➉'];
  const digitValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (let i = 0; i < circledDigits.length; i++) {
    if (text.includes(circledDigits[i]) && digitValues[i] > 0 && digitValues[i] <= 365) {
      instructions.durationDays = digitValues[i];
      break;
    }
  }
  }
  
  // Standalone numbers as duration only if no duration and not "to continue"
  if (!instructions.durationDays && !instructions.isContinue) {
    console.log(`  → No duration found yet, trying standalone number fallback...`);
    const standaloneNumberMatch = text.match(/\b([1-9]|1[0-9]|2[0-9]|30)\b/g);
    if (standaloneNumberMatch) {
      console.log(`  → Found standalone numbers: [${standaloneNumberMatch.join(', ')}]`);
      // Take the last reasonable number as potential duration
      for (let i = standaloneNumberMatch.length - 1; i >= 0; i--) {
        const num = Number(standaloneNumberMatch[i]);
        if (num > 0 && num <= 30) {
          console.log(`  → Using standalone number: ${num} days`);
          instructions.durationDays = num;
          break;
        }
      }
    }
  }

  console.log(`📋 parseInstructions returning: durationDays=${instructions.durationDays}, frequency=${instructions.frequency}, timing=${instructions.timing.join(',')}`);
  
  return instructions;
};
