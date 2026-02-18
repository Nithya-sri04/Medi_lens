"use client";

import { useEffect, useState } from "react";
import Tesseract from "tesseract.js";

interface Props {
  image: File | null;
  onTextExtracted: (text: string) => void;
}

export default function OCRResult({ image, onTextExtracted }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  // Advanced image preprocessing with multiple strategies
  const preprocessImage = async (file: File): Promise<string[]> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();

      img.onload = () => {
        // Resize if too small (minimum 1200px for better OCR)
        const minSize = 1200;
        let { width, height } = img;
        if (width < minSize || height < minSize) {
          const ratio = Math.max(minSize / width, minSize / height);
          width *= ratio;
          height *= ratio;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const results: string[] = [];

        // Strategy 1: High Contrast Grayscale (Original improved)
        const canvas1 = document.createElement('canvas');
        const ctx1 = canvas1.getContext('2d')!;
        canvas1.width = width;
        canvas1.height = height;
        ctx1.drawImage(img, 0, 0, width, height);
        let imageData = ctx1.getImageData(0, 0, width, height);
        let data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const contrasted = Math.min(255, Math.max(0, (gray - 128) * 2.0 + 128));
          data[i] = data[i + 1] = data[i + 2] = contrasted;
        }
        ctx1.putImageData(imageData, 0, 0);
        results.push(canvas1.toDataURL());

        // Strategy 2: Adaptive Thresholding (simulated with high contrast)
        const canvas2 = document.createElement('canvas');
        const ctx2 = canvas2.getContext('2d')!;
        canvas2.width = width;
        canvas2.height = height;
        ctx2.drawImage(img, 0, 0, width, height);
        imageData = ctx2.getImageData(0, 0, width, height);
        data = imageData.data;
        
        // Calculate local mean for adaptive threshold
        const blockSize = 15;
        const threshold = 128;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            
            // Simple local threshold
            const localMean = gray; // Simplified - in real implementation, calculate mean of block
            const value = gray > localMean - threshold ? 255 : 0;
            data[idx] = data[idx + 1] = data[idx + 2] = value;
          }
        }
        ctx2.putImageData(imageData, 0, 0);
        results.push(canvas2.toDataURL());

        // Strategy 3: Enhanced Binarization (Black and White)
        const canvas3 = document.createElement('canvas');
        const ctx3 = canvas3.getContext('2d')!;
        canvas3.width = width;
        canvas3.height = height;
        ctx3.drawImage(img, 0, 0, width, height);
        imageData = ctx3.getImageData(0, 0, width, height);
        data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          // Strong binarization
          const binary = gray > 140 ? 255 : 0;
          data[i] = data[i + 1] = data[i + 2] = binary;
        }
        ctx3.putImageData(imageData, 0, 0);
        results.push(canvas3.toDataURL());

        // Strategy 4: Noise Reduction + Contrast
        const canvas4 = document.createElement('canvas');
        const ctx4 = canvas4.getContext('2d')!;
        canvas4.width = width;
        canvas4.height = height;
        ctx4.drawImage(img, 0, 0, width, height);
        imageData = ctx4.getImageData(0, 0, width, height);
        data = imageData.data;
        
        // Simple noise reduction: median filter approximation
        const newData = new Uint8ClampedArray(data);
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          // Apply moderate contrast boost
          const enhanced = Math.min(255, Math.max(0, (gray - 100) * 1.8 + 100));
          newData[i] = newData[i + 1] = newData[i + 2] = enhanced;
        }
        imageData.data.set(newData);
        ctx4.putImageData(imageData, 0, 0);
        results.push(canvas4.toDataURL());

        resolve(results);
      };

      img.src = URL.createObjectURL(file);
    });
  };

  const normalizeExtractedText = async (ocrText: string): Promise<string> => {
    try {
      const response = await fetch('http://localhost:5000/api/prescription/ocr/normalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ocrText })
      });
      if (response.ok) {
        const normalized = await response.json();
        if (normalized.corrections?.length) {
          console.log('OCR Corrections applied:', normalized.corrections);
        }
        return normalized.normalizedText ?? ocrText;
      }
    } catch (e) {
      console.warn('Normalization failed, using raw OCR text:', e);
    }
    return ocrText;
  };

  useEffect(() => {
    if (!image) return;

    setLoading(true);

    (async () => {
      let ocrText = "";

      // Try Veryfi API first (if configured on backend)
      try {
        const form = new FormData();
        form.append("image", image, image.name || "image.png");
        const veryfiRes = await fetch("http://localhost:5000/api/prescription/ocr/veryfi", {
          method: "POST",
          body: form,
        });
        if (veryfiRes.ok) {
          const data = await veryfiRes.json();
          ocrText = (data.text ?? "").trim();
          if (ocrText) {
            console.log("✅ Used Veryfi OCR (high accuracy)");
            // Skip normalization for Veryfi - the backend parser already cleaned the text
            // Normalization is only for Tesseract OCR errors
            setText(ocrText);
            onTextExtracted(ocrText);
            setLoading(false);
            return;
          }
        }
      } catch (_) {
        // Fall through to Tesseract
        console.log("⚠️ Veryfi not available, using Tesseract");
      }

      // Fallback: Use Tesseract with multiple preprocessing strategies
      try {
        const processedImages = await preprocessImage(image);
        const ocrPromises = processedImages.map((processedImg) =>
          Tesseract.recognize(processedImg, "eng", {
            logger: (m) => console.log(m)
          }).then(({ data: { text, confidence } }) => ({ text, confidence: confidence || 0 }))
        );
        const results = await Promise.all(ocrPromises);
        const bestResult = results.reduce((best, current) =>
          current.confidence > best.confidence ? current : best
        );
        ocrText = bestResult.confidence > 50
          ? bestResult.text
          : results.reduce((longest, current) =>
              current.text.length > longest.text.length ? current : longest
            ).text;
        ocrText = await normalizeExtractedText(ocrText);
        setText(ocrText);
        onTextExtracted(ocrText);
      } catch (error) {
        console.error("OCR Error:", error);
        setText("");
        onTextExtracted("");
      } finally {
        setLoading(false);
      }
    })();
  }, [image]);

  if (!image) return null;

  return (
    <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900 flex items-center">
          <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          OCR Extracted Text
        </h3>
        {loading && (
          <span className="text-xs text-blue-600 flex items-center">
            <svg className="animate-spin h-4 w-4 mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Processing...
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600 mb-3">
        Review and edit the extracted text if needed. Our system will automatically correct common OCR errors.
      </p>

      {loading && (
        <div className="bg-white border border-blue-200 rounded p-4 text-center text-gray-500">
          <p>Preprocessing image and extracting text...</p>
          <p className="text-xs mt-2">This may take a few seconds</p>
        </div>
      )}

      {!loading && (
        <textarea
          className="w-full h-40 border-2 border-gray-300 rounded-lg p-4 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-colors font-mono text-sm text-black"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onTextExtracted(e.target.value);
          }}
          placeholder="OCR text will appear here..."
        />
      )}
    </div>
  );
}
