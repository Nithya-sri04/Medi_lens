"use client";

import { useState } from "react";
import axios from "axios";
import ImageUpload from "./ImageUpload";
import OCRResult from "./OCRResult";
import MedicineResult from "./MedicineResult";

export default function PrescriptionForm() {
  const [image, setImage] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState<'manual' | 'ocr'>('manual');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTextChange = (newText: string) => {
    setText(newText);
    setSource('manual');
    setError(null);
  };

  const handleOCRExtracted = (extractedText: string) => {
    setText(extractedText);
    setSource('ocr');
    setError(null);
  };

  const submit = async () => {
    if (!text.trim()) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    
    try {
      const res = await axios.post(
        "http://localhost:5000/api/prescription/analyze",
        { text: text.trim(), source }
      );
      setResult(res.data);
    } catch (err: any) {
      console.error('API Error:', err);
      setError(err.response?.data?.error || err.message || 'Failed to analyze prescription. Please check if the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Image Upload Section */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Upload Prescription Image</h2>
        <ImageUpload onImageSelected={setImage} />
      </div>

      {/* OCR Result Section */}
      <OCRResult image={image} onTextExtracted={handleOCRExtracted} />

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-300"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-gray-500">OR</span>
        </div>
      </div>

      {/* Manual Text Entry */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Paste or Type Prescription Text
        </label>
        <textarea
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          className="w-full p-4 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors text-black"
          rows={6}
          placeholder="Example: Paracetamol 500mg 1-0-1 BF (5)&#10;Amoxicillin 250mg TDS AF (7)"
        />
        <p className="text-xs text-gray-500 mt-2">
          Tip: Include medicine names, dosages, frequencies (like 1-0-1, BD, TDS), and food instructions (BF/AF)
        </p>
      </div>

      {/* Analyze Button */}
      <button
        onClick={submit}
        disabled={!text.trim() || loading}
        className="w-full bg-gradient-to-r from-blue-600 to-green-600 text-white px-6 py-4 rounded-lg text-lg font-semibold disabled:bg-gray-400 disabled:cursor-not-allowed hover:shadow-lg transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
      >
        {loading ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Analyzing...
          </span>
        ) : (
          "Analyze Prescription"
        )}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 p-4 rounded">
          <p className="text-red-600">Error: {error}</p>
        </div>
      )}

      {result && <MedicineResult data={result} />}
    </div>
  );
}
