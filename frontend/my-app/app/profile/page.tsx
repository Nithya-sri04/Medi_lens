"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { getToken, getUser, clearAuth } from "@/lib/auth";
import MedicineResult from "@/components/MedicineResult";
import PdfResultView from "@/components/PdfResultView";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface PrescriptionSummary {
  id: string;
  title: string;
  description: string;
  created_at: string;
}

interface PrescriptionDetail {
  id: string;
  title: string;
  description: string;
  data: unknown;
}

export default function ProfilePage() {
  const router = useRouter();
  const [list, setList] = useState<PrescriptionSummary[]>([]);
  const [selected, setSelected] = useState<PrescriptionDetail | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string; description: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pdfExportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login?returnTo=/profile");
      return;
    }
    setAuthReady(true);
    axios
      .get(`${API}/api/profile/prescriptions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setList(res.data.prescriptions || []))
      .catch(() => setError("Failed to load prescriptions"))
      .finally(() => setLoading(false));
  }, [router]);

  const openView = (id: string) => {
    const t = getToken();
    if (!t) return;
    axios
      .get(`${API}/api/profile/prescriptions/${id}`, {
        headers: { Authorization: `Bearer ${t}` },
      })
      .then((res) => setSelected(res.data.prescription))
      .catch(() => setError("Failed to load prescription"));
  };

  const exportToPdf = async () => {
    if (!selected || !pdfExportRef.current) return;
    setExporting(true);

    try {
      const element = pdfExportRef.current;
      if (!element) {
        setError("Could not find content to export");
        setExporting(false);
        return;
      }

      const canvas = await html2canvas(element, {
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
      });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageW = pdf.internal.pageSize.width;
      const pageH = pdf.internal.pageSize.height;
      const stripHeightPx = canvas.width * (pageH / pageW);

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

      pdf.save(`${selected.title || "prescription"}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      setError("Failed to export PDF");
    } finally {
      setExporting(false);
    }
  };

  const openEdit = (p: PrescriptionSummary) => {
    setEditing({ id: p.id, title: p.title, description: p.description });
  };

  const saveEdit = () => {
    if (!editing || !getToken()) return;
    axios
      .patch(
        `${API}/api/profile/prescriptions/${editing.id}`,
        { title: editing.title, description: editing.description },
        { headers: { Authorization: `Bearer ${getToken()}` } }
      )
      .then(() => {
        setList((prev) =>
          prev.map((x) =>
            x.id === editing.id
              ? { ...x, title: editing.title, description: editing.description }
              : x
          )
        );
        setEditing(null);
      })
      .catch(() => setError("Failed to update"));
  };

  const handleLogout = () => {
    clearAuth();
    router.push("/");
  };

  const user = authReady ? getUser() : null;

  if (!authReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p className="text-gray-700">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">My Prescriptions</h1>
          <div className="flex gap-3">
            <Link href="/" className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium">
              Back Home
            </Link>
            <button onClick={handleLogout} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8 bg-white rounded-lg shadow p-6 border-l-4 border-blue-600">
          <h2 className="text-xl font-bold text-gray-900 mb-1">{user?.name || "User"}</h2>
          <p className="text-gray-700 font-medium">{user?.email}</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-100 border-2 border-red-400 text-red-800 rounded-lg font-medium">
            {error}
          </div>
        )}

        <div className="mb-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-6">Saved Prescriptions</h3>
          {loading ? (
            <p className="text-gray-700 font-medium">Loading prescriptions...</p>
          ) : list.length === 0 ? (
            <div className="bg-white border-2 border-gray-300 rounded-lg p-8 text-center">
              <p className="text-gray-700 font-medium mb-4">No prescriptions saved yet.</p>
              <Link href="/" className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                Upload a Prescription
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {list.map((p) => (
                <div key={p.id} className="bg-white border-2 border-gray-300 rounded-lg p-6 shadow-md hover:shadow-lg transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h4 className="text-lg font-bold text-gray-900">{p.title}</h4>
                      {p.description && (
                        <p className="text-gray-700 text-sm mt-2">{p.description}</p>
                      )}
                      <p className="text-gray-700 font-medium text-sm mt-3">
                        📅 {new Date(p.created_at).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => openView(p.id)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm whitespace-nowrap"
                      >
                        View
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-bold text-sm whitespace-nowrap"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Hidden PDF-safe render: positioned off-screen with no height constraints */}
      {selected && (
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
          <PdfResultView data={selected.data as Parameters<typeof PdfResultView>[0]["data"]} />
        </div>
      )}

      {/* View Modal with PDF Export */}
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col my-8">
            <div className="sticky top-0 bg-white border-b-2 border-gray-300 px-6 py-5 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">{selected.title}</h2>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-700 hover:text-gray-900 font-bold text-3xl leading-none"
              >
                ✕
              </button>
            </div>
            <div id="pdf-content" style={{ backgroundColor: "#ffffff" }} className="overflow-y-auto flex-1 p-6">
              {selected.data && typeof selected.data === "object" && "medicines" in selected.data ? (
                <MedicineResult data={selected.data as Parameters<typeof MedicineResult>[0]["data"]} />
              ) : (
                <p className="text-gray-700">No prescription data available</p>
              )}
            </div>
            <div className="border-t-2 border-gray-300 px-6 py-4 flex items-center justify-end gap-3 bg-gray-50">
              <button
                onClick={() => setSelected(null)}
                className="px-6 py-2 border-2 border-gray-600 text-gray-700 font-bold rounded-lg hover:bg-gray-100"
              >
                Close
              </button>
              <button
                onClick={exportToPdf}
                disabled={exporting}
                className="px-6 py-2 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {exporting ? "Exporting..." : "📥 Export as PDF"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full">
            <div className="border-b-2 border-gray-300 px-6 py-5 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Edit Prescription</h2>
              <button
                onClick={() => setEditing(null)}
                className="text-gray-700 hover:text-gray-900 font-bold text-3xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Title</label>
                <input
                  type="text"
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-medium"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-900 mb-2">Description</label>
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 font-medium"
                  rows={4}
                />
              </div>
            </div>
            <div className="border-t-2 border-gray-300 px-6 py-4 flex items-center justify-end gap-3 bg-gray-50">
              <button
                onClick={() => setEditing(null)}
                className="px-6 py-2 border-2 border-gray-600 text-gray-700 font-bold rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
