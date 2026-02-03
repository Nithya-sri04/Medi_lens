import { normalizeOCRText, getTextSuggestions } from "../utils/enhancedOCRNormalizer.js";

/**
 * Normalize and correct OCR text
 * POST /api/ocr/normalize
 * Body: { text: string }
 */
export const normalizeOCR = async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "TEXT_REQUIRED" });
  }

  try {
    const result = await normalizeOCRText(text);
    return res.json(result);
  } catch (error) {
    console.error("OCR Normalization Error:", error);
    return res.status(500).json({ 
      error: "NORMALIZATION_FAILED",
      message: error.message 
    });
  }
};

/**
 * Get text suggestions for auto-complete/correction
 * POST /api/ocr/suggestions
 * Body: { text: string }
 */
export const getSuggestions = async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "TEXT_REQUIRED" });
  }

  try {
    const suggestions = await getTextSuggestions(text);
    return res.json({ suggestions });
  } catch (error) {
    console.error("Suggestions Error:", error);
    return res.status(500).json({ 
      error: "SUGGESTIONS_FAILED",
      message: error.message 
    });
  }
};

