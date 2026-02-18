/**
 * Manual Medicine Entry Form Component
 * Use this when OCR fails or returns poor results
 */

'use client';

import { useState } from 'react';

interface ManualMedicine {
  name: string;
  dose: string;
  timing: string;
  frequency: string;
  instructions?: {
    timing: string[];
    frequencyText: string;
  };
}

interface ManualEntryFormProps {
  onSubmit: (medicines: ManualMedicine[]) => void;
  onCancel: () => void;
}

export default function ManualEntryForm({ onSubmit, onCancel }: ManualEntryFormProps) {
  const [medicines, setMedicines] = useState<ManualMedicine[]>([
    { name: '', dose: '', timing: '', frequency: '' }
  ]);

  const addMedicine = () => {
    setMedicines([...medicines, { name: '', dose: '', timing: '', frequency: '' }]);
  };

  const removeMedicine = (index: number) => {
    setMedicines(medicines.filter((_, i) => i !== index));
  };

  const updateMedicine = (index: number, field: keyof ManualMedicine, value: string) => {
    const updated = [...medicines];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-parse timing pattern
    if (field === 'timing' && value.match(/^\d-\d-\d$/)) {
      const parts = value.split('-').map(Number);
      const timings = [];
      if (parts[0] > 0) timings.push('Morning');
      if (parts[1] > 0) timings.push('Afternoon');
      if (parts[2] > 0) timings.push('Night');
      
      updated[index].instructions = {
        timing: timings,
        frequencyText: updated[index].frequency || ''
      };
    }
    
    setMedicines(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validMedicines = medicines.filter(m => m.name.trim() !== '');
    if (validMedicines.length === 0) {
      alert('Please add at least one medicine');
      return;
    }
    onSubmit(validMedicines);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Manual Medicine Entry</h2>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {medicines.map((med, index) => (
          <div key={index} className="mb-6 p-4 border border-gray-200 rounded-lg">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-gray-700">Medicine {index + 1}</h3>
              {medicines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMedicine(index)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Medicine Name *
                </label>
                <input
                  type="text"
                  value={med.name}
                  onChange={(e) => updateMedicine(index, 'name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Tab. Omiclon"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Dosage
                </label>
                <input
                  type="text"
                  value={med.dose}
                  onChange={(e) => updateMedicine(index, 'dose', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 20mg, 500mg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timing Pattern
                </label>
                <input
                  type="text"
                  value={med.timing}
                  onChange={(e) => updateMedicine(index, 'timing', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 1-0-1, 1-1-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Format: Morning-Afternoon-Night (e.g., 1-0-1)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Frequency
                </label>
                <select
                  value={med.frequency}
                  onChange={(e) => updateMedicine(index, 'frequency', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select frequency</option>
                  <option value="Once daily">Once daily</option>
                  <option value="Twice daily">Twice daily</option>
                  <option value="Three times daily">Three times daily</option>
                  <option value="Four times daily">Four times daily</option>
                  <option value="As needed">As needed</option>
                </select>
              </div>
            </div>
          </div>
        ))}

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={addMedicine}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition"
          >
            + Add Another Medicine
          </button>

          <div className="flex-1"></div>

          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition"
          >
            Cancel
          </button>

          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
          >
            Analyze Medicines
          </button>
        </div>
      </form>

      <div className="mt-4 p-3 bg-blue-50 rounded-md">
        <p className="text-sm text-blue-800">
          💡 <strong>Tip:</strong> Use this form when OCR fails to read handwritten prescriptions accurately.
        </p>
      </div>
    </div>
  );
}
