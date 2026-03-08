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

    const prompt = `You are a medical explanation assistant. You will receive JSON data about medicines extracted from a prescription and their details from our database. Your task is to explain the usage of each medicine in simple, proper English that is easy for patients to understand. Do not add any information not present in the provided data. Do not suggest or create medicines. Only explain based on the given data.

Input: A JSON array of medicine objects with the following structure:
{
  "name": "Medicine name",
  "dosage": "Dosage amount (may be empty)",
  "frequency": "How many times per day (may be empty)",
  "timing": "When to take (e.g., 'Morning, Afternoon, Night') (may be empty)",
  "food_relation": "Before or After Food (may be empty)",
  "duration": "Duration in days or 'Continue as prescribed' (may be empty)",
  "composition": "Active ingredients (may be empty)",
  "generic_name": "Generic name (may be empty)",
  "brand_type": "Generic or Branded (may be empty)",
  "purpose": "Medicine purpose (may be empty)",
  "food_habits": "Food-related recommendations (may be empty)",
  "verified": "Whether verified in database (boolean)"
}

For each medicine, provide a simple explanation in 1-2 sentences in clear, proper English. Include only: name, dosage, frequency/timing, duration (if available), and purpose if helpful. Do NOT include any warning or side-effect text in the explanation. Format your response as a JSON array of strings.

Example input: [{"name": "Paracetamol", "dosage": "500mg", "frequency": "3", "timing": "Morning, Afternoon, Night", "food_relation": "Before Food", "duration": "5 days", "composition": "Paracetamol 500mg", "purpose": "Pain relief", "verified": true}]

Example output: ["Take 500mg of Paracetamol 3 times a day in the morning, afternoon, and night, before food, for 5 days. It is used for pain relief."]

Keep explanations concise, patient-friendly, in proper English. Do not mention side effects or warnings. If duration is 'Continue as prescribed', say to take it as prescribed or until the doctor advises otherwise.`;

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

      let rawResponse = response.choices[0].message.content.trim();
      // Groq sometimes returns trailing text after the JSON array; extract just the array
      const firstBracket = rawResponse.indexOf('[');
      if (firstBracket >= 0) {
        const lastBracket = rawResponse.lastIndexOf(']');
        if (lastBracket > firstBracket) {
          rawResponse = rawResponse.slice(firstBracket, lastBracket + 1);
        }
      }
      console.log('Groq API raw response:', rawResponse);
      let explanations;
      try {
        explanations = JSON.parse(rawResponse);
        if (!Array.isArray(explanations)) {
          explanations = [String(explanations)];
        }
      } catch (parseError) {
        console.error('Failed to parse LLM response:', parseError);
        // Fallback: treat single-line response as one explanation
        if (rawResponse.length > 0 && rawResponse.length < 500) {
          explanations = [rawResponse.replace(/^["']|["']$/g, '')];
        } else {
          throw new Error('Failed to parse explanations');
        }
      }
      console.log('Parsed explanations:', explanations);
      // Normalize to string[] (LLM may return objects like { explanation: "..." })
      return explanations.map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') return String(item.explanation || item.text || item.content || '').trim();
        return '';
      });
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

  /**
   * Returns true if the warning text is only generic advice (e.g. "Most side effects... Consult your doctor" with no serious content).
   * Such warnings are skipped and not shown.
   */
  _isGenericWarning(text) {
    if (!text || text.length < 20) return true;
    const lower = text.toLowerCase();
    const hasGenericPhrase =
      /most side effects do not require|consult your doctor if (they )?persist|disappear as your body adjusts/.test(lower);
    const hasSeriousContent =
      /allergic|allergy|seek (immediate|emergency)|stop taking|hospital|bleeding|severe|swelling (of|in) (face|throat|tongue)|difficulty (breathing|swallowing)|rash|hives|anaphylaxis|blood in|black stools|yellow (skin|eyes)|liver|kidney (failure|problem)/i.test(lower);
    return hasGenericPhrase && !hasSeriousContent;
  }

  /**
   * Summarize raw warning/side_effects text into 2-3 short, patient-relevant bullet points per medicine.
   * Skips generic-only warnings (returns empty). Returns array of strings (one per medicine).
   */
  async summarizeWarnings(medicinesData) {
    if (!medicinesData?.length) return medicinesData.map(() => '');
    const warnings = medicinesData.map(m => (m.warning || m.side_effects || '').trim());
    const skipGeneric = warnings.map(w => !w || this._isGenericWarning(w));
    const toSummarize = warnings.map((w, i) => (skipGeneric[i] ? '' : w));
    const allSkipped = toSummarize.every(t => !t);
    if (allSkipped) return medicinesData.map(() => '');

    if (!openai) return medicinesData.map(() => '');

    const prompt = `You are a medical information assistant. You will receive a JSON array of raw "warning" or "side effects" text for medicines (one per medicine; some may be empty). For each non-empty item, return 2-3 short bullet points containing only important, patient-relevant information (e.g. when to see a doctor, serious side effects, what to avoid). Omit generic advice like "Consult your doctor if they persist" and long lists of mild effects. If the content is only general advice with no specific serious information, return an empty string for that item. For empty input items, return an empty string.

Return a JSON array of strings with the same length as the input: one string per item. Each string can contain 2-3 bullet points separated by newlines, or be empty. No other text.`;

    try {
      const inputJson = JSON.stringify(toSummarize);
      const response = await openai.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: inputJson }
        ],
        max_tokens: 800,
        temperature: 0.1,
      });
      const raw = response.choices[0].message.content.trim();
      let parsed = [];
      try {
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length !== medicinesData.length) {
          parsed = medicinesData.map(() => '');
        }
      } catch {
        parsed = medicinesData.map(() => '');
      }
    return skipGeneric.map((skip, i) => (skip ? '' : (parsed[i] != null ? String(parsed[i]).trim() : '')));
    } catch (err) {
      console.error('LLM summarizeWarnings failed:', err);
      return medicinesData.map(() => '');
    }
  }

  /**
   * Format raw DB safety text (pregnancy, liver) into short, clean lines without labels or medicine name.
   * Use when LLM is unavailable or returns empty. No new information added.
   */
  formatSafetyAdviceFromRaw(pregnancy, liver, medicineName = '') {
    const strip = (t) => {
      if (!t || typeof t !== 'string') return '';
      return t
        .replace(/,?\s*label:\s*[^\n]*/gi, '')
        .replace(/\blabel:\s*[^\n]*/gi, '')
        .replace(/\b(CONSULT YOUR DOCTOR|SAFE IF PRESCRIBED|CAUTION|NOT RECOMMENDED)\b[,.]?\s*/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    };
    const removeMedicineName = (s, name) => {
      if (!name || !s) return s;
      const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return s.replace(re, 'This medicine').trim();
    };
    const firstSentence = (s, maxLen = 80) => {
      if (!s) return '';
      s = s.replace(/Please consult your doctor\.?/gi, 'Ask your doctor.').trim();
      const dot = s.indexOf('.');
      if (dot > 0 && dot <= maxLen) return s.slice(0, dot + 1).trim();
      if (s.length > maxLen) return s.slice(0, maxLen).replace(/\s+\S*$/, '') + '.';
      return s;
    };
    const p = firstSentence(removeMedicineName(strip((pregnancy || '').trim()), medicineName));
    const l = firstSentence(removeMedicineName(strip((liver || '').trim()), medicineName));
    const lines = [];
    if (p) lines.push('Pregnancy: ' + p);
    if (l) lines.push('Liver: ' + l);
    return lines.length ? lines.join('\n') : '';
  }

  /**
   * Simplify database safety text (pregnancy, liver, warning) into 3-4 friendly lines.
   * Does NOT add any new information. Skips "information not available" content; never includes labels.
   */
  async simplifySafetyAdvice(safetyInputs) {
    if (!safetyInputs?.length) return [];

    // Remove all labels and metadata (CONSULT YOUR DOCTOR, SAFE IF PRESCRIBED, CAUTION, etc.)
    const stripLabels = (text) => {
      if (!text || typeof text !== 'string') return '';
      return text
        .replace(/,?\s*label:\s*[^\n.]*/gi, '')
        .replace(/\blabel:\s*[^\n]*/gi, '')
        .replace(/\b(CONSULT YOUR DOCTOR|SAFE IF PRESCRIBED|CAUTION|NOT RECOMMENDED)\b[,.]?\s*/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    };
    // True only when text is just "information not available" / "consult your doctor" with no real advice
    const isOnlyNoInfoOrConsult = (t) => {
      if (!t || t.length < 10) return true;
      const lower = t.toLowerCase();
      const hasNoInfoPhrase = /information (regarding|about).*(not available|is not available|unavailable)|data (is )?not available/i.test(lower);
      const rest = lower
        .replace(/information (regarding|about) the use of [^.]*\./gi, '')
        .replace(/please consult your doctor\.?/gi, '')
        .replace(/,?\s*label:\s*[^.\n]*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (hasNoInfoPhrase && rest.length < 30) return true;
      return false;
    };
    const toSent = (t) => {
      const s = stripLabels((t || '').trim());
      return isOnlyNoInfoOrConsult(s) ? '' : s;
    };

    const cleaned = safetyInputs.map(s => ({
      pregnancy: toSent(s.pregnancy),
      liver: toSent(s.liver),
      warning: toSent(s.warning)
    }));

    const hasAny = cleaned.map(c => c.pregnancy || c.liver || c.warning);
    if (hasAny.every(h => !h)) return safetyInputs.map(() => '');

    if (!openai) {
      return safetyInputs.map((_, i) => {
        const c = cleaned[i];
        const parts = [c.pregnancy, c.liver, c.warning].filter(Boolean);
        return parts.length ? parts.join(' ') : '';
      });
    }

    const prompt = `You are a medical information assistant. You receive a JSON array of safety-related text (pregnancy, liver, general advice) for medicines.

TASK: For each item, output 2–4 SHORT lines. Each line must be ONE of these labels followed by ONE short sentence:
- "Pregnancy:" (only if pregnancy info exists)
- "Liver:" (only if liver info exists)
- Do not repeat the same idea. Do not say "Ask your doctor" more than once per item. Do not mention the medicine name.
- Use simple, reassuring language. Empty input → empty string.

FORMAT RULES:
- One line per topic. Use a newline between lines (e.g. "Pregnancy: ...\\nLiver: ...").
- Each line = label + one short sentence (max 10–12 words per sentence).
- No labels/tags like "CONSULT YOUR DOCTOR" or "CAUTION" in the text.
- Do not repeat "Your doctor will weigh benefits and risks" if you already said "Ask your doctor."

GOOD (short, clear, no repetition):
"Pregnancy: May not be safe; limited data. Ask your doctor.
Liver: Use with caution; dose may need adjustment."

BAD (too long, repetitive):
"Pregnancy: May not be safe; limited studies. Ask your doctor. The developing baby may be harmed. Your doctor will weigh the benefits and risks."

Return ONLY a JSON array of strings. One string per input item. Same length as input. No other text.`;

    const inputJson = JSON.stringify(cleaned);

    try {
      const response = await openai.chat.completions.create({
        model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: inputJson }
        ],
        max_tokens: 600,
        temperature: 0.1
      });
      const raw = response.choices[0].message.content.trim();
      let parsed = [];
      try {
        parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length !== safetyInputs.length) {
          parsed = safetyInputs.map(() => '');
        }
      } catch {
        parsed = safetyInputs.map(() => '');
      }
      // Post-process: strip labels, redundant phrases, and normalize formatting
      const cleanOutput = (str) => {
        if (!str || typeof str !== 'string') return '';
        let out = str
          .replace(/,?\s*label:\s*[^\n]*/gi, '')
          .replace(/\blabel:\s*[^\n]*/gi, '')
          .replace(/\b(CONSULT YOUR DOCTOR|SAFE IF PRESCRIBED|CAUTION|NOT RECOMMENDED)\b[,.]?\s*/gi, '')
          .replace(/Information regarding[^.]*?\./gi, '')
          .replace(/[^.]*information (is )?not available[^.]*\.?/gi, '')
          .replace(/Please consult your doctor\.?/gi, 'Ask your doctor.')
          .replace(/\s{2,}/g, ' ')
          .trim();
        // Remove repetitive follow-up sentences (e.g. "Your doctor will weigh the benefits and risks" after "Ask your doctor")
        out = out.replace(/\.\s*Your doctor will weigh the benefits and risks\.?/gi, '.');
        out = out.replace(/\.\s*The developing baby may be harmed\.?\s*/gi, '. ');
        // Ensure one newline between Pregnancy/Liver lines, no run-on
        out = out.replace(/\s*\.\s*(Pregnancy:|Liver:)/gi, '\n$1').replace(/\n{2,}/g, '\n').trim();
        return out;
      };
      return safetyInputs.map((s, i) => {
        const raw = parsed[i];
        let str = '';
        if (typeof raw === 'string') str = raw;
        else if (raw && typeof raw === 'object') str = raw.text ?? raw.summary ?? raw.content ?? Object.values(raw).find(v => typeof v === 'string') ?? '';
        const out = cleanOutput(str);
        return out.trim();
      });
    } catch (err) {
      console.error('LLM simplifySafetyAdvice failed:', err);
      return safetyInputs.map(() => ''); // Controller will use formatSafetyAdviceFromRaw fallback
    }
  }
}

export default new LLMExplanationService();