import axios from "axios";
import FormData from "form-data";
import { normalizeOCRText, getTextSuggestions } from "../utils/enhancedOCRNormalizer.js";
import { extractPrescriptionWithVeryfi, isVeryfiConfigured } from "../utils/veryfiOcrClient.js";

const DONUT_OCR_URL = process.env.DONUT_OCR_URL || "";

/**
 * Normalize and correct OCR text.
 * Flow: existing JS normalizer (fixes + medicine DB suggestions)
 * POST /api/prescription/ocr/normalize (or /api/ocr/normalize depending on mount)
 * Body: { text: string }
 */
export const normalizeOCR = async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "TEXT_REQUIRED" });
  }

  try {
    const result = await normalizeOCRText(text);
    const normalizedText = result.normalizedText || text;

    return res.json({
      normalizedText,
      corrections: result.corrections || [],
      originalText: result.originalText || text
    });
  } catch (error) {
    console.error("OCR Normalization Error:", error);
    return res.status(500).json({
      error: "NORMALIZATION_FAILED",
      message: error.message
    });
  }
};

/**
 * Extract text from prescription image using Donut OCR (if DONUT_OCR_URL is set).
 * POST /api/prescription/ocr/extract
 * Body: multipart/form-data with field "image" (file).
 * Returns { text, source: "donut" } or 503 if service unavailable (frontend can fallback to Tesseract).
 */
export const extractOCR = async (req, res) => {
  if (!DONUT_OCR_URL) {
    return res.status(503).json({
      error: "SERVICE_UNAVAILABLE",
      message: "Donut OCR service not configured (DONUT_OCR_URL)",
    });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: "IMAGE_REQUIRED" });
  }

  try {
    const form = new FormData();
    form.append("image", req.file.buffer, {
      filename: req.file.originalname || "image.png",
      contentType: req.file.mimetype || "image/png",
    });
    const response = await axios.post(
      DONUT_OCR_URL.replace(/\/$/, "") + "/ocr/extract",
      form,
      {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60000,
        validateStatus: (status) => status === 200,
      }
    );
    const text = response.data?.text ?? "";
    return res.json({ text, source: "donut" });
  } catch (err) {
    if (err.response?.status) {
      return res.status(502).json({
        error: "DONUT_OCR_ERROR",
        message: err.response.data?.error || err.message,
      });
    }
    return res.status(503).json({
      error: "SERVICE_UNAVAILABLE",
      message: err.message || "Donut OCR service unreachable",
    });
  }
};

/**
 * Extract text from prescription image using Veryfi API
 * POST /api/prescription/ocr/veryfi
 * Body: multipart/form-data with field "image" (file)
 * Returns: { text, source: "veryfi" } or 503 if not configured
 */
export const extractWithVeryfi = async (req, res) => {
  console.log("🔵 Veryfi endpoint called");
  console.log("   Configured:", isVeryfiConfigured());
  
  if (!isVeryfiConfigured()) {
    console.log("❌ Veryfi NOT configured");
    return res.status(503).json({
      error: "SERVICE_UNAVAILABLE",
      message: "Veryfi API not configured (check VERYFI_* env vars)",
    });
  }

  if (!req.file || !req.file.buffer) {
    console.log("❌ No image file in request");
    return res.status(400).json({ error: "IMAGE_REQUIRED" });
  }

  console.log("📤 Sending to Veryfi API...");
  console.log("   File:", req.file.originalname, `(${req.file.size} bytes)`);
  
  try {
    const result = await extractPrescriptionWithVeryfi(
      req.file.buffer,
      req.file.originalname || "prescription.jpg"
    );
    
    console.log("✅ Veryfi SUCCESS!");
    console.log("   Extracted text length:", result.text.length);
    console.log("   First 100 chars:", result.text.substring(0, 100));
    console.log("   Medicines found:", result.medicines?.length || 0);
    
    return res.json({ 
      text: result.text,
      medicines: result.medicines, // Structured medicine list
      source: "veryfi",
      confidence: 0.9
    });
  } catch (error) {
    console.error("❌ Veryfi extraction error:", error.response?.data || error.message);
    return res.status(502).json({
      error: "VERYFI_ERROR",
      message: error.message,
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

