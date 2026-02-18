export const normalizeText = (text) => {
  return text
    .toLowerCase()
    // DON'T remove prefixes like "tab" and "cap" - they are essential for medicine extraction!
    // .replace(/\b(tab|cap|tablet|capsule)\b/g, "")  // REMOVED
    // Preserve pipes (|) and newlines so prescription lines split correctly, dashes for "1-0-1", parentheses for duration
    .replace(/[^a-z0-9\s\.\-\(\)|]/g, "")
    // Collapse horizontal whitespace (spaces/tabs) but preserve newlines
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
};
