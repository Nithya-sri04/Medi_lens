/**
 * Veryfi Medical Prescription OCR Client
 * Uses Veryfi API for high-accuracy prescription OCR
 */
import axios from 'axios';
import crypto from 'crypto';
import { parseMedicinesFromText, formatMedicinesAsText } from './prescriptionParser.js';
import { applyPrescriptionOCRFixes } from './prescriptionOCRFixes.js';

// Load env vars
import dotenv from 'dotenv';
dotenv.config();

const VERYFI_CLIENT_ID = process.env.VERYFI_CLIENT_ID || '';
const VERYFI_CLIENT_SECRET = process.env.VERYFI_CLIENT_SECRET || '';
const VERYFI_USERNAME = process.env.VERYFI_USERNAME || '';
const VERYFI_API_KEY = process.env.VERYFI_API_KEY || '';
const VERYFI_BASE_URL = 'https://api.veryfi.com/api/v8';

console.log('🔧 Veryfi config loaded:', {
  hasClientId: !!VERYFI_CLIENT_ID,
  hasClientSecret: !!VERYFI_CLIENT_SECRET,
  hasUsername: !!VERYFI_USERNAME,
  hasApiKey: !!VERYFI_API_KEY,
});

/**
 * Generate Veryfi signature for authentication
 */
function generateSignature(timestamp, payload) {
  const message = `timestamp:${timestamp}`;
  return crypto
    .createHmac('sha256', VERYFI_CLIENT_SECRET)
    .update(message)
    .digest('hex');
}

/**
 * Extract text from prescription image using Veryfi
 * @param {Buffer} imageBuffer - Image file buffer
 * @param {string} filename - Original filename
 * @returns {Promise<string>} - Extracted text
 */
export async function extractPrescriptionWithVeryfi(imageBuffer, filename) {
  if (!VERYFI_CLIENT_ID || !VERYFI_API_KEY) {
    throw new Error('Veryfi credentials not configured');
  }

  try {
    console.log("   📡 Calling Veryfi API...");
    const timestamp = Date.now();
    const base64Image = imageBuffer.toString('base64');
    
    // Veryfi request payload
    const payload = {
      file_name: filename,
      file_data: base64Image,
      categories: ['medical'],
    };

    const signature = generateSignature(timestamp, JSON.stringify(payload));

    // Try multiple endpoints in order of preference
    let response;
    let endpointUsed = '';
    
    // 1. Try /partner/any-documents (user suggested endpoint)
    try {
      const anyDocsEndpoint = `${VERYFI_BASE_URL}/partner/any-documents`;
      console.log("   🎯 Trying any-documents endpoint:", anyDocsEndpoint);
      console.log("   📦 Payload keys:", Object.keys(payload));
      
      response = await axios.post(
        anyDocsEndpoint,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'CLIENT-ID': VERYFI_CLIENT_ID,
            'AUTHORIZATION': `apikey ${VERYFI_USERNAME}:${VERYFI_API_KEY}`,
            'X-Veryfi-Request-Timestamp': timestamp,
            'X-Veryfi-Request-Signature': signature,
          },
          timeout: 30000,
        }
      );
      endpointUsed = 'any-documents';
      console.log("   ✅ any-documents endpoint worked!");
    } catch (anyDocsError) {
      console.log("   ⚠️ any-documents failed, trying blueprint endpoint");
      console.log("   Error:", anyDocsError.response?.status, anyDocsError.response?.data?.error);
      
      // 2. Try blueprint endpoint
      try {
        const blueprintEndpoint = `${VERYFI_BASE_URL}/partner/blueprints/medical_prescription_list/documents`;
        console.log("   🎯 Trying blueprint endpoint:", blueprintEndpoint);
        
        response = await axios.post(
          blueprintEndpoint,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'CLIENT-ID': VERYFI_CLIENT_ID,
              'AUTHORIZATION': `apikey ${VERYFI_USERNAME}:${VERYFI_API_KEY}`,
              'X-Veryfi-Request-Timestamp': timestamp,
              'X-Veryfi-Request-Signature': signature,
            },
            timeout: 30000,
          }
        );
        endpointUsed = 'blueprint';
        console.log("   ✅ Blueprint endpoint worked!");
      } catch (blueprintError) {
        // 3. Fallback to regular /partner/documents
        console.log("   ⚠️ Blueprint endpoint failed, trying regular endpoint");
        console.log("   Error:", blueprintError.response?.status, blueprintError.response?.data?.error);
        
        const regularEndpoint = `${VERYFI_BASE_URL}/partner/documents`;
        response = await axios.post(
          regularEndpoint,
          payload,
          {
            headers: {
              'Content-Type': 'application/json',
              'CLIENT-ID': VERYFI_CLIENT_ID,
              'AUTHORIZATION': `apikey ${VERYFI_USERNAME}:${VERYFI_API_KEY}`,
              'X-Veryfi-Request-Timestamp': timestamp,
              'X-Veryfi-Request-Signature': signature,
            },
            timeout: 30000,
          }
        );
        endpointUsed = 'regular';
        console.log("   ✅ Regular endpoint worked");
      }
    }

    console.log("   ✅ Veryfi API responded");
    console.log("   🔗 Endpoint used:", endpointUsed);
    const { data } = response;
    
    // Debug: log the full response structure
    console.log("   📦 Response keys:", Object.keys(data));
    console.log("   📝 Has prescription_list:", !!data.prescription_list);
    console.log("   📝 Prescription count:", data.prescription_list?.length || 0);
    
    // BEST: Extract structured prescription_list
    let extractedText = '';
    let medicines = [];
    
    if (data.prescription_list && data.prescription_list.length > 0) {
      console.log("   ✅ Using prescription_list (structured data)");
      
      medicines = data.prescription_list.map(item => ({
        name: item.prescription_name || '',
        dose: item.prescription_dose || '',
        description: item.prescription_description || '',
      }));
      
      // Format as text for display
      extractedText = medicines
        .map(med => {
          const parts = [med.name, med.dose, med.description].filter(Boolean);
          return parts.join(' ').trim();
        })
        .filter(Boolean)
        .join('\n');
    }
    
    // Fallback: Parse raw OCR text to extract medicines
    if (!extractedText && data.ocr_text) {
      console.log("   ⚠️ No prescription_list, parsing raw ocr_text");
      console.log("   📄 OCR text preview:", data.ocr_text.substring(0, 200).replace(/\n/g, ' '));
      
      // Apply OCR fixes (typos, TA/TA3/TAS → Tab., etc.) before parsing
      const ocrCorrected = applyPrescriptionOCRFixes(data.ocr_text);
      medicines = parseMedicinesFromText(ocrCorrected);
      console.log("   📝 Parsed medicines:", medicines.length);
      
      if (medicines.length > 0) {
        console.log("   ✅ Medicine names:", medicines.map(m => m.name).join(', '));
        extractedText = formatMedicinesAsText(medicines);
      } else {
        // Last resort: use full OCR text
        console.log("   ⚠️ Could not parse medicines, using full OCR text");
        extractedText = data.ocr_text;
      }
    }

    if (!extractedText) {
      console.log("   ⚠️ No text extracted");
    }

    return {
      text: extractedText.trim(),
      medicines: medicines, // Return structured data (parsed or from API)
      rawData: data, // Full Veryfi response (optional)
    };
  } catch (error) {
    console.error('   ❌ Veryfi API error:', error.response?.data || error.message);
    throw new Error(`Veryfi OCR failed: ${error.message}`);
  }
}

/**
 * Check if Veryfi is configured
 */
export function isVeryfiConfigured() {
  return Boolean(
    VERYFI_CLIENT_ID &&
    VERYFI_CLIENT_SECRET &&
    VERYFI_USERNAME &&
    VERYFI_API_KEY
  );
}
