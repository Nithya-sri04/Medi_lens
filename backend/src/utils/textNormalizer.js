export const normalizeText = (text) => {
  return text
    .toLowerCase()
    .replace(/\b(tab|cap|tablet|capsule)\b/g, "")
    // Preserve dashes for medical patterns like "1-0-1", parentheses for duration like "(5)", but remove other special chars
    .replace(/[^a-z0-9\s\.\-\(\)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
};
