"use client";

/**
 * PDF-safe prescription result view. Uses only hex/rgb colors and inline styles
 * so html2canvas never sees lab()/oklch() from Tailwind.
 */
interface Medicine {
  name: string;
  dosage: string;
  frequency: string;
  instructions: {
    timing: string[];
    foodRelation: string;
    durationDays: number | null;
    durationText?: string;
    frequencyText: string;
    frequency?: string;
    isContinue?: boolean;
  };
  purpose: string;
  alternatives: string[];
  safetyAdviceSummary?: string | null;
  safetyAdvice?: {
    alcohol?: string | null;
    pregnancy?: string | null;
    breastfeeding?: string | null;
    driving?: string | null;
    kidney?: string | null;
    liver?: string | null;
  } | null;
  verified: boolean;
  verificationMessage?: string;
  composition?: string;
  genericName?: string;
  brandType?: "generic" | "branded" | "unknown";
  brandName?: string;
  foodHabits?: string[];
  foodInteractionWarnings?: Array<{ type: string; severity: string; message: string }>;
  marketAlternatives?: Array<{ name: string; type: string; genericName?: string; composition?: string }>;
}

interface Props {
  data: {
    medicines?: Medicine[];
    interactions?: Array<{ medicines: string[]; severity: string; warning: string }>;
    duplicates?: Array<{
      medicines: Array<{ name: string; composition: string }>;
      similarity: number;
    }>;
    confidence?: number;
    disclaimer?: string;
    warning?: string;
    rawText?: string;
    extractedText?: string;
    explanations?: string[];
  };
}

// Hex/rgb-only palette (no lab/oklch)
const colors = {
  blue50: "#eff6ff",
  blue100: "#dbeafe",
  blue200: "#bfdbfe",
  blue700: "#1d4ed8",
  blue800: "#1e40af",
  sky50: "#f0f9ff",
  sky200: "#bae6fd",
  sky700: "#0369a1",
  sky800: "#075985",
  gray50: "#f8fafc",
  gray100: "#f1f5f9",
  gray200: "#e2e8f0",
  gray600: "#475569",
  gray700: "#334155",
  gray800: "#1e293b",
  red50: "#fef2f2",
  red100: "#fee2e2",
  red200: "#fecaca",
  red300: "#fca5a5",
  red600: "#dc2626",
  red800: "#b91c1c",
  green100: "#dcfce7",
  green800: "#166534",
  yellow50: "#fefce8",
  yellow100: "#fef9c3",
  yellow200: "#fef08a",
  yellow700: "#a16207",
  yellow800: "#854d0e",
  orange50: "#fff7ed",
  orange100: "#ffedd5",
  orange200: "#fed7aa",
  orange700: "#c2410c",
  orange800: "#9a3412",
  black: "#0f172a",
  white: "#ffffff",
};

export default function PdfResultView({ data }: Props) {
  if (!data) return null;

  const block = { marginTop: 24 };
  const card = { padding: 16, borderRadius: 8, border: `1px solid ${colors.gray200}` };
  const heading = { fontWeight: 700, fontSize: 18, color: colors.black, marginBottom: 8 };
  const text = { fontSize: 14, color: colors.black, marginBottom: 8 };
  const textSm = { fontSize: 12, color: colors.gray600, marginBottom: 8 };

  if (data.warning === "NO_KNOWN_MEDICINES_FOUND") {
    return (
      <div style={{ ...block, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ ...card, backgroundColor: colors.yellow50, borderColor: colors.yellow200 }}>
          <h3 style={{ ...heading, color: colors.yellow800 }}>No Known Medicines Found</h3>
          <p style={{ color: colors.yellow700, fontSize: 14 }}>
            The prescription text did not contain any recognized medicines. Please check the spelling or try re-entering the text.
          </p>
          {data.extractedText && <p style={{ ...textSm, marginTop: 8 }}>Extracted text: {data.extractedText}</p>}
        </div>
        {data.confidence !== undefined && (
          <div style={{ ...card, backgroundColor: colors.blue50 }}>
            <h3 style={heading}>Analysis Confidence</h3>
            <p style={{ fontSize: 24, fontWeight: 600, color: colors.black }}>{data.confidence}%</p>
          </div>
        )}
        {data.disclaimer && (
          <div style={{ ...card, backgroundColor: colors.yellow50, borderColor: colors.yellow200 }}>
            <h3 style={{ ...heading, color: colors.yellow800 }}>Important Disclaimer</h3>
            <p style={{ color: colors.yellow700 }}>{data.disclaimer}</p>
          </div>
        )}
      </div>
    );
  }

  if (!data.medicines || !data.medicines.length) return null;

  const formatInstructions = (instr: Medicine["instructions"]) => {
    const parts: string[] = [];
    if (instr.timing?.length) parts.push(`Timing: ${instr.timing.join(", ")}`);
    if (instr.foodRelation) parts.push(`Food Relation: ${instr.foodRelation}`);
    if (instr.frequency || instr.frequencyText) parts.push(`Frequency: ${instr.frequency || instr.frequencyText}`);
    if (instr.durationDays) parts.push(`Duration: ${instr.durationDays} days`);
    else if (instr.durationText) parts.push(`Duration: ${instr.durationText}`);
    return parts.join("; ") || "Not specified";
  };

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case "high":
        return { bg: colors.red50, border: colors.red200, text: colors.red800 };
      case "medium":
        return { bg: colors.yellow50, border: colors.yellow200, text: colors.yellow800 };
      case "low":
        return { bg: colors.green100, border: "#86efac", text: colors.green800 };
      default:
        return { bg: colors.gray50, border: colors.gray200, text: colors.gray700 };
    }
  };

  return (
    <div style={{ ...block, display: "flex", flexDirection: "column", gap: 24, fontFamily: "Arial, sans-serif", color: colors.black }}>
      {/* Confidence */}
      <div style={{ ...card, backgroundColor: colors.blue50 }}>
        <h3 style={heading}>Analysis Confidence</h3>
        <p style={{ fontSize: 24, fontWeight: 600, color: colors.black }}>{data.confidence ?? 0}%</p>
        <p style={textSm}>
          {data.confidence && data.confidence >= 80 ? "High confidence" : data.confidence && data.confidence >= 60 ? "Medium confidence" : "Low confidence - Please verify manually"}
        </p>
      </div>

      {/* Duplicates */}
      {data.duplicates && data.duplicates.length > 0 && (
        <div style={{ ...card, backgroundColor: colors.orange50, borderColor: colors.orange200 }}>
          <h3 style={{ ...heading, color: colors.orange800 }}>Duplicate Medicines Detected</h3>
          <p style={{ color: colors.orange700, marginBottom: 8 }}>The following medicines have the same composition:</p>
          {data.duplicates.map((dup, idx) => (
            <div key={idx} style={{ marginTop: 8, marginBottom: 8, padding: 8, backgroundColor: colors.orange100, borderRadius: 6 }}>
              <p style={{ fontWeight: 600 }}>Duplicate Group {idx + 1}:</p>
              <ul style={{ marginLeft: 16, listStyle: "disc" }}>
                {dup.medicines.map((m, mIdx) => (
                  <li key={mIdx} style={{ color: colors.orange800 }}>
                    {m.name} {m.composition && `(Composition: ${m.composition})`}
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: 12, color: colors.orange700, marginTop: 4 }}>Similarity: {(dup.similarity * 100).toFixed(0)}%</p>
            </div>
          ))}
        </div>
      )}

      {/* Medicines */}
      <div>
        <h3 style={heading}>Medicines</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
          {data.medicines.map((med, idx) => (
            <div
              key={idx}
              style={{
                ...card,
                borderColor: !med.verified ? colors.red300 : colors.gray200,
                backgroundColor: !med.verified ? colors.red50 : colors.white,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <h4 style={{ fontWeight: 700, fontSize: 20, color: colors.black, margin: 0 }}>{med.name}</h4>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {med.verified ? (
                    <span style={{ padding: "4px 8px", backgroundColor: colors.green100, color: colors.green800, fontSize: 12, fontWeight: 600, borderRadius: 6 }}>Verified</span>
                  ) : (
                    <span style={{ padding: "4px 8px", backgroundColor: colors.red100, color: colors.red800, fontSize: 12, fontWeight: 600, borderRadius: 6 }}>Unverified</span>
                  )}
                  {med.brandType === "branded" && (
                    <span style={{ padding: "4px 8px", backgroundColor: colors.blue100, color: colors.blue800, fontSize: 12, fontWeight: 600, borderRadius: 6 }}>Branded</span>
                  )}
                  {med.brandType === "generic" && (
                    <span style={{ padding: "4px 8px", backgroundColor: colors.gray100, color: colors.gray800, fontSize: 12, fontWeight: 600, borderRadius: 6 }}>Generic</span>
                  )}
                </div>
              </div>

              {!med.verified && med.verificationMessage && (
                <div style={{ marginBottom: 12, padding: 12, backgroundColor: colors.red100, border: `1px solid ${colors.red300}`, borderRadius: 6 }}>
                  <p style={{ color: colors.red800, fontWeight: 600, margin: 0 }}>{med.verificationMessage}</p>
                </div>
              )}

              {med.genericName && med.genericName !== med.name && (
                <p style={textSm}><strong>Generic Name:</strong> {med.genericName}</p>
              )}
              {med.composition && (
                <p style={textSm}><strong>Composition:</strong> {med.composition}</p>
              )}
              {med.purpose && (
                <p style={text}><strong>Purpose:</strong> {med.purpose}</p>
              )}
              <p style={text}><strong>Dosage:</strong> {med.dosage || "Not specified"}</p>
              <p style={text}><strong>Frequency:</strong> {med.frequency || med.instructions?.frequency || "Not specified"}</p>
              <p style={text}><strong>Instructions:</strong> {formatInstructions(med.instructions)}</p>

              {med.foodHabits && med.foodHabits.length > 0 && (
                <div style={{ marginTop: 12, marginBottom: 8, padding: 8, backgroundColor: colors.blue50, border: `1px solid ${colors.blue200}`, borderRadius: 6 }}>
                  <p style={{ fontWeight: 600, color: colors.blue800, marginBottom: 4 }}>Food Habits:</p>
                  <ul style={{ marginLeft: 16, listStyle: "disc", fontSize: 14, color: colors.blue700 }}>
                    {med.foodHabits.map((habit, hIdx) => (
                      <li key={hIdx}>{habit}</li>
                    ))}
                  </ul>
                </div>
              )}

              {med.foodInteractionWarnings && med.foodInteractionWarnings.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {med.foodInteractionWarnings.map((warning, wIdx) => {
                    const s = getSeverityStyles(warning.severity);
                    return (
                      <div key={wIdx} style={{ padding: 8, border: `1px solid ${s.border}`, borderRadius: 6, marginBottom: 8, backgroundColor: s.bg }}>
                        <p style={{ fontWeight: 600, color: s.text, margin: 0 }}>Food Interaction Warning ({warning.severity.toUpperCase()}):</p>
                        <p style={{ fontSize: 14, marginTop: 4 }}>{warning.message}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {(() => {
                const summary = typeof med.safetyAdviceSummary === "string" ? med.safetyAdviceSummary.trim() : "";
                const pregnancy = typeof med.safetyAdvice?.pregnancy === "string" ? med.safetyAdvice.pregnancy : "";
                const liver = typeof med.safetyAdvice?.liver === "string" ? med.safetyAdvice.liver : "";
                const hasSafety = summary || pregnancy || liver;
                if (!hasSafety) return null;
                return (
                  <div style={{ marginTop: 8, marginBottom: 8, padding: 12, backgroundColor: colors.sky50, border: `1px solid ${colors.sky200}`, borderRadius: 6 }}>
                    <p style={{ fontWeight: 600, color: colors.sky800, marginBottom: 4 }}>Safety advice</p>
                    <p style={{ fontSize: 14, color: colors.sky700, whiteSpace: "pre-line", margin: 0 }}>{summary || [pregnancy, liver].filter(Boolean).join("\n")}</p>
                  </div>
                );
              })()}

              {med.alternatives && med.alternatives.length > 0 && (
                <p style={{ ...textSm, marginTop: 8 }}><strong>Alternatives:</strong> {med.alternatives.join(", ")}</p>
              )}

              {med.marketAlternatives && med.marketAlternatives.length > 0 && (
                <div style={{ marginTop: 12, padding: 8, backgroundColor: colors.gray50, border: `1px solid ${colors.gray200}`, borderRadius: 6 }}>
                  <p style={{ fontWeight: 600, color: colors.gray700, marginBottom: 4 }}>Market Alternatives:</p>
                  <ul style={{ marginLeft: 16, listStyle: "disc", fontSize: 14, color: colors.gray600 }}>
                    {med.marketAlternatives.slice(0, 5).map((alt, aIdx) => (
                      <li key={aIdx}>{alt.name} ({alt.type}){alt.genericName ? ` - Generic: ${alt.genericName}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}

              {data.explanations && data.explanations.length > idx && (
                <div style={{ marginTop: 12, padding: 12, backgroundColor: colors.blue50, border: `1px solid ${colors.blue200}`, borderRadius: 6 }}>
                  <p style={{ fontWeight: 600, color: colors.blue800, marginBottom: 4 }}>Simple Explanation:</p>
                  <p style={{ fontSize: 14, color: colors.blue700, margin: 0 }}>{data.explanations[idx] || "Explanation not available"}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Interactions */}
      {data.interactions && data.interactions.length > 0 && (
        <div>
          <h3 style={{ ...heading, color: colors.red600 }}>Drug Interactions</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            {data.interactions.map((inter, idx) => (
              <div key={idx} style={{ ...card, borderColor: colors.red200, backgroundColor: colors.red50 }}>
                <p style={{ margin: "0 0 4px 0" }}><strong>Medicines:</strong> {inter.medicines.join(" + ")}</p>
                <p style={{ margin: "0 0 4px 0" }}><strong>Severity:</strong> {inter.severity.toUpperCase()}</p>
                <p style={{ margin: 0 }}><strong>Warning:</strong> {inter.warning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ ...card, backgroundColor: colors.yellow50, borderColor: colors.yellow200 }}>
        <h3 style={{ ...heading, color: colors.yellow800 }}>Important Disclaimer</h3>
        <p style={{ color: colors.yellow700, margin: 0 }}>{data.disclaimer}</p>
      </div>
    </div>
  );
}
