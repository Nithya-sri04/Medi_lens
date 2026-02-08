"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { getToken, getUser, clearAuth } from "@/lib/auth";
import MedicineResult from "@/components/MedicineResult";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface PrescriptionSummary {
  id: string;
  title: string;
  description: string;
  created_at: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [list, setList] = useState<PrescriptionSummary[]>([]);
  const [selected, setSelected] = useState<{ id: string; title: string; description: string; data: unknown } | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string; description: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
      <nav className="bg-white/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center space-x-2">
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-green-600 bg-clip-text text-transparent">
                MediLens
              </span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/upload" className="text-gray-600 hover:text-gray-900 text-sm font-medium">
                Upload
              </Link>
              <span className="text-gray-600 text-sm">{user?.name ?? "User"}{user?.email ? ` (${user.email})` : ""}</span>
              <button onClick={handleLogout} className="text-gray-600 hover:text-red-600 text-sm font-medium">
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My profile</h1>
        <p className="text-gray-600 mb-6">View and manage your saved prescriptions</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {!authReady || loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : list.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-600">
            <p>No saved prescriptions yet.</p>
            <Link href="/upload" className="mt-4 inline-block text-blue-600 hover:underline">
              Analyze a prescription and save it here
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {list.map((p) => (
              <li
                key={p.id}
                className="bg-white rounded-lg shadow p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{p.title}</p>
                  {p.description && (
                    <p className="text-sm text-gray-600 truncate">{p.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(p.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openView(p.id)}
                    className="px-3 py-1.5 bg-blue-100 text-blue-800 rounded text-sm font-medium hover:bg-blue-200"
                  >
                    View
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="px-3 py-1.5 bg-gray-100 text-gray-800 rounded text-sm font-medium hover:bg-gray-200"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Edit modal */}
        {editing && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="font-bold text-lg mb-4">Edit prescription</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    value={editing.title}
                    onChange={(e) => setEditing((prev) => prev ? { ...prev, title: e.target.value } : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={editing.description}
                    onChange={(e) => setEditing((prev) => prev ? { ...prev, description: e.target.value } : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    rows={3}
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={saveEdit}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View modal */}
        {selected && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="font-bold text-lg">{selected.title}</h3>
                <button
                  onClick={() => setSelected(null)}
                  className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                >
                  &times;
                </button>
              </div>
              {selected.data && typeof selected.data === "object" && "medicines" in selected.data ? (
                <MedicineResult data={selected.data as Parameters<typeof MedicineResult>[0]["data"]} />
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
