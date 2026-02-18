/**
 * Multi-Phase Dosage Parser
 * Handles complex dosing schedules like:
 * - "200mg IV Day 1. Followed by 100mg IV for 4 days (Day 2-5)"
 * - "Loading dose 500mg, then 250mg BD for 5 days"
 */

/**
 * Parse multi-phase dosing instructions
 * @param {string} text - The instruction text
 * @returns {Object} { phases: Array, hasMultiplePhases: boolean }
 */
export const parseMultiPhaseDosage = (text) => {
  if (!text) {
    return { phases: [], hasMultiplePhases: false };
  }

  const phases = [];
  
  // Check for "followed by" pattern - indicates multiple phases
  const followedByPattern = /(.+?)(?:followed by|then)(.+)/i;
  const match = text.match(followedByPattern);

  if (match) {
    // We have multiple phases
    const phase1Text = match[1].trim();
    const phase2Text = match[2].trim();

    // Parse Phase 1
    const phase1 = parsePhase(phase1Text, 1);
    if (phase1) phases.push(phase1);

    // Parse Phase 2
    const phase2 = parsePhase(phase2Text, 2);
    if (phase2) phases.push(phase2);

    return { phases, hasMultiplePhases: true };
  }

  // Single phase - parse normally
  const singlePhase = parsePhase(text, 1);
  if (singlePhase) phases.push(singlePhase);

  return { phases, hasMultiplePhases: false };
};

/**
 * Parse a single phase of dosing
 * @param {string} text - Phase text
 * @param {number} phaseNumber - Phase number (1, 2, etc.)
 * @returns {Object|null} Phase object or null
 */
const parsePhase = (text, phaseNumber) => {
  if (!text) return null;

  const phase = {
    phaseNumber,
    dosage: null,
    dosageValue: null,
    dosageUnit: null,
    route: null,
    frequency: null,
    duration: null,
    durationDays: null,
    durationText: null,
    dayRange: null,
    timing: null,
    rawText: text
  };

  // Extract dosage (e.g., "200mg", "100 mg", "500mcg")
  const dosagePattern = /(\d+(?:\.\d+)?)\s*(mg|g|ml|mcg|iu|%)/i;
  const dosageMatch = text.match(dosagePattern);
  if (dosageMatch) {
    phase.dosage = dosageMatch[0]; // e.g., "200mg"
    phase.dosageValue = parseFloat(dosageMatch[1]); // e.g., 200
    phase.dosageUnit = dosageMatch[2].toLowerCase(); // e.g., "mg"
  }

  // Extract route (IV, IM, SC, Oral, etc.)
  const routePatterns = [
    { pattern: /\biv\b/i, name: 'Intravenous (IV)' },
    { pattern: /\bim\b/i, name: 'Intramuscular (IM)' },
    { pattern: /\bsc\b/i, name: 'Subcutaneous (SC)' },
    { pattern: /\boral\b/i, name: 'Oral' },
    { pattern: /\btopical\b/i, name: 'Topical' },
    { pattern: /\bintradermal\b/i, name: 'Intradermal' },
    { pattern: /\bsubcutaneous\b/i, name: 'Subcutaneous' },
    { pattern: /\bintravenous\b/i, name: 'Intravenous' },
    { pattern: /\bintramuscular\b/i, name: 'Intramuscular' }
  ];
  
  for (const route of routePatterns) {
    if (route.pattern.test(text)) {
      phase.route = route.name;
      break;
    }
  }

  // Extract frequency (OD, BD, TDS, QID)
  const frequencyPatterns = [
    { pattern: /\bod\b/i, name: 'Once daily' },
    { pattern: /\bbd\b/i, name: 'Twice daily' },
    { pattern: /\btds\b/i, name: 'Three times daily' },
    { pattern: /\bqid\b/i, name: 'Four times daily' },
    { pattern: /once\s+daily/i, name: 'Once daily' },
    { pattern: /twice\s+daily/i, name: 'Twice daily' }
  ];

  for (const freq of frequencyPatterns) {
    if (freq.pattern.test(text)) {
      phase.frequency = freq.name;
      break;
    }
  }

  // Extract day range (e.g., "Day 1", "Day 2-5", "Day 2 - Day 5")
  const dayRangePatterns = [
    /day\s*(\d+)\s*-?\s*(?:to)?\s*(?:day)?\s*(\d+)/i, // "Day 2-5" or "Day 2 - Day 5"
    /\(day\s*(\d+)\s*-\s*day\s*(\d+)\)/i, // "(Day 2 - Day 5)"
    /day\s*(\d+)/i // "Day 1"
  ];

  for (const pattern of dayRangePatterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[2]) {
        // Range (e.g., Day 2-5)
        phase.dayRange = `Day ${match[1]}-${match[2]}`;
        phase.durationDays = parseInt(match[2]) - parseInt(match[1]) + 1;
      } else {
        // Single day (e.g., Day 1)
        phase.dayRange = `Day ${match[1]}`;
        phase.durationDays = 1;
      }
      break;
    }
  }

  // Extract duration in weeks/months/days (if not already extracted from day range)
  if (!phase.durationDays) {
    const durationPatterns = [
      { pattern: /(?:for\s+)?(\d+)\s*(?:wks?|weeks?)/i, multiplier: 7 },
      { pattern: /(?:for\s+)?(\d+)\s*(?:months?|mos?)\b/i, multiplier: 30 },
      { pattern: /(?:for\s+)?(\d+)\s*days?/i, multiplier: 1 },
      { pattern: /x\s*(\d+)\s*(?:wks?|weeks?)/i, multiplier: 7 },
      { pattern: /x\s*(\d+)\s*days?/i, multiplier: 1 }
    ];

    for (const { pattern, multiplier } of durationPatterns) {
      const match = text.match(pattern);
      if (match) {
        phase.durationDays = parseInt(match[1]) * multiplier;
        if (multiplier === 7) {
          phase.durationText = `${match[1]} ${parseInt(match[1]) === 1 ? 'week' : 'weeks'}`;
        } else if (multiplier === 30) {
          phase.durationText = `${match[1]} ${parseInt(match[1]) === 1 ? 'month' : 'months'}`;
        } else {
          phase.durationText = `${match[1]} ${parseInt(match[1]) === 1 ? 'day' : 'days'}`;
        }
        break;
      }
    }
  } else if (!phase.durationText && phase.durationDays) {
    phase.durationText = `${phase.durationDays} ${phase.durationDays === 1 ? 'day' : 'days'}`;
  }

  // Generate human-readable timing
  if (phase.dayRange) {
    phase.timing = phase.dayRange;
  } else if (phase.durationText) {
    phase.timing = `For ${phase.durationText}`;
  }

  return phase;
};

/**
 * Format phases for display
 * @param {Array} phases - Array of phase objects
 * @returns {string} Formatted text
 */
export const formatMultiPhaseDosage = (phases) => {
  if (!phases || phases.length === 0) return '';

  return phases.map((phase, idx) => {
    const parts = [];
    
    if (phase.dosage) parts.push(phase.dosage);
    if (phase.route) parts.push(phase.route);
    if (phase.frequency) parts.push(phase.frequency);
    if (phase.timing) parts.push(phase.timing);
    
    const prefix = phases.length > 1 ? `Phase ${idx + 1}: ` : '';
    return prefix + parts.join(' • ');
  }).join('\n');
};

/**
 * Get total duration across all phases
 * @param {Array} phases - Array of phase objects
 * @returns {number} Total duration in days
 */
export const getTotalDuration = (phases) => {
  if (!phases || phases.length === 0) return 0;
  return phases.reduce((total, phase) => total + (phase.durationDays || 0), 0);
};
