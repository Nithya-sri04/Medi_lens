interface Medicine {
  name: string;
  dosage: string;
  frequency: string;
  instructions: {
    timing: string[];
    foodRelation: string;
    durationDays: number;
    frequencyText: string;
    frequency?: string;
  };
  purpose: string;
  warning: string;
  alternatives: string[];
  verified: boolean;
  verificationMessage?: string;
  composition?: string;
  genericName?: string;
  brandType?: 'generic' | 'branded' | 'unknown';
  brandName?: string;
  foodHabits?: string[];
  foodInteractionWarnings?: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
  }>;
  marketAlternatives?: Array<{
    name: string;
    type: string;
    genericName?: string;
    composition?: string;
  }>;
}

interface Interaction {
  medicines: string[];
  severity: 'low' | 'medium' | 'high';
  warning: string;
}

interface DuplicateGroup {
  medicines: Array<{
    index: number;
    name: string;
    composition: string;
  }>;
  similarity: number;
}

interface Props {
  data: {
    medicines?: Medicine[];
    interactions?: Interaction[];
    duplicates?: DuplicateGroup[];
    confidence?: number;
    disclaimer?: string;
    warning?: string;
    rawText?: string;
    explanations?: string[];
  };
}

export default function MedicineResult({ data }: Props) {
  if (!data) return null;

  // Handle case when no medicines found
  if (data.warning === "NO_KNOWN_MEDICINES_FOUND") {
    return (
      <div className="mt-6 space-y-6">
        <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
          <h3 className="font-bold text-lg text-yellow-800">No Known Medicines Found</h3>
          <p className="text-yellow-700">The prescription text did not contain any recognized medicines. Please check the spelling or try re-entering the text.</p>
          <p className="text-sm text-gray-600 mt-2">Extracted text: {data.rawText}</p>
        </div>
        {data.confidence !== undefined && (
          <div className="bg-blue-50 p-4 rounded">
            <h3 className="font-bold text-lg text-black">Analysis Confidence</h3>
            <p className="text-2xl font-semibold text-black">{data.confidence}%</p>
          </div>
        )}
        {data.disclaimer && (
          <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
            <h3 className="font-bold text-lg text-yellow-800">Important Disclaimer</h3>
            <p className="text-yellow-700">{data.disclaimer}</p>
          </div>
        )}
      </div>
    );
  }

  if (!data.medicines || !data.medicines.length) return null;

  const formatInstructions = (instr: Medicine['instructions']) => {
    const parts = [];
    if (instr.timing && instr.timing.length) {
      parts.push(`Timing: ${instr.timing.join(', ')}`);
    }
    if (instr.foodRelation) {
      parts.push(`Food Relation: ${instr.foodRelation}`);
    }
    if (instr.frequency || instr.frequencyText) {
      parts.push(`Frequency: ${instr.frequency || instr.frequencyText}`);
    }
    if (instr.durationDays) {
      parts.push(`Duration: ${instr.durationDays} days`);
    }
    return parts.join('; ') || 'Not specified';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-red-600 bg-red-50 border-red-200';
      case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low': return 'text-green-600 bg-green-50 border-green-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getSeverityTextColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-red-600';
      case 'medium': return 'text-yellow-600';
      case 'low': return 'text-green-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="mt-6 space-y-6">
      {/* Confidence Score */}
      <div className="bg-blue-50 p-4 rounded">
        <h3 className="font-bold text-lg text-black">Analysis Confidence</h3>
        <p className="text-2xl font-semibold text-black">{data.confidence}%</p>
        <p className="text-sm text-black">
          {data.confidence && data.confidence >= 80 ? 'High confidence' : data.confidence && data.confidence >= 60 ? 'Medium confidence' : 'Low confidence - Please verify manually'}
        </p>
      </div>

      {/* Duplicate Medicines Warning */}
      {data.duplicates && data.duplicates.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 p-4 rounded">
          <h3 className="font-bold text-lg text-orange-800">⚠️ Duplicate Medicines Detected</h3>
          <p className="text-orange-700 mb-2">The following medicines have the same composition:</p>
          {data.duplicates.map((dup, idx) => (
            <div key={idx} className="mt-2 mb-2 p-2 bg-orange-100 rounded">
              <p className="font-semibold">Duplicate Group {idx + 1}:</p>
              <ul className="list-disc list-inside ml-2">
                {dup.medicines.map((m, mIdx) => (
                  <li key={mIdx} className="text-orange-800">
                    {m.name} {m.composition && `(Composition: ${m.composition})`}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-orange-600 mt-1">Similarity: {(dup.similarity * 100).toFixed(0)}%</p>
            </div>
          ))}
          <p className="text-sm text-orange-700 mt-2">Please consult your doctor before taking multiple medicines with the same composition.</p>
        </div>
      )}

      {/* Medicines */}
      <div>
        <h3 className="font-bold text-lg text-black">Medicines</h3>
        <div className="grid gap-4 mt-4">
          {data.medicines.map((med, idx) => (
            <div key={idx} className={`border p-4 rounded ${!med.verified ? 'border-red-300 bg-red-50' : ''}`}>
              {/* Medicine Name and Verification Status */}
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-xl text-black">{med.name}</h4>
                <div className="flex gap-2">
                  {med.verified ? (
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded">
                      ✓ Verified
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-red-100 text-red-800 text-xs font-semibold rounded">
                      ⚠ Unverified
                    </span>
                  )}
                  {med.brandType === 'branded' && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">
                      Branded
                    </span>
                  )}
                  {med.brandType === 'generic' && (
                    <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs font-semibold rounded">
                      Generic
                    </span>
                  )}
                </div>
              </div>

              {/* Unverified Medicine Warning */}
              {!med.verified && med.verificationMessage && (
                <div className="mb-3 p-3 bg-red-100 border border-red-300 rounded">
                  <p className="text-red-800 font-semibold">⚠️ {med.verificationMessage}</p>
                </div>
              )}

              {/* Generic/Brand Information */}
              {med.genericName && med.genericName !== med.name && (
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Generic Name:</strong> {med.genericName}
                </p>
              )}

              {/* Composition */}
              {med.composition && (
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Composition:</strong> {med.composition}
                </p>
              )}

              {/* Purpose */}
              {med.purpose && (
                <p className="mb-2 text-black">
                  <strong>Purpose:</strong> {med.purpose}
                </p>
              )}

              {/* Dosage */}
              <p className="mb-2 text-black">
                <strong>Dosage:</strong> {med.dosage || 'Not specified'}
              </p>

              {/* Frequency */}
              <p className="mb-2 text-black">
                <strong>Frequency:</strong> {med.frequency || med.instructions?.frequency || 'Not specified'}
              </p>

              {/* Instructions */}
              <p className="mb-2 text-black">
                <strong>Instructions:</strong> {formatInstructions(med.instructions)}
              </p>

              {/* Food Habits */}
              {med.foodHabits && Array.isArray(med.foodHabits) && med.foodHabits.length > 0 && (
                <div className="mt-3 mb-2 p-2 bg-blue-50 border border-blue-200 rounded">
                  <p className="font-semibold text-blue-800 mb-1">🍽️ Food Habits:</p>
                  <ul className="list-disc list-inside text-sm text-blue-700">
                    {med.foodHabits.map((habit, hIdx) => (
                      <li key={hIdx}>{habit}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Food Interaction Warnings */}
              {med.foodInteractionWarnings && Array.isArray(med.foodInteractionWarnings) && med.foodInteractionWarnings.length > 0 && (
                <div className="mt-3 mb-2">
                  {med.foodInteractionWarnings.map((warning, wIdx) => (
                    <div key={wIdx} className={`p-2 border rounded mb-2 ${getSeverityColor(warning.severity)}`}>
                      <p className="font-semibold">⚠️ Food Interaction Warning ({warning.severity.toUpperCase()}):</p>
                      <p className="text-sm">{warning.message}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Medicine Warning */}
              {med.warning && (
                <div className="mt-2 mb-2 p-2 bg-orange-100 border border-orange-300 rounded">
                  <p className="text-orange-800">
                    <strong>⚠️ Warning:</strong> {med.warning}
                  </p>
                </div>
              )}

              {/* Alternatives */}
              {med.alternatives && Array.isArray(med.alternatives) && med.alternatives.length > 0 && (
                <p className="text-sm text-gray-600 mt-2">
                  <strong>Alternatives:</strong> {med.alternatives.join(', ')}
                </p>
              )}

              {/* Market Alternatives (Generic/Branded alternatives) */}
              {med.marketAlternatives && Array.isArray(med.marketAlternatives) && med.marketAlternatives.length > 0 && (
                <div className="mt-3 p-2 bg-gray-50 border border-gray-200 rounded">
                  <p className="font-semibold text-gray-700 mb-1">💊 Market Alternatives:</p>
                  <ul className="list-disc list-inside text-sm text-gray-600">
                    {med.marketAlternatives.slice(0, 5).map((alt, aIdx) => (
                      <li key={aIdx}>
                        {alt.name} ({alt.type})
                        {alt.genericName && ` - Generic: ${alt.genericName}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* LLM Explanation */}
              {data.explanations && data.explanations.length > idx && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="font-semibold text-blue-800 mb-1">📖 Simple Explanation:</p>
                  <p className="text-sm text-blue-700">{data.explanations[idx] || 'Explanation not available'}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Interactions */}
      {data.interactions && data.interactions.length > 0 && (
        <div>
          <h3 className="font-bold text-lg text-red-600">Drug Interactions</h3>
          <div className="grid gap-4 mt-4">
            {data.interactions.map((inter, idx) => (
              <div key={idx} className="border border-red-200 p-4 rounded bg-red-50">
                <p><strong>Medicines:</strong> {inter.medicines.join(' + ')}</p>
                <p className={getSeverityColor(inter.severity)}>
                  <strong>Severity:</strong> {inter.severity.toUpperCase()}
                </p>
                <p><strong>Warning:</strong> {inter.warning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-yellow-50 p-4 rounded border border-yellow-200">
        <h3 className="font-bold text-lg text-yellow-800">Important Disclaimer</h3>
        <p className="text-yellow-700">{data.disclaimer}</p>
      </div>
    </div>
  );
}
