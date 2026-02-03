export const parseInstructions = (text) => {
  const instructions = {
    timing: [],
    foodRelation: null,
    durationDays: null,
    durationText: null,
    frequencyText: null,
    frequency: null,
    isContinue: false
  };

  // Map for Unicode circled digits to numbers
  const circledDigitMap = {
    '⓪': 0, '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
    '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15, '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
    '⓵': 21, '⓶': 22, '⓷': 23, '⓸': 24, '⓹': 25, '⓺': 26, '⓻': 27, '⓼': 28, '⓽': 29, '⓾': 30,
    '⓿': 0, '❶': 1, '❷': 2, '❸': 3, '❹': 4, '❺': 5, '❻': 6, '❼': 7, '❽': 8, '❾': 9, '❿': 10,
    '➀': 1, '➁': 2, '➂': 3, '➃': 4, '➄': 5, '➅': 6, '➆': 7, '➇': 8, '➈': 9, '➉': 10
  };

  // 1-0-1 / 1-1-1 pattern (Morning-Afternoon-Night)
  const pattern101 = /(\d)-(\d)-(\d)/;
  const match = text.match(pattern101);

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

  // BF / AF (Before Food / After Food)
  if (/\b(bf|before\s+food)\b/i.test(text)) {
    instructions.foodRelation = "Before Food";
  }
  if (/\b(af|after\s+food|with\s+food)\b/i.test(text)) {
    instructions.foodRelation = "After Food";
  }

  // Duration: handle "X TO CONTINUE" first so it always wins (regular daily tablet, no fixed duration)
  if (/\bx\s+to\s+continue\b/i.test(text)) {
    instructions.durationDays = null;
    instructions.isContinue = true;
    instructions.durationText = 'Continue as prescribed';
    instructions.frequencyText = (instructions.frequencyText || '') + ' (Continue)';
  } else {
  // Duration patterns: (5), 5 days, ×5, 5/, circled digits, etc.
  const durationPatterns = [
    /x\s+(\d+)\s*days?/i,  // X 1 DAY, X 7 DAYS (case insensitive)
    /×\s*(\d+)\s*days?/i,  // × 5 days
    /\((\d+)\)/,  // (5)
    /\((\d+)\s*days?\)/i,  // (5 days)
    /for\s+(\d+)\s*days?/i,  // for 5 days
    /\b(\d+)\s*days?/i,  // 5 days
    /×(\d+)/,  // ×5
    /(\d+)\//,  // 5/
    /\/(\d+)/,  // /5
    /\b(\d+)\s*x\s*(\d+)/i,  // 1 x 5
    /\bduration:?\s*(\d+)\s*days?/i,  // duration: 5 days
    /\bcourse:?\s*(\d+)\s*days?/i,  // course: 5 days
    /\b(\d+)\s*day\s*course/i,  // 5 day course
    /\bcourse\s*of\s*(\d+)\s*days?/i  // course of 5 days
  ];
  
  for (const pattern of durationPatterns) {
    const durationMatch = text.match(pattern);
    if (durationMatch) {
      let durationValue = durationMatch[2] || durationMatch[1];
      if (durationValue) {
        durationValue = Number(durationValue);
        if (durationValue > 0 && durationValue <= 365) {
          instructions.durationDays = durationValue;
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
    const standaloneNumberMatch = text.match(/\b([1-9]|1[0-9]|2[0-9]|30)\b/g);
    if (standaloneNumberMatch) {
      // Take the last reasonable number as potential duration
      for (let i = standaloneNumberMatch.length - 1; i >= 0; i--) {
        const num = Number(standaloneNumberMatch[i]);
        if (num > 0 && num <= 30) {
          instructions.durationDays = num;
          break;
        }
      }
    }
  }

  return instructions;
};
