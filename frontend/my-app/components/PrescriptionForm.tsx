"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import ImageUpload from "./ImageUpload";
import OCRResult from "./OCRResult";
import MedicineResult from "./MedicineResult";
import PdfResultView from "./PdfResultView";
import ManualEntryForm from "./ManualEntryForm";
import { getToken } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";
const PENDING_SAVE_KEY = "medilens_pending_save";

export default function PrescriptionForm() {
  const router = useRouter();
  const resultRef = useRef<HTMLDivElement>(null);
  const pdfExportRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [source, setSource] = useState<'manual' | 'ocr'>('manual');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);

  useEffect(() => {
    const token = getToken();
    const pending = typeof window !== "undefined" ? sessionStorage.getItem(PENDING_SAVE_KEY) : null;
    if (token && pending) {
      try {
        const data = JSON.parse(pending);
        setResult(data);
        setSaveTitle("Prescription " + new Date().toLocaleDateString());
        setSaveDescription("");
        setShowSaveModal(true);
      } catch (_) {}
      sessionStorage.removeItem(PENDING_SAVE_KEY);
    }
  }, []);

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

  const handleManualSubmit = async (medicines: any[]) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(
        `${API}/api/prescription/manual`,
        { medicines }
      );
      setResult(res.data);
      setShowManualEntry(false);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string }; status?: number }; message?: string };
      setError(ax.response?.data?.error || ax.message || "Failed to analyze medicines. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post(
        `${API}/api/prescription/analyze`,
        { text: text.trim(), source }
      );
      setResult(res.data);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string }; status?: number }; message?: string };
      setError(ax.response?.data?.error || ax.message || "Failed to analyze prescription. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = async () => {
    const el = pdfExportRef.current;
    if (!el || !result) return;
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      // PdfResultView uses only hex/rgb — no lab/oklch, so html2canvas works without hacks
      const canvas = await html2canvas(el, { scale: 2, useCORS: true });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.width;
      const pageH = pdf.internal.pageSize.height;
      const stripHeightPx = canvas.width * (pageH / pageW);

      // Find a good break point near idealY: prefer a row that looks like gap/margin (whiter) to avoid cutting mid-sentence
      const findBreakY = (idealY: number, searchRadius: number): number => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return idealY;
        const yStart = Math.max(0, Math.floor(idealY - searchRadius));
        const yEnd = Math.min(canvas.height - 1, Math.ceil(idealY + searchRadius));
        const sampleH = yEnd - yStart + 1;
        if (sampleH <= 0) return idealY;
        let data: ImageData;
        try {
          data = ctx.getImageData(0, yStart, canvas.width, sampleH);
        } catch {
          return idealY;
        }
        const stride = data.width * 4;
        let bestY = idealY;
        let bestScore = -1;
        const radius = Math.min(80, Math.floor(searchRadius));
        for (let y = 0; y < sampleH; y += 2) {
          let sum = 0;
          const row = y * stride;
          for (let x = 0; x < data.width; x++) {
            const i = row + x * 4;
            sum += data.data[i] + data.data[i + 1] + data.data[i + 2];
          }
          const avg = sum / data.width;
          if (avg > bestScore) {
            bestScore = avg;
            bestY = yStart + y;
          }
        }
        return Math.round(bestY);
      };

      const breakYs: number[] = [0];
      let nextIdeal = stripHeightPx;
      const searchRadius = Math.min(120, stripHeightPx * 0.15);
      while (nextIdeal < canvas.height) {
        const breakAt = findBreakY(nextIdeal, searchRadius);
        breakYs.push(breakAt);
        nextIdeal = breakAt + stripHeightPx;
      }

      for (let i = 0; i < breakYs.length; i++) {
        if (i > 0) pdf.addPage();
        const sy = breakYs[i];
        const nextY = i + 1 < breakYs.length ? breakYs[i + 1] : canvas.height;
        const sh = Math.min(nextY - sy, canvas.height - sy);
        if (sh <= 0) continue;
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sh;
        const ctx = pageCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
          const pageImg = pageCanvas.toDataURL("image/png");
          const imgH = (sh / canvas.width) * pageW;
          pdf.addImage(pageImg, "PNG", 0, 0, pageW, imgH);
        }
      }
      pdf.save("prescription-analysis.pdf");
    } catch (err) {
      console.error("PDF export failed:", err);
      setError("Failed to export PDF. Try again.");
    }
  };

  const openSaveToProfile = () => {
    if (!getToken()) {
      if (typeof sessionStorage !== "undefined" && result) {
        sessionStorage.setItem(PENDING_SAVE_KEY, JSON.stringify(result));
      }
      router.push("/login?returnTo=/upload");
      return;
    }
    setSaveTitle("Prescription " + new Date().toLocaleDateString());
    setSaveDescription("");
    setSaveError(null);
    setShowSaveModal(true);
  };

  const submitSaveToProfile = async () => {
    const token = getToken();
    if (!token || !result) return;
    setSaving(true);
    setSaveError(null);
    try {
      await axios.post(
        `${API}/api/profile/prescriptions`,
        { title: saveTitle.trim() || "Prescription", description: saveDescription.trim(), data: result },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setShowSaveModal(false);
      router.push("/profile");
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } };
      setSaveError(ax.response?.data?.message || "Failed to save");
    } finally {
      setSaving(false);
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

      {/* Manual Entry Options */}
      {!showManualEntry ? (
        <>
          {/* Manual Text Entry */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Paste or Type Prescription Text
              </label>
              <button
                onClick={() => setShowManualEntry(true)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                📝 Enter Medicines Manually
              </button>
            </div>
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
        </>
      ) : (
        <ManualEntryForm
          onSubmit={handleManualSubmit}
          onCancel={() => setShowManualEntry(false)}
        />
      )}

      {/* Analyze Button - Only show if not in manual entry mode */}
      {!showManualEntry && (
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
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 p-4 rounded">
          <p className="text-red-600">Error: {error}</p>
        </div>
      )}

      {/* Hidden PDF-only view: hex/rgb only, no Tailwind lab/oklch — used for export */}
      {result && (
        <div
          ref={pdfExportRef}
          style={{
            position: "fixed",
            left: -9999,
            top: 0,
            width: 600,
            padding: 24,
            backgroundColor: "#ffffff",
            zIndex: -1,
          }}
        >
          <PdfResultView data={result} />
        </div>
      )}
      {result && (
        <div ref={resultRef}>
          <MedicineResult data={result} />
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={exportPdf}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg font-medium hover:bg-gray-900"
            >
              Export as PDF
            </button>
            <button
              onClick={openSaveToProfile}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
            >
              Save to profile
            </button>
          </div>
        </div>
      )}

      {showSaveModal && result && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="font-bold text-lg mb-4">Save to profile</h3>
            {saveError && (
              <p className="mb-3 text-sm text-red-600">{saveError}</p>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  placeholder="e.g. Dr. Visit Jan 2025"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <textarea
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  rows={2}
                  placeholder="e.g. Follow-up for hypertension"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={submitSaveToProfile}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
