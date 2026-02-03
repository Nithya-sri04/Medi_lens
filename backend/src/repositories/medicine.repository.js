import { supabase } from '../config/supabase.js';
import levenshtein from 'fast-levenshtein';

// Cache for frequently accessed data
const medicineCache = new Map();
const interactionCache = new Map();

/** Get display name from a row (supports both 'name' and 'medicine_name' columns) */
const getMedName = (row) => (row && (row.name || row.medicine_name)) || '';

/** Column to use for name search; set MEDICINE_NAME_COLUMN=medicine_name if your table uses that */
const NAME_COL = process.env.MEDICINE_NAME_COLUMN || 'name';

export const loadMedicineData = async () => {
  // Data is now in Supabase, no need to load CSVs
  console.log('✅ Database connection ready');
};

/**
 * Helper: Get medicine prices by medicine_id
 */
const getMedicinePricesByMedicineId = async (medicineId) => {
  if (!medicineId) return [];
  
  try {
    const { data, error } = await supabase
      .from('medicine_prices')
      .select('*')
      .eq('medicine_id', medicineId)
      .eq('is_discontinued', false)
      .order('price', { ascending: true })
      .limit(10);

    return error ? [] : (data || []);
  } catch (error) {
    console.error('Error getting prices by ID:', error);
    return [];
  }
};

/**
 * Helper: Get extended details by medicine_id
 */
const getMedicineDetailsExtendedByMedicineId = async (medicineId) => {
  if (!medicineId) return null;
  
  try {
    const { data, error } = await supabase
      .from('medicine_details_extended')
      .select('*')
      .eq('medicine_id', medicineId)
      .single();

    return error ? null : data;
  } catch (error) {
    if (error.code !== 'PGRST116') {
      console.error('Error getting extended details by ID:', error);
    }
    return null;
  }
};

/**
 * Helper: Get food interactions by medicine_id
 */
const getFoodInteractionsByMedicineId = async (medicineId) => {
  if (!medicineId) return [];
  
  try {
    const { data, error } = await supabase
      .from('food_interactions')
      .select('*')
      .eq('medicine_id', medicineId);

    if (error) return [];

    // Parse interactions JSONB field
    return (data || []).map(fi => ({
      ...fi,
      interactions: typeof fi.interactions === 'string' 
        ? JSON.parse(fi.interactions) 
        : fi.interactions
    }));
  } catch (error) {
    console.error('Error getting food interactions by ID:', error);
    return [];
  }
};

/**
 * Fuzzy search medicine in medicine_details_extended table using Levenshtein distance
 * @param {string} searchName - Normalized medicine name to search
 * @param {number} maxDistance - Maximum Levenshtein distance (default: 3)
 * @returns {Object|null} Best matching medicine or null
 */
const fuzzySearchMedicine = async (searchName, maxDistance = 3) => {
  if (!searchName) return null;

  try {
    // Get all medicines from medicine_details_extended (primary source)
    const { data: allMedicines, error } = await supabase
      .from('medicine_details_extended')
      .select('*')
      .limit(10000); // Limit to prevent memory issues, can be optimized later

    if (error || !allMedicines || allMedicines.length === 0) {
      return null;
    }

    const searchLower = searchName.toLowerCase().trim();
    let bestMatch = null;
    let bestDistance = Infinity;
    let bestSimilarity = 0;

    // Find best match using Levenshtein distance
    for (const med of allMedicines) {
      const medName = (med.name || '').toLowerCase().trim();
      if (!medName) continue;

      // Exact match
      if (medName === searchLower) {
        return med;
      }

      // Calculate Levenshtein distance
      const distance = levenshtein.get(searchLower, medName);
      const similarity = 1 - (distance / Math.max(searchLower.length, medName.length));

      // Check if this is a better match
      if (distance <= maxDistance && distance < bestDistance && similarity > 0.6) {
        bestDistance = distance;
        bestMatch = med;
        bestSimilarity = similarity;
      }

      // Also check if search name is contained in medicine name or vice versa
      if (medName.includes(searchLower) || searchLower.includes(medName)) {
        const containedDistance = Math.abs(medName.length - searchLower.length);
        if (containedDistance < bestDistance) {
          bestDistance = containedDistance;
          bestMatch = med;
          bestSimilarity = 0.85; // High similarity for contained matches
        }
      }
    }

    // Return match if similarity is good enough
    if (bestMatch && bestSimilarity > 0.6) {
      return bestMatch;
    }

    return null;
  } catch (error) {
    console.error('Error in fuzzy search:', error);
    return null;
  }
};

/** True when the search is for Co-Amoxiclav (amoxicillin + clavulanate). */
function isAmoxiclavSearch(options, nameLower) {
  const term = (options.originalSearchTerm || '').toLowerCase().trim();
  return term === 'amoxiclav' || nameLower === 'amoxicillin clavulanate';
}

/** When prescription says amoxiclav, reject plain Amoxicillin (no clavulanate). */
function rejectPlainAmoxicillinWhenAmoxiclavRequested(medicine, options, nameLower) {
  if (!medicine) return medicine;
  if (!isAmoxiclavSearch(options, nameLower)) return medicine;
  const medName = getMedName(medicine).toLowerCase();
  if (/amoxiclav|co-amoxiclav|amoxilclav|clavulanate/i.test(medName)) return medicine;
  return null; // prescription asked for amoxiclav; this is plain amoxicillin
}

/**
 * Score a DB row for ranking when multiple candidates exist.
 * Prefers: exact match > contains original term (e.g. amoxiclav) > dosage match > contains first word only.
 * When search is amoxiclav/amoxicillin clavulanate, prefer names containing amoxiclav, co-amoxiclav, amoxilclav.
 */
function rankMedicineRow(med, nameLower, options = {}) {
  const medName = getMedName(med).toLowerCase();
  const originalTerm = (options.originalSearchTerm || '').toLowerCase().trim();
  const dosageNum = options.prescriptionDosage != null
    ? parseInt(String(options.prescriptionDosage).replace(/\D/g, ''), 10)
    : null;
  const isAmoxiclavSearch =
    originalTerm === 'amoxiclav' ||
    nameLower.includes('amoxicillin clavulanate') ||
    nameLower === 'amoxicillin clavulanate';

  let score = 0;
  if (medName === nameLower) score += 1000;
  else if (medName.includes(nameLower) || nameLower.includes(medName)) score += 400;
  else if (medName.startsWith(nameLower) || nameLower.startsWith(medName.split(' ')[0])) score += 300;

  if (originalTerm && medName.includes(originalTerm)) score += 250;
  if (isAmoxiclavSearch && /amoxiclav|co-amoxiclav|amoxilclav|clavulanate/i.test(medName)) score += 200;
  if (isAmoxiclavSearch && /^amoxicillin\s/i.test(medName) && !/amoxiclav|clavulanate|amoxilclav/i.test(medName)) score -= 150;

  if (dosageNum && /\d+/.test(medName)) {
    const nameNums = medName.match(/\d+/g);
    if (nameNums && nameNums.some(n => parseInt(n, 10) === dosageNum)) score += 180;
  }
  const lev = levenshtein.get(nameLower, medName);
  score -= Math.min(lev * 2, 100);
  return score;
}

/**
 * Find medicine by name
 * @param {string} name - Medicine name to search
 * @param {Object} [options] - Optional: { prescriptionDosage: '625'|'625 mg', originalSearchTerm: 'amoxiclav' } for dosage-aware and term-aware ranking
 * @returns {Object|null} Complete medicine object or null
 */
export const findMedicine = async (name, options = {}) => {
  if (!name) return null;

  const cacheKey = name.toLowerCase() + '|' + (options.prescriptionDosage || '') + '|' + (options.originalSearchTerm || '');
  if (medicineCache.has(cacheKey)) {
    return medicineCache.get(cacheKey);
  }

  try {
    let medicine = null;
    let medicineId = null;

    // Strategy 1: Search in medicine_details_extended first (PRIMARY SOURCE)
    // Uses NAME_COL (default 'name'); falls back to 'medicine_name' if no results (see below)
    const nameLower = name.toLowerCase().trim();
    let { data: exactMatch, error: exactError } = await supabase
      .from('medicine_details_extended')
      .select('*')
      .ilike(NAME_COL, name)
      .limit(1)
      .single();

    if (!exactError && exactMatch) {
      medicine = exactMatch;
      medicineId = medicine.medicine_id;
    } else {
      // Try partial match if exact match not found
      let { data: extended, error: extError } = await supabase
        .from('medicine_details_extended')
        .select('*')
        .ilike(NAME_COL, `%${name}%`)
        .limit(10);

      // If no match, try dosage-normalized name (e.g. "625 mg" -> "625mg") since DB may store "Amoxiclav 625mg"
      let nameDosageNorm = name ? name.replace(/(\d+)\s+(mg|g|ml|mcg|iu|%)/gi, '$1$2') : '';
      if ((extError || !extended || extended.length === 0) && nameDosageNorm !== name) {
        const { data: ext2, error: err2 } = await supabase
          .from('medicine_details_extended')
          .select('*')
          .ilike(NAME_COL, `%${nameDosageNorm}%`)
          .limit(10);
        if (!err2 && ext2 && ext2.length > 0) {
          extError = null;
          extended = ext2;
        }
      }
      // If still no match and search is multi-word (e.g. "amoxicillin clavulanate"), try first word so "Amoxicillin and Clavulanic Acid" matches
      const firstWord = name && name.includes(' ') ? name.trim().split(/\s+/)[0] : '';
      if ((extError || !extended || extended.length === 0) && firstWord.length >= 3) {
        const { data: extFirst, error: errFirst } = await supabase
          .from('medicine_details_extended')
          .select('*')
          .ilike(NAME_COL, `%${firstWord}%`)
          .limit(10);
        if (!errFirst && extFirst && extFirst.length > 0) {
          extError = null;
          extended = extFirst;
        }
      }

      if (!extError && extended && extended.length > 0) {
        // When prescription says amoxiclav, only consider products that contain clavulanate (Co-Amoxiclav)
        if (isAmoxiclavSearch(options, nameLower)) {
          extended = extended.filter(m => /amoxiclav|co-amoxiclav|amoxilclav|clavulanate/i.test(getMedName(m)));
        }
        if (extended.length > 0) {
          extended = extended.sort((a, b) => {
            const scoreA = rankMedicineRow(a, nameLower, options);
            const scoreB = rankMedicineRow(b, nameLower, options);
            return scoreB - scoreA;
          });
          medicine = extended[0];
          medicineId = medicine.medicine_id;
        }
      }
    }

    // Strategy 1b: If no match and we used default column, try 'medicine_name' (some DBs use that column)
    const altNameCol = 'medicine_name';
    if (!medicine && NAME_COL === 'name') {
      const { data: exactAlt, error: exactAltErr } = await supabase
        .from('medicine_details_extended')
        .select('*')
        .ilike(altNameCol, name)
        .limit(1)
        .single();
      if (!exactAltErr && exactAlt) {
        medicine = exactAlt;
        medicineId = medicine.medicine_id;
      } else {
        let { data: extAlt, error: extAltErr } = await supabase
          .from('medicine_details_extended')
          .select('*')
          .ilike(altNameCol, `%${name}%`)
          .limit(10);
        const nameDosageNorm = name ? name.replace(/(\d+)\s+(mg|g|ml|mcg|iu|%)/gi, '$1$2') : '';
        if ((extAltErr || !extAlt || extAlt.length === 0) && nameDosageNorm !== name) {
          const { data: extAlt2, error: errAlt2 } = await supabase
            .from('medicine_details_extended')
            .select('*')
            .ilike(altNameCol, `%${nameDosageNorm}%`)
            .limit(10);
          if (!errAlt2 && extAlt2 && extAlt2.length > 0) {
            extAltErr = null;
            extAlt = extAlt2;
          }
        }
        if (!extAltErr && extAlt && extAlt.length > 0) {
          if (isAmoxiclavSearch(options, nameLower)) {
            extAlt = extAlt.filter(m => /amoxiclav|co-amoxiclav|amoxilclav|clavulanate/i.test(getMedName(m)));
          }
          if (extAlt.length > 0) {
            extAlt = extAlt.sort((a, b) => {
              const scoreA = rankMedicineRow(a, nameLower, options);
              const scoreB = rankMedicineRow(b, nameLower, options);
              return scoreB - scoreA;
            });
            medicine = extAlt[0];
            medicineId = medicine.medicine_id;
          }
        }
      }
    }

    // Strategy 2: Try fuzzy search if exact match not found
    if (!medicine) {
      const fuzzyMatch = await fuzzySearchMedicine(name, 3);
      if (fuzzyMatch) {
        medicine = rejectPlainAmoxicillinWhenAmoxiclavRequested(fuzzyMatch, options, nameLower);
        if (medicine) medicineId = medicine.medicine_id;
      }
    }

    // Strategy 3: Check synonyms table if still not found
    if (!medicine) {
      const { data: synonym } = await supabase
        .from('medicine_synonyms')
        .select('standard_name, medicine_id')
        .ilike('synonym', name)
        .single();

      if (synonym) {
        medicineId = synonym.medicine_id;
        // Try to get from medicine_details_extended by medicine_id
        const { data: extendedBySynonym } = await supabase
          .from('medicine_details_extended')
          .select('*')
          .eq('medicine_id', medicineId)
          .single();

        if (extendedBySynonym) {
          medicine = extendedBySynonym;
        } else {
          // Fallback to medicines table
          const { data: medicineBySynonym } = await supabase
            .from('medicines')
            .select('*')
            .eq('id', medicineId)
            .single();

          if (medicineBySynonym) {
            medicine = medicineBySynonym;
          }
        }
      }
    }

    // Strategy 4: Fallback to medicines table (last resort)
    if (!medicine) {
      let { data: med, error } = await supabase
        .from('medicines')
        .select('*')
        .ilike(NAME_COL, `%${name}%`)
        .limit(1)
        .single();
      if (error && NAME_COL === 'name') {
        const res = await supabase.from('medicines').select('*').ilike('medicine_name', `%${name}%`).limit(1).single();
        med = res.data;
        error = res.error;
      }
      if (!error && med) {
        medicine = med;
        medicineId = medicine.id;
      }
    }

    // When prescription says amoxiclav, never return plain Amoxicillin (no clavulanate)
    medicine = rejectPlainAmoxicillinWhenAmoxiclavRequested(medicine, options, nameLower);

    if (medicine) {
      // Fetch all related data in parallel
      const [prices, extendedDetails, foodInteractions] = await Promise.all([
        medicineId ? getMedicinePricesByMedicineId(medicineId) : [],
        medicineId ? getMedicineDetailsExtendedByMedicineId(medicineId) : (medicine.name ? null : medicine),
        medicineId ? getFoodInteractionsByMedicineId(medicineId) : []
      ]);

      // Combine all data into complete medicine object
      const completeMedicine = {
        ...medicine,
        id: medicineId || medicine.id,
        name: getMedName(medicine),
        prices: prices || [],
        extended: extendedDetails || (medicine.name ? medicine : null),
        foodInteractions: foodInteractions || []
      };

      medicineCache.set(cacheKey, completeMedicine);
      return completeMedicine;
    }

    return null;
  } catch (error) {
    console.error('Database error:', error);
    return null;
  }
};

/**
 * Find interaction between two medicines
 */
export const findInteraction = async (med1, med2) => {
  if (!med1 || !med2) return null;

  const key = [med1.toLowerCase(), med2.toLowerCase()].sort().join('-');
  if (interactionCache.has(key)) {
    return interactionCache.get(key);
  }

  try {
    // Search by medicine names (both directions)
    const { data: interaction, error } = await supabase
      .from('medicine_interactions')
      .select('*')
      .or(`and(medicine1_name.ilike.%${med1}%,medicine2_name.ilike.%${med2}%),and(medicine1_name.ilike.%${med2}%,medicine2_name.ilike.%${med1}%)`)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error finding interaction:', error);
      return null;
    }

    if (interaction) {
      interactionCache.set(key, interaction);
      return interaction;
    }

    // Try searching by IDs if we have medicine objects
    // This would require passing medicine objects instead of names
    // For now, we'll stick with name-based search

    return null;
  } catch (error) {
    console.error('Database error:', error);
    return null;
  }
};

/**
 * Get all medicines (for duplicate detection)
 */
export const getAllMedicines = async () => {
  try {
    const { data: medicines, error } = await supabase
      .from('medicines')
      .select('name, composition');

    if (error) {
      console.error('Error getting all medicines:', error);
      return [];
    }

    return medicines || [];
  } catch (error) {
    console.error('Database error:', error);
    return [];
  }
};

/**
 * Get medicine prices and alternatives
 * @param {string|number} medicineIdentifier - Medicine name or medicine_id
 * @param {boolean} isId - Whether the identifier is an ID (true) or name (false)
 */
export const getMedicinePrices = async (medicineIdentifier, isId = false) => {
  try {
    let query = supabase
      .from('medicine_prices')
      .select('*')
      .eq('is_discontinued', false)
      .order('price', { ascending: true })
      .limit(10);

    if (isId) {
      query = query.eq('medicine_id', medicineIdentifier);
    } else {
      query = query.ilike('name', `%${medicineIdentifier}%`);
    }

    const { data: prices, error } = await query;

    if (error) {
      console.error('Error getting prices:', error);
      return [];
    }

    return prices || [];
  } catch (error) {
    console.error('Database error:', error);
    return [];
  }
};

/**
 * Get food interactions for a medicine
 * @param {string|number} medicineIdentifier - Medicine name or medicine_id
 * @param {boolean} isId - Whether the identifier is an ID (true) or name (false)
 */
export const getFoodInteractions = async (medicineIdentifier, isId = false) => {
  try {
    let query = supabase
      .from('food_interactions')
      .select('*');

    if (isId) {
      query = query.eq('medicine_id', medicineIdentifier);
    } else {
      // Search by medicine_name field (not food field!)
      query = query.ilike('medicine_name', `%${medicineIdentifier}%`);
    }

    const { data: interactions, error } = await query;

    if (error) {
      console.error('Error getting food interactions:', error);
      return [];
    }

    // Parse interactions JSONB field
    return (interactions || []).map(fi => ({
      ...fi,
      interactions: typeof fi.interactions === 'string' 
        ? JSON.parse(fi.interactions) 
        : fi.interactions
    }));
  } catch (error) {
    console.error('Database error:', error);
    return [];
  }
};

/**
 * Search medicine prices by name and/or composition
 * Used for finding alternative medicines with lower prices
 * @param {string} medicineName - Medicine name to search
 * @param {string} composition - Optional composition to search by
 * @returns {Array} Array of price records sorted by price ascending
 */
export const searchMedicinePrices = async (medicineName, composition = null) => {
  try {
    let query = supabase
      .from('medicine_prices')
      .select('*')
      .eq('is_discontinued', false)
      .order('price', { ascending: true })
      .limit(20);

    // Build search conditions
    const conditions = [];
    
    if (medicineName) {
      // Search by name (fuzzy match using ilike)
      conditions.push(`name.ilike.%${medicineName}%`);
    }

    if (composition) {
      // Search by composition in both short_composition fields
      conditions.push(`short_composition1.ilike.%${composition}%`);
      conditions.push(`short_composition2.ilike.%${composition}%`);
    }

    if (conditions.length > 0) {
      query = query.or(conditions.join(','));
    } else {
      return [];
    }

    const { data: prices, error } = await query;

    if (error) {
      console.error('Error searching medicine prices:', error);
      return [];
    }

    // If we have both name and composition, prioritize exact matches
    if (medicineName && composition && prices && prices.length > 0) {
      const nameLower = medicineName.toLowerCase();
      const compLower = composition.toLowerCase();
      
      prices.sort((a, b) => {
        const aNameMatch = (a.name || '').toLowerCase().includes(nameLower);
        const bNameMatch = (b.name || '').toLowerCase().includes(nameLower);
        const aCompMatch = (a.short_composition1 || '').toLowerCase().includes(compLower) ||
                          (a.short_composition2 || '').toLowerCase().includes(compLower);
        const bCompMatch = (b.short_composition1 || '').toLowerCase().includes(compLower) ||
                          (b.short_composition2 || '').toLowerCase().includes(compLower);
        
        // Prioritize: name + composition match > name match > composition match > price
        if (aNameMatch && aCompMatch && !(bNameMatch && bCompMatch)) return -1;
        if (bNameMatch && bCompMatch && !(aNameMatch && aCompMatch)) return 1;
        if (aNameMatch && !bNameMatch) return -1;
        if (bNameMatch && !aNameMatch) return 1;
        if (aCompMatch && !bCompMatch) return -1;
        if (bCompMatch && !aCompMatch) return 1;
        return a.price - b.price;
      });
    }

    return prices || [];
  } catch (error) {
    console.error('Database error in searchMedicinePrices:', error);
    return [];
  }
};

/**
 * Get medicine details with all related data
 * This function is now redundant since findMedicine returns complete data
 * But kept for backward compatibility
 */
export const getMedicineDetails = async (medicineName) => {
  // findMedicine already returns complete data with prices, extended, foodInteractions
  const medicine = await findMedicine(medicineName);
  if (!medicine) return null;

  // If medicine doesn't have related data, fetch it
  if (!medicine.prices || !medicine.extended || !medicine.foodInteractions) {
    const medicineId = medicine.id;
    
    const [prices, extended, foodInteractions] = await Promise.all([
      medicineId ? getMedicinePricesByMedicineId(medicineId) : getMedicinePrices(medicineName),
      medicineId ? getMedicineDetailsExtendedByMedicineId(medicineId) : null,
      medicineId ? getFoodInteractionsByMedicineId(medicineId) : getFoodInteractions(medicineName)
    ]);

    return {
      ...medicine,
      prices: prices || [],
      extended: extended || null,
      foodInteractions: foodInteractions || []
    };
  }

  return medicine;
};