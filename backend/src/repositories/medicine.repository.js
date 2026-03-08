import { supabase } from '../config/supabase.js';
import levenshtein from 'fast-levenshtein';

// Cache for frequently accessed data
const medicineCache = new Map();
const interactionCache = new Map();

// Throttle "get all medicines" failure logs (avoids spam when Supabase is unreachable)
let lastGetAllMedicinesErrorLog = 0;
const GET_ALL_MEDICINES_ERROR_LOG_INTERVAL_MS = 60000; // 1 minute

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

  // Prefer matching dosage form: e.g. if prescription says "ointment", boost ointments and penalise tablets
  const preferredForm = (options.preferredForm || '').toLowerCase();
  if (preferredForm) {
    if (medName.includes(preferredForm)) {
      score += 300; // strong boost for matching form
    } else {
      // Penalise wrong form (e.g. tablet when ointment wanted)
      const forms = ['tablet', 'capsule', 'injection', 'syrup', 'ointment', 'cream', 'gel', 'drops', 'lotion', 'suspension', 'dry syrup'];
      const hasOtherForm = forms.some(f => f !== preferredForm && medName.includes(f));
      if (hasOtherForm) score -= 200;
    }
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
 * Get all medicines (for duplicate detection and OCR normalizer).
 * Logs connection errors at most once per minute to avoid console spam when Supabase is unreachable.
 */
export const getAllMedicines = async () => {
  try {
    const { data: medicines, error } = await supabase
      .from('medicines')
      .select('name, composition');

    if (error) {
      const now = Date.now();
      if (now - lastGetAllMedicinesErrorLog >= GET_ALL_MEDICINES_ERROR_LOG_INTERVAL_MS) {
        lastGetAllMedicinesErrorLog = now;
        console.error('Error getting all medicines:', error.message || error, '(check Supabase URL and network)');
      }
      return [];
    }

    return medicines || [];
  } catch (error) {
    const now = Date.now();
    if (now - lastGetAllMedicinesErrorLog >= GET_ALL_MEDICINES_ERROR_LOG_INTERVAL_MS) {
      lastGetAllMedicinesErrorLog = now;
      const msg = error?.message || String(error);
      console.error('Supabase unreachable (getAllMedicines):', msg.includes('ENOTFOUND') ? 'DNS/network or wrong SUPABASE_URL' : msg);
    }
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
 * Get full medicine object by medicine_id (same shape as findMedicine).
 * Used for composition-based lookup (e.g. same drug, different brand like Limcee/Limcor).
 */
export const getMedicineById = async (medicineId) => {
  if (!medicineId) return null;
  try {
    const [medicine, prices, foodInteractions] = await Promise.all([
      getMedicineDetailsExtendedByMedicineId(medicineId),
      getMedicinePricesByMedicineId(medicineId),
      getFoodInteractionsByMedicineId(medicineId)
    ]);
    if (!medicine) return null;
    return {
      ...medicine,
      id: medicineId,
      name: getMedName(medicine),
      prices: prices || [],
      extended: medicine,
      foodInteractions: foodInteractions || []
    };
  } catch (error) {
    console.error('Error in getMedicineById:', error);
    return null;
  }
};

/** Composition aliases: if DB has no results for primary name, try these (same drug, different label). */
const COMPOSITION_ALIASES = {
  'ascorbic acid': ['vitamin c'],
  'vitamin c': ['ascorbic acid'],
  'paracetamol': ['acetaminophen'],
  'acetaminophen': ['paracetamol']
};

/**
 * Extract dosage number from medicine name or composition
 * e.g., "Amphonex 50mg Injection" → 50, "Liposomal Amphotericin B (50mg)" → 50
 */
function extractDosageNumber(text) {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:mg|ml|gm|g|mcg|iu)/i);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Find ALL medicines with a specific composition and return alternatives
 * @param {string} composition - Composition to search (e.g., "Liposomal Amphotericin B")
 * @param {string} preferredForm - Preferred dosage form (e.g., "Injection")
 * @param {number} prescribedDosage - Prescribed dosage in mg (e.g., 300)
 * @returns {Promise<{primary: object, alternatives: array}>} Primary match and alternatives
 */
export const findMedicinesByComposition = async (composition, preferredForm = null, prescribedDosage = null, searchName = null) => {
  if (!composition || typeof composition !== 'string') return { primary: null, alternatives: [] };
  
  try {
    console.log(`🔍 findMedicinesByComposition: searching for "${composition}", form="${preferredForm}", dosage=${prescribedDosage}mg, searchName="${searchName || 'none'}"`);
    
    // OPTIMIZATION: If searchName is provided, try searching by name first
    // This ensures brand-specific medicines (e.g., "Chymoral Forte") are included even if they're expensive
    let prices = [];
    
    if (searchName) {
      const searchWords = searchName.split(/\s+/).filter(w => w.length >= 4);
      if (searchWords.length > 0) {
        const brandWord = searchWords[0]; // e.g., "chymoral" from "chymoral forte"
        console.log(`  → Pre-search by brand name: "${brandWord}"`);
        // Search by brand name ONLY (no composition filter at DB level)
        // This ensures we get all products with that brand name
        const brandPrices = await searchMedicinePrices(brandWord, null);
        if (brandPrices && brandPrices.length > 0) {
          console.log(`  → Found ${brandPrices.length} results for brand "${brandWord}"`);
          prices = brandPrices;
        }
      }
    }
    
    // If name search didn't find anything, search by composition only
    if (prices.length === 0) {
      prices = await searchMedicinePrices(null, composition.trim());
    }
    console.log(`  → Found ${prices?.length || 0} initial results`);

    // Try composition aliases if no results
    const compLower = composition.toLowerCase().trim();
    let searchTerm = compLower;
    if ((!prices || prices.length === 0) && COMPOSITION_ALIASES[compLower]) {
      for (const alias of COMPOSITION_ALIASES[compLower]) {
        console.log(`  → Trying alias "${alias}"`);
        prices = await searchMedicinePrices(null, alias);
        if (prices && prices.length > 0) {
          console.log(`  → Found ${prices.length} results for alias "${alias}"`);
          searchTerm = alias.toLowerCase().trim();
          break;
        }
      }
    }
    
    // If still no results, try searching for individual keywords
    // e.g., "Liposomal Amphotericin B" → try just "Amphotericin"
    // BUT: Remember the original composition for better filtering
    let originalComposition = compLower;
    if ((!prices || prices.length === 0) && compLower.includes(' ')) {
      const keywords = compLower.split(/\s+/).filter(w => w.length >= 5);
      for (const keyword of keywords) {
        console.log(`  → Trying keyword "${keyword}"`);
        prices = await searchMedicinePrices(null, keyword);
        if (prices && prices.length > 0) {
          console.log(`  → Found ${prices.length} results for keyword "${keyword}"`);
          searchTerm = keyword;
          break;
        }
      }
    }
    
    if (!prices || prices.length === 0) return { primary: null, alternatives: [] };

    // Filter to match composition
    // Use original composition for filtering if we fell back to keyword search
    const compWords = searchTerm.split(/\s+/);
    const originalWords = originalComposition.split(/\s+/).filter(w => w.length >= 3);
    
    const filtered = prices.filter(p => {
      const comp1 = (p.short_composition1 || '').toLowerCase();
      const comp2 = (p.short_composition2 || '').toLowerCase();
      
      // If we got results from brand search, be more lenient with composition matching
      // Just check if at least ONE key ingredient is present
      if (searchName && prices.length > 0 && prices.length <= 20) {
        // For brand searches with reasonable result counts, check if ANY word matches
        const anyWordIn1 = compWords.some(w => comp1.includes(w));
        const anyWordIn2 = compWords.some(w => comp2.includes(w));
        if (anyWordIn1 || anyWordIn2) return true;
      }
      
      if (comp1 === searchTerm || comp2 === searchTerm) return true;
      
      // If we fell back to keyword search (originalWords > 1 but compWords === 1),
      // prefer matches that contain ALL original words
      if (originalWords.length > 1 && compWords.length === 1) {
        const allOriginalIn1 = originalWords.every(w => comp1.includes(w));
        const allOriginalIn2 = originalWords.every(w => comp2.includes(w));
        if (allOriginalIn1 || allOriginalIn2) return true;
        
        // Fall back to single keyword match if no perfect match
        const word = compWords[0];
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(comp1) || regex.test(comp2);
      }
      
      if (compWords.length > 1) {
        const allWordsIn1 = compWords.every(w => comp1.includes(w));
        const allWordsIn2 = compWords.every(w => comp2.includes(w));
        if (allWordsIn1 || allWordsIn2) return true;
      }
      
      if (compWords.length === 1) {
        const word = compWords[0];
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(comp1) || regex.test(comp2)) return true;
      }
      
      return false;
    });

    console.log(`  → After filtering: ${filtered.length} results`);
    if (filtered.length === 0) return { primary: null, alternatives: [] };
    
    const formLower = preferredForm ? preferredForm.toLowerCase() : null;
    
    // Log sample of filtered results to see what we're working with
    console.log(`  → Sample filtered results: ${filtered.slice(0, 5).map(p => `"${p.name}" (id: ${p.medicine_id})`).join(', ')}`);

    // Fetch full medicine details for all matches
    const medicines = [];
    let skippedCount = 0;
    
    for (const priceRow of filtered) {
      const medicineId = priceRow.medicine_id;
      if (!medicineId) {
        skippedCount++;
        continue;
      }
      
      let medicine = await getMedicineById(medicineId);
      
      // If medicine details not found, create a basic medicine object from price data
      if (!medicine) {
        console.log(`  ⚠️ Medicine ID ${medicineId} not found in details table, using price data for "${priceRow.name}"`);
        medicine = {
          medicine_id: medicineId,
          name: priceRow.name,
          medicine_name: priceRow.name,
          composition: priceRow.short_composition1 || priceRow.short_composition2 || '',
          manufacturer: priceRow.manufacturer_name || '',
          type: priceRow.type || '',
          pack_size_label: priceRow.pack_size_label || '',
          is_discontinued: priceRow.is_discontinued || false,
          // Basic info - no detailed fields
          _isFromPriceData: true
        };
      } else if (formLower) {
        // When we requested a specific form (e.g. Injection) but DB returned a different form (e.g. Tablet),
        // prefer the price row name so we show the correct form (e.g. "Abhope 50mg Injection" not "ABHOPE 300MG TABLET")
        const medName = (medicine.name || medicine.medicine_name || '').toLowerCase();
        const formMismatch =
          (formLower === 'injection' && (medName.includes('tablet') || medName.includes('tab'))) ||
          (formLower === 'tablet' && (medName.includes('injection') || medName.includes('inj')));
        if (formMismatch && priceRow.name) {
          console.log(`  → Form mismatch: DB has "${medicine.name}", price row has "${priceRow.name}" — using price row name`);
          medicine = { ...medicine, name: priceRow.name, medicine_name: priceRow.name };
        }
      }
      
      // Add dosage info for ranking
      medicine._dosageNumber = extractDosageNumber(medicine.name) || 
                                extractDosageNumber(priceRow.short_composition1) ||
                                extractDosageNumber(priceRow.short_composition2);
      medicine._priceInfo = priceRow;
      medicines.push(medicine);
    }
    
    console.log(`  → Fetched ${medicines.length} medicine details (skipped ${skippedCount})`);
    if (medicines.length > 0) {
      console.log(`  → Medicine forms found: ${medicines.map(m => {
        const words = m.name.split(' ');
        return words[words.length - 1];
      }).join(', ')}`);
    }

    if (medicines.length === 0) return { primary: null, alternatives: [] };

    // STRICT FORM FILTERING: When form is specified (e.g., "Injection"), only return matching forms
    let filteredByForm = medicines;
    
    if (formLower) {
      console.log(`  → Filtering by form: "${preferredForm}"`);
      console.log(`  → Before filter: ${medicines.length} medicines (${medicines.map(m => m.name.split(' ').pop()).join(', ')})`);
      
      // Build list of acceptable form variations
      // e.g., "Injection" should match "Injection", "Inj", "Injectable"
      const formVariations = [formLower];
      if (formLower === 'injection') formVariations.push('inj', 'injectable');
      if (formLower === 'tablet') formVariations.push('tab', 'tabs');
      if (formLower === 'capsule') formVariations.push('cap', 'caps');
      if (formLower === 'syrup') formVariations.push('syp');
      if (formLower === 'ointment') formVariations.push('oint');
      
      const matchingForm = medicines.filter(med => {
        const nameLower = (med.name || '').toLowerCase();
        return formVariations.some(variant => nameLower.includes(variant));
      });
      
      if (matchingForm.length > 0) {
        // Use only matching forms if we found any
        filteredByForm = matchingForm;
        console.log(`  ✅ After filter: ${filteredByForm.length} medicines with form "${preferredForm}"`);
        console.log(`  → Filtered medicines: ${filteredByForm.slice(0, 3).map(m => m.name).join(', ')}`);
      } else {
        // No exact form match, log warning but keep all results
        console.log(`  ⚠️ No medicines found with form "${preferredForm}", showing all ${medicines.length} results`);
        console.log(`  → Available forms: ${medicines.map(m => m.name.split(' ').slice(-1)[0]).join(', ')}`);
      }
    }

    // Sort by: 1) name match, 2) dosage match, 3) price (form already filtered above)
    filteredByForm.sort((a, b) => {
      // Priority 1: Name match (exact or partial match with search name)
      if (searchName) {
        const searchLower = searchName.toLowerCase().trim();
        const searchWords = searchLower.split(/\s+/).filter(w => w.length >= 3);
        
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        
        // Calculate name match score
        const aExact = aName.includes(searchLower) ? 1000 : 0;
        const bExact = bName.includes(searchLower) ? 1000 : 0;
        
        const aWordMatches = searchWords.filter(w => aName.includes(w)).length;
        const bWordMatches = searchWords.filter(w => bName.includes(w)).length;
        
        const aScore = aExact + (aWordMatches * 100);
        const bScore = bExact + (bWordMatches * 100);
        
        if (aScore !== bScore) return bScore - aScore; // Higher score first
      }
      
      // Priority 2: Dosage match (closest to prescribed)
      if (prescribedDosage) {
        const aDosage = a._dosageNumber || 0;
        const bDosage = b._dosageNumber || 0;
        const aDiff = Math.abs(aDosage - prescribedDosage);
        const bDiff = Math.abs(bDosage - prescribedDosage);
        if (aDiff !== bDiff) return aDiff - bDiff;
      }

      // Priority 3: Price (lower is better)
      const aPrice = a._priceInfo?.price || Infinity;
      const bPrice = b._priceInfo?.price || Infinity;
      return aPrice - bPrice;
    });

    const primary = filteredByForm[0];
    const alternatives = filteredByForm.slice(1, 6); // Top 5 alternatives

    console.log(`  ✅ Primary: "${primary.name}" (form: ${preferredForm || 'any'}, ${primary._dosageNumber || '?'}mg, ₹${primary._priceInfo?.price || '?'})`);
    console.log(`  📋 Alternatives: ${alternatives.length}`);

    return { primary, alternatives };
  } catch (error) {
    console.error('Error in findMedicinesByComposition:', error);
    return { primary: null, alternatives: [] };
  }
};

/**
 * Find a medicine by composition (e.g. "Vitamin C", "Ascorbic Acid").
 * Prefers a specific dosage form when provided (e.g. "Tablet" when prefix is "t.").
 * Tries composition aliases if primary returns 0 results (e.g. DB may store "Vitamin C" not "Ascorbic Acid").
 */
export const findMedicineByComposition = async (composition, preferredForm = null) => {
  if (!composition || typeof composition !== 'string') return null;
  try {
    console.log(`🔍 findMedicineByComposition: searching for "${composition}", preferredForm="${preferredForm}"`);
    let prices = await searchMedicinePrices(null, composition.trim());
    console.log(`  → Found ${prices?.length || 0} initial results for "${composition}"`);

    // If no results, try aliases (e.g. DB stores "Vitamin C" but we searched "Ascorbic Acid")
    const compLower = composition.toLowerCase().trim();
    let searchTerm = compLower; // term we actually got results with (for filtering)
    if ((!prices || prices.length === 0) && COMPOSITION_ALIASES[compLower]) {
      for (const alias of COMPOSITION_ALIASES[compLower]) {
        console.log(`  → Trying alias "${alias}"`);
        prices = await searchMedicinePrices(null, alias);
        if (prices && prices.length > 0) {
          console.log(`  → Found ${prices.length} results for alias "${alias}"`);
          searchTerm = alias.toLowerCase().trim();
          break;
        }
      }
    }
    if (!prices || prices.length === 0) return null;

    // STRICT FILTERING: Only keep results where composition matches search term
    // This prevents "Vitamin C" from matching "Vitamin A" or multi-vitamin products
    const compWords = searchTerm.split(/\s+/);
    
    const filtered = prices.filter(p => {
      const comp1 = (p.short_composition1 || '').toLowerCase();
      const comp2 = (p.short_composition2 || '').toLowerCase();
      
      // Exact match (case-insensitive)
      if (comp1 === searchTerm || comp2 === searchTerm) return true;
      
      // For multi-word compositions (e.g. "Vitamin C"), check if ALL words appear
      // This handles "Ascorbic Acid (Vitamin C)" but rejects "Vitamin A"
      if (compWords.length > 1) {
        const allWordsIn1 = compWords.every(w => comp1.includes(w));
        const allWordsIn2 = compWords.every(w => comp2.includes(w));
        if (allWordsIn1 || allWordsIn2) return true;
      }
      
      // Single-word match: check if it appears as a standalone word (word boundary)
      if (compWords.length === 1) {
        const word = compWords[0];
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        if (regex.test(comp1) || regex.test(comp2)) return true;
      }
      
      return false;
    });

    console.log(`  → After strict filtering: ${filtered.length} results`);
    if (filtered.length > 0) {
      console.log(`  → Sample results: ${filtered.slice(0, 3).map(p => `"${p.name}" (${p.short_composition1})`).join(', ')}`);
    }
    if (filtered.length === 0) {
      console.log(`  ⚠️ No results after filtering. Original results had: ${prices.slice(0, 3).map(p => `"${p.name}" (comp1="${p.short_composition1}", comp2="${p.short_composition2}")`).join(', ')}`);
      return null;
    }

    // Prefer dosage form when specified (e.g. Tablet over Injection for "t.limcee")
    const formLower = preferredForm ? preferredForm.toLowerCase() : null;
    const orderToTry = formLower
      ? [...filtered].sort((a, b) => {
          const aHas = (a.name || '').toLowerCase().includes(formLower);
          const bHas = (b.name || '').toLowerCase().includes(formLower);
          if (aHas && !bHas) return -1;
          if (!aHas && bHas) return 1;
          return 0;
        })
      : filtered;

    // getMedicineById can return null if medicine_details_extended has no row for this medicine_id
    for (const priceRow of orderToTry) {
      const medicineId = priceRow.medicine_id;
      if (!medicineId) continue;
      const medicine = await getMedicineById(medicineId);
      if (medicine) {
        if (formLower && (medicine.name || '').toLowerCase().includes(formLower)) {
          console.log(`  ✅ Found medicine with preferred form "${preferredForm}": "${medicine.name}"`);
        }
        return medicine;
      }
    }
    console.log(`  ⚠️ getMedicineById returned null for all ${orderToTry.length} price rows`);
    return null;
  } catch (error) {
    console.error('Error in findMedicineByComposition:', error);
    return null;
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
    const queryLimit = (!medicineName && composition) ? 200 : 20;
    let query = supabase
      .from('medicine_prices')
      .select('*')
      .eq('is_discontinued', false)
      .order('price', { ascending: true })
      .limit(queryLimit);

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