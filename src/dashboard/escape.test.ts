import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escape.js";

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" tag='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; tag=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("neutralizes a script tag so it cannot inject", () => {
    const out = escapeHtml("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes ampersand first so entities are not double-broken", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });

  it("passes ordinary text through unchanged", () => {
    expect(escapeHtml("cfg-outbound-demo")).toBe("cfg-outbound-demo");
  });

  it("coerces non-string input to a string before escaping", () => {
    expect(escapeHtml(42 as unknown as string)).toBe("42");
  });
});
