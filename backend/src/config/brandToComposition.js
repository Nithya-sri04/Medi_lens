/**
 * Brand → composition mapping for same-drug different-brand matching
 * (e.g. Limcee not in DB → search by "Vitamin C" → return Limcor).
 *
 * HOW TO ADD MORE:
 * 1. Edit brandToComposition.json in this folder.
 * 2. Keys = lowercase brand name as it appears on prescriptions (no dosage).
 * 3. Values = composition string to search in DB (must match short_composition1/2 in medicine_prices).
 *
 * Example: "dolo": "Paracetamol" means when user types "Dolo", we search by composition "Paracetamol"
 *          and return the first match from the database (e.g. Crocin, Paracip).
 *
 * Restart the backend after changing the JSON. No code change needed.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MAP = {
  limcee: 'Ascorbic Acid',
  limcor: 'Ascorbic Acid',
  celin: 'Ascorbic Acid',
  'ascorbic acid': 'Ascorbic Acid',
  'vitamin c': 'Ascorbic Acid'
};

/**
 * Load brand → composition from JSON file; fallback to default if file missing/invalid.
 * @returns {Record<string, string>} Keys: lowercase brand name, Values: composition to search
 */
export function loadBrandToComposition() {
  const jsonPath = join(__dirname, 'brandToComposition.json');
  if (!existsSync(jsonPath)) {
    return { ...DEFAULT_MAP };
  }
  try {
    const raw = readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      const out = {};
      for (const [key, value] of Object.entries(data)) {
        if (key && typeof key === 'string' && value && typeof value === 'string') {
          out[key.toLowerCase().trim()] = value.trim();
        }
      }
      return Object.keys(out).length ? out : { ...DEFAULT_MAP };
    }
  } catch (e) {
    console.warn('brandToComposition.json invalid or unreadable, using default map:', e.message);
  }
  return { ...DEFAULT_MAP };
}

/** Cached map (loaded once at startup). */
let cached = null;

export function getBrandToComposition() {
  if (cached === null) {
    cached = loadBrandToComposition();
    console.log(`✅ Loaded ${Object.keys(cached).length} brand-to-composition mappings`);
    // Show a few examples
    const examples = ['limcee', 'crocin', 'pan'].filter(k => cached[k]).map(k => `${k}→${cached[k]}`);
    if (examples.length > 0) {
      console.log(`   Examples: ${examples.join(', ')}`);
    }
  }
  return cached;
}
