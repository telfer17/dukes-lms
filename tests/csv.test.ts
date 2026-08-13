import { describe, expect, it } from "vitest";
import { csvSafeText, toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("writes a header row and plain values unquoted", () => {
    expect(toCsv(["a", "b"], [["1", "2"]])).toBe("a,b\r\n1,2");
  });

  it("quotes a field containing a comma", () => {
    expect(toCsv(["x"], [["a,b"]])).toBe('x\r\n"a,b"');
  });

  it("quotes and doubles an inner double-quote", () => {
    expect(toCsv(["x"], [['he said "hi"']])).toBe('x\r\n"he said ""hi"""');
  });

  it("quotes a field containing a newline", () => {
    expect(toCsv(["x"], [["line1\nline2"]])).toBe('x\r\n"line1\nline2"');
  });

  it("renders null and undefined as empty", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,");
  });

  it("preserves a phone number's leading zero verbatim", () => {
    expect(toCsv(["phone"], [["07700900000"]])).toBe("phone\r\n07700900000");
  });

  it("renders numbers and booleans", () => {
    expect(toCsv(["n", "b"], [[72, true]])).toBe("n,b\r\n72,true");
  });
});

describe("csvSafeText", () => {
  it("neutralises spreadsheet formula triggers with a leading quote", () => {
    expect(csvSafeText("=1+1")).toBe("'=1+1");
    expect(csvSafeText("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvSafeText("-2")).toBe("'-2");
    expect(csvSafeText("@cmd")).toBe("'@cmd");
  });

  it("leaves ordinary text and empty values untouched", () => {
    expect(csvSafeText("John Smith")).toBe("John Smith");
    expect(csvSafeText(null)).toBe("");
    expect(csvSafeText("")).toBe("");
  });
});
