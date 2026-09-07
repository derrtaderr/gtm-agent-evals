// HTML-escaping for untrusted event strings (config ids, verdict reasons,
// diff values) injected into the dashboard document. The dashboard renders
// telemetry an agent produced; a reason string carrying "<script>" must be
// inert text, never live markup. Ampersand is replaced first so a following
// replacement's entity (e.g. "&lt;") is not itself re-escaped.

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
