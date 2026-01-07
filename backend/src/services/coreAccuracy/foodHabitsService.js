/**
 * Food Habits Service
 * Provides food-related recommendations and warnings for medicines
 * Enhanced with LLM for personalized recommendations
 */

import { supabase } from '../../config/supabase.js';
import llmExplanationService from '../llmExplanationService.js';

/**
 * Gets food habits recommendations for a medicine
 * @param {Object} medicine - Medicine object from database
 * @returns {Array} Array of food habit recommendations
 */
export const getFoodHabits = async (medicine) => {
  if (!medicine) {
    return [];
  }

  const foodHabits = [];

  // If database has food_habits field, parse and return it
  if (medicine.food_habits) {
    const habits = medicine.food_habits
      .split(/[;\n]/)
      .map(h => h.trim())
      .filter(h => h.length > 0);

    foodHabits.push(...habits);
  }

  // Get food interactions from database
  try {
    const medicineName = medicine.name || medicine.medicine_name;
    if (medicineName) {
      // Search by medicine_name field (not food field)
      const { data: interactions, error } = await supabase
        .from('food_interactions')
        .select('*')
        .ilike('medicine_name', `%${medicineName}%`);

      if (!error && interactions && interactions.length > 0) {
        interactions.forEach(interaction => {
          if (interaction.interactions) {
            try {
              const parsed = typeof interaction.interactions === 'string' 
                ? JSON.parse(interaction.interactions) 
                : interaction.interactions;
              
              if (Array.isArray(parsed)) {
                foodHabits.push(...parsed);
              } else if (typeof parsed === 'string') {
                foodHabits.push(parsed);
              }
            } catch (parseError) {
              console.warn('Error parsing food interaction:', parseError);
            }
          }
        });
      }
    }
  } catch (error) {
    console.error('Error getting food interactions:', error);
  }

  // Rule-based food habit recommendations based on medicine type/name
  // This can be enhanced with a separate food_habits.csv file or database table

  const medicineNameLower = medicine.name?.toLowerCase() || medicine.medicine_name?.toLowerCase() || '';
  const genericNameLower = medicine.generic_name?.toLowerCase() || '';

  // Antibiotics - general recommendations
  if (medicineNameLower.includes('amoxicillin') ||
      medicineNameLower.includes('azithromycin') ||
      medicineNameLower.includes('ciprofloxacin')) {
    if (!foodHabits.some(h => h.toLowerCase().includes('alcohol'))) {
      foodHabits.push('Avoid alcohol while taking this medicine');
    }
    if (!foodHabits.some(h => h.toLowerCase().includes('dairy'))) {
      foodHabits.push('Avoid taking with dairy products (space 2-3 hours apart)');
    }
  }

  // Pain relievers (NSAIDs)
  if (medicineNameLower.includes('ibuprofen') || 
      medicineNameLower.includes('aspirin') ||
      medicineNameLower.includes('naproxen')) {
    if (!foodHabits.some(h => h.toLowerCase().includes('food'))) {
      foodHabits.push('Take with food or milk to reduce stomach upset');
    }
  }

  // Iron supplements
  if (medicineNameLower.includes('iron') || 
      medicineNameLower.includes('ferrous')) {
    if (!foodHabits.some(h => h.toLowerCase().includes('vitamin c'))) {
      foodHabits.push('Take with vitamin C or citrus fruits to enhance absorption');
    }
    if (!foodHabits.some(h => h.toLowerCase().includes('dairy'))) {
      foodHabits.push('Avoid taking with dairy products or calcium supplements');
    }
  }

  // Calcium channel blockers
  if (medicineNameLower.includes('calcium') && 
      medicineNameLower.includes('channel')) {
    if (!foodHabits.some(h => h.toLowerCase().includes('grapefruit'))) {
      foodHabits.push('Avoid grapefruit and grapefruit juice');
    }
  }

  // Enhance with LLM if available
  try {
    const medicineData = {
      name: medicine.name || medicine.medicine_name,
      composition: medicine.composition,
      genericName: medicine.generic_name,
      purpose: medicine.purpose || medicine.uses || (medicine.extended && medicine.extended.uses)
    };

    // Call LLM to enhance food habits
    const enhancedHabits = await llmExplanationService.enhanceFoodHabits(medicineData, foodHabits);
    return enhancedHabits;
  } catch (error) {
    console.error('Error enhancing food habits with LLM:', error);
    // Return rule-based habits if LLM fails
    return foodHabits;
  }
};

/**
 * Gets food interaction warnings (alerts about dangerous food combinations)
 * @param {Object} medicine - Medicine object from database
 * @returns {Array} Array of food interaction warnings
 */
export const getFoodInteractionWarnings = (medicine) => {
  if (!medicine) {
    return [];
  }

  const warnings = [];
  const medicineNameLower = medicine.medicine_name?.toLowerCase() || '';

  // Warfarin - vitamin K interactions
  if (medicineNameLower.includes('warfarin')) {
    warnings.push({
      type: 'warning',
      severity: 'high',
      message: 'Maintain consistent vitamin K intake (avoid sudden changes in leafy green vegetables)'
    });
  }

  // MAO inhibitors - tyramine
  if (medicineNameLower.includes('mao') || 
      medicineNameLower.includes('phenelzine') ||
      medicineNameLower.includes('tranylcypromine')) {
    warnings.push({
      type: 'warning',
      severity: 'high',
      message: 'Avoid aged cheeses, cured meats, and foods high in tyramine'
    });
  }

  return warnings;
};

