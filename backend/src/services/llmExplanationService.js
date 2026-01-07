import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = process.env.GROQ_API_KEY ? new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1',
}) : null;

class LLMExplanationService {
  async explainMedicines(medicinesData) {
    console.log('LLM Service called with data:', medicinesData);
    
    if (!openai) {
      console.log('No OpenAI client, using mock explanations');
      // Mock explanations for demo
    return medicinesData.map(med => {
      let explanation = `Take ${med.name}`;
      if (med.dosage) explanation += ` ${med.dosage}`;
      if (med.frequency) explanation += ` ${med.frequency}`;
      if (med.timing) explanation += ` in the ${med.timing}`;
      if (med.food_relation) explanation += ` ${med.food_relation.toLowerCase()}`;
      if (med.duration) explanation += ` for ${med.duration}`;
      if (med.composition) explanation += `. It contains ${med.composition}`;
      explanation += '.';
      return explanation;
    });

    }

    const prompt = `You are a medical explanation assistant. You will receive JSON data about medicines extracted from a prescription and their details from our database. Your task is to explain the usage of each medicine in simple, easy-to-understand words for the patient. Do not add any information not present in the provided data. Do not suggest or create medicines. Only explain based on the given data.

Input: A JSON array of medicine objects with the following structure:
{
  "name": "Medicine name",
  "dosage": "Dosage amount (may be empty)",
  "frequency": "How many times per day (may be empty)",
  "timing": "When to take (e.g., 'Morning, Afternoon, Night') (may be empty)",
  "food_relation": "Before or After Food (may be empty)",
  "duration": "Duration in days (may be empty)",
  "composition": "Active ingredients (may be empty)",
  "generic_name": "Generic name (may be empty)",
  "brand_type": "Generic or Branded (may be empty)",
  "purpose": "Medicine purpose (may be empty)",
  "food_habits": "Food-related recommendations (may be empty)",
  "verified": "Whether verified in database (boolean)"
}

For each medicine, provide a simple explanation in 1-2 sentences. Always include the key information: name, dosage, frequency/timing, and duration if available. Only include information that is present in the data. Format your response as a JSON array of strings.

Example input: [{"name": "Paracetamol", "dosage": "500mg", "frequency": "3", "timing": "Morning, Afternoon, Night", "food_relation": "Before Food", "duration": "5 days", "composition": "Paracetamol 500mg", "generic_name": "", "brand_type": "", "purpose": "", "food_habits": "", "verified": true}]

Example output: ["Take 500mg of Paracetamol 3 times a day in the morning, afternoon, and night, before food, for 5 days. It contains Paracetamol 500mg."]

Keep explanations concise, patient-friendly, and only use the provided data. If duration is specified, always include it in the explanation.`;

    const inputJson = JSON.stringify(medicinesData);

    try {
      console.log('Calling Groq API with input:', inputJson);
      const response = await openai.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: inputJson }
        ],
        max_tokens: 1000,
        temperature: 0.1, // Low temperature for consistency
      });

      const rawResponse = response.choices[0].message.content.trim();
      console.log('Groq API raw response:', rawResponse);
      let explanations;
      try {
        explanations = JSON.parse(rawResponse);
        if (!Array.isArray(explanations)) {
          console.error('LLM returned non-array response:', explanations);
          throw new Error('Invalid response format');
        }
      } catch (parseError) {
        console.error('Failed to parse LLM response:', parseError);
        throw new Error('Failed to parse explanations');
      }
      console.log('Parsed explanations:', explanations);
      return explanations;
    } catch (error) {
      console.error('Error calling Groq API:', error);
      throw new Error('Failed to generate explanations');
    }
  }

  /**
   * Enhance food habits recommendations using LLM
   * Takes existing food habits and medicine data, returns enhanced recommendations
   * @param {Object} medicineData - Medicine data object
   * @param {Array} existingFoodHabits - Existing food habits from database/rules
   * @returns {Array} Enhanced food habits array
   */
  async enhanceFoodHabits(medicineData, existingFoodHabits = []) {
    if (!openai) {
      console.log('No OpenAI client, returning existing food habits');
      return existingFoodHabits;
    }

    const prompt = `You are a medical nutrition advisor. Based on the medicine information provided, suggest practical food habits and dietary recommendations for the patient. Focus on:
1. Foods to avoid or be cautious with
2. Foods that may enhance medicine effectiveness
3. Timing of meals relative to medicine intake
4. General dietary advice while taking this medicine

Provide 3-5 concise, practical recommendations. Return ONLY a JSON array of strings, no additional text.

Medicine Information:
- Name: ${medicineData.name || 'Not specified'}
- Composition: ${medicineData.composition || 'Not specified'}
- Generic Name: ${medicineData.genericName || 'Not specified'}
- Purpose: ${medicineData.purpose || 'Not specified'}
- Existing Recommendations: ${existingFoodHabits.length > 0 ? existingFoodHabits.join('; ') : 'None'}

Format your response as a JSON array of strings, e.g., ["Avoid alcohol while taking this medicine", "Take with food to reduce stomach upset"]`;

    try {
      const response = await openai.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are a helpful medical nutrition advisor. Provide practical, safe dietary recommendations.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.3, // Slightly higher for more natural recommendations
      });

      const rawResponse = response.choices[0].message.content.trim();
      console.log('LLM Food Habits raw response:', rawResponse);
      
      let enhancedHabits = [];
      try {
        // Try to parse as JSON array
        enhancedHabits = JSON.parse(rawResponse);
        if (!Array.isArray(enhancedHabits)) {
          throw new Error('Invalid response format');
        }
      } catch (parseError) {
        console.warn('Failed to parse LLM food habits response, trying to extract from text:', parseError);
        // Fallback: try to extract list items from text
        const lines = rawResponse.split('\n').filter(line => line.trim().length > 0);
        enhancedHabits = lines
          .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
          .filter(line => line.length > 10 && line.length < 200)
          .slice(0, 5);
      }

      // Combine existing and enhanced habits, remove duplicates
      const allHabits = [...existingFoodHabits, ...enhancedHabits];
      const uniqueHabits = Array.from(new Set(allHabits.map(h => h.toLowerCase())))
        .map(lower => allHabits.find(h => h.toLowerCase() === lower))
        .filter(Boolean);

      return uniqueHabits.slice(0, 8); // Limit to 8 total recommendations
    } catch (error) {
      console.error('Error calling LLM for food habits enhancement:', error);
      // Return existing habits if LLM fails
      return existingFoodHabits;
    }
  }
}

export default new LLMExplanationService();