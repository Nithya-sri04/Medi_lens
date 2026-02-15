/**
 * Generic/Branded Medicine Detection Service
 * Identifies whether a medicine is generic or branded
 */

import { supabase } from '../../config/supabase.js';
import { searchMedicinePrices } from '../../repositories/medicine.repository.js';

/**
 * Detects if a medicine name appears to be branded (contains brand indicators)
 */
const isBrandName = (medicineName) => {
  if (!medicineName) return false;

  const brandIndicators = [
    /^[A-Z][a-z]+[A-Z]/,  // CamelCase like Crocin, Dolo
    /[A-Z]{2,}/,           // Multiple caps like PCM, BD
  ];

  // Check if medicine name matches brand patterns
  for (const pattern of brandIndicators) {
    if (pattern.test(medicineName)) {
      return true;
    }
  }

  return false;
};

/**
 * Detects generic/branded status for a medicine
 * @param {Object} medicine - Medicine object from database
 * @returns {Object} { type: 'generic'|'branded', genericName: string, brandName: string }
 */
export const detectGenericBrand = (medicine) => {
  if (!medicine) {
    return {
      type: 'unknown',
      genericName: null,
      brandName: null
    };
  }

  // If database has brand_type field, use it
  if (medicine.brand_type) {
    const type = medicine.brand_type.toLowerCase();
    return {
      type: type === 'branded' ? 'branded' : 'generic',
      genericName: medicine.generic_name || medicine.medicine_name,
      brandName: type === 'branded' ? medicine.medicine_name : null
    };
  }

  // Fallback: Use generic_name field if available
  if (medicine.generic_name && medicine.generic_name !== medicine.medicine_name) {
    return {
      type: 'branded',
      genericName: medicine.generic_name,
      brandName: medicine.medicine_name
    };
  }

  // Fallback: Pattern-based detection (less reliable)
  const isBrand = isBrandName(medicine.medicine_name);
  
  return {
    type: isBrand ? 'branded' : 'generic',
    genericName: medicine.generic_name || medicine.medicine_name,
    brandName: isBrand ? medicine.medicine_name : null
  };
};

/**
 * Gets market alternatives for a medicine (cheaper options with same composition)
 * Enhanced to search by both name and composition for better accuracy
 * @param {Object} medicine - Medicine object from database
 * @param {Array} allMedicines - Array of all medicines (deprecated, not used)
 * @returns {Array} Array of alternative medicines with prices
 */
export const getMarketAlternatives = async (medicine, allMedicines) => {
  const alternatives = [];
  const medicineName = medicine.name || medicine.medicine_name;
  const targetComposition = medicine.composition || 
                              (medicine.extended && medicine.extended.contains) ||
                              null;

  // Need at least name or composition to search
  if (!medicineName && !targetComposition) {
    return alternatives;
  }

  try {
    // Use the enhanced searchMedicinePrices function
    const prices = await searchMedicinePrices(medicineName, targetComposition);

    if (!prices || prices.length === 0) {
      return alternatives;
    }

    // Get current medicine price if available
    const currentPrice = medicine.price || 
                        (medicine.prices && medicine.prices.length > 0 ? medicine.prices[0].price : null);

    // Filter and format alternatives
    const seenNames = new Set();
    
    for (const price of prices) {
      // Skip if same as current medicine name (exact match)
      const priceName = (price.name || '').toLowerCase();
      const medName = (medicineName || '').toLowerCase();
      
      if (priceName === medName) {
        continue; // Skip exact matches
      }

      // Skip if already added (avoid duplicates)
      if (seenNames.has(priceName)) {
        continue;
      }

      // Extract composition for display
      const composition = price.short_composition1 || price.short_composition2 || '';

      alternatives.push({
        name: price.name,
        price: price.price,
        manufacturer: price.manufacturer_name || price.manufacture_name,
        packSize: price.pack_size_label,
        type: price.type,
        composition: composition,
        genericName: composition, // Use composition as generic identifier
        isCheaper: currentPrice != null && price.price != null ? price.price < currentPrice : null
      });

      seenNames.add(priceName);
    }

    // Sort by price ascending and limit to top 10
    alternatives.sort((a, b) => (a.price || 0) - (b.price || 0));
    
    return alternatives.slice(0, 10);
  } catch (error) {
    console.error('Database error in getMarketAlternatives:', error);
    return alternatives;
  }
};

