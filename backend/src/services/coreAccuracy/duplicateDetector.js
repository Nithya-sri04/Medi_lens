/**
 * Duplicate Medicine Detection Service
 * Detects medicines with the same composition/active ingredients
 */

/**
 * Normalizes composition string for comparison
 */
const normalizeComposition = (composition) => {
  if (!composition) return null;
  return composition
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9]/g, '');
};

/**
 * Compares two compositions and returns similarity score (0-1)
 */
const compareCompositions = (comp1, comp2) => {
  if (!comp1 || !comp2) return 0;
  
  const norm1 = normalizeComposition(comp1);
  const norm2 = normalizeComposition(comp2);
  
  if (norm1 === norm2) return 1;
  
  // Check if one contains the other (partial match)
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    return 0.8;
  }
  
  // Split by common separators and compare ingredients
  const ingredients1 = comp1.toLowerCase().split(/[,\s;]+/).filter(i => i.trim());
  const ingredients2 = comp2.toLowerCase().split(/[,\s;]+/).filter(i => i.trim());
  
  if (ingredients1.length === 0 || ingredients2.length === 0) return 0;
  
  // Calculate overlap
  const set1 = new Set(ingredients1.map(i => i.trim().toLowerCase()));
  const set2 = new Set(ingredients2.map(i => i.trim().toLowerCase()));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
};

/**
 * Detects duplicate medicines based on composition
 * @param {Array} medicines - Array of medicine objects with composition field
 * @returns {Array} Array of duplicate groups
 */
export const detectDuplicates = (medicines) => {
  if (!medicines || medicines.length < 2) {
    return [];
  }

  const duplicates = [];
  const processed = new Set();

  for (let i = 0; i < medicines.length; i++) {
    if (processed.has(i)) continue;

    const med1 = medicines[i];
    const duplicateGroup = [i];

    // Skip if medicine doesn't have composition
    if (!med1.composition || !med1.composition.trim()) {
      continue;
    }

    for (let j = i + 1; j < medicines.length; j++) {
      if (processed.has(j)) continue;

      const med2 = medicines[j];

      // Skip if medicine doesn't have composition
      if (!med2.composition || !med2.composition.trim()) {
        continue;
      }

      const similarity = compareCompositions(med1.composition, med2.composition);

      // Consider duplicates if similarity > 0.7
      if (similarity > 0.7) {
        duplicateGroup.push(j);
        processed.add(j);
      }
    }

    if (duplicateGroup.length > 1) {
      duplicates.push({
        medicines: duplicateGroup.map(idx => ({
          index: idx,
          name: medicines[idx].name,
          composition: medicines[idx].composition
        })),
        similarity: compareCompositions(
          med1.composition,
          medicines[duplicateGroup[1]].composition
        )
      });
      processed.add(i);
    }
  }

  return duplicates;
};

