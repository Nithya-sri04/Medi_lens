"use client";

/**
 * Global error boundary. Required by Next.js App Router;
 * defining it explicitly fixes the React Client Manifest resolution with Next 16 + Turbopack.
 * This replaces the root layout when active, so it must include <html> and <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, margin: 0 }}>
        <h1 style={{ color: "#b91c1c", marginBottom: 16 }}>Something went wrong</h1>
        <p style={{ color: "#374151", marginBottom: 24 }}>{error.message}</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            padding: "8px 16px",
            backgroundColor: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
