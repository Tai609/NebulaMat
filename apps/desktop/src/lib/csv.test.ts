import { describe, expect, it } from "vitest";
import { parseDelimited, parseTableFile } from "./csv";

describe("parseDelimited", () => {
  it("parses a simple CSV with a header row", () => {
    const t = parseDelimited("a,b,c\n1,2,3\n4,5,6\n", ",");
    expect(t.columns).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
    expect(t.truncated).toBe(false);
  });

  it("handles quoted fields with embedded delimiters, quotes, and newlines", () => {
    const t = parseDelimited('name,note\n"Smith, J","said ""hi""\nand left"\n', ",");
    expect(t.rows).toEqual([["Smith, J", 'said "hi"\nand left']]);
  });

  it("handles CRLF and skips empty trailing lines", () => {
    const t = parseDelimited("a,b\r\n1,2\r\n\r\n", ",");
    expect(t.rows).toEqual([["1", "2"]]);
  });

  it("keeps unquoted commas inside brackets in one field (CSS/JSON values)", () => {
    // Agents often emit dirty CSV where a value like a CSS shadow is not quoted.
    // A comma inside (), [], or {} must not split the field.
    const t = parseDelimited(
      "Category,Token,Value,Usage\nColor,--shadow,0 1px 3px rgba(0,0,0,0.04),Card shadow\n",
      ",",
    );
    expect(t.rows).toEqual([["Color", "--shadow", "0 1px 3px rgba(0,0,0,0.04)", "Card shadow"]]);
  });

  it("normalizes ragged rows to the header width (rectangular table)", () => {
    // Short rows pad with empty cells; a genuinely over-long row folds its
    // surplus into the last column so the layout never explodes.
    const t = parseDelimited("a,b,c\n1\n1,2,3,4,5\n", ",");
    expect(t.rows).toEqual([
      ["1", "", ""],
      ["1", "2", "3,4,5"],
    ]);
  });

  it("truncates beyond maxRows", () => {
    const body = Array.from({ length: 60 }, (_, i) => `${i},x`).join("\n");
    const t = parseDelimited(`n,v\n${body}\n`, ",", 50);
    expect(t.truncated).toBe(true);
    expect(t.rows.length).toBeLessThanOrEqual(50);
  });
});

describe("parseTableFile", () => {
  it("uses tab for .tsv", () => {
    const t = parseTableFile("x.tsv", "a\tb\n1\t2\n");
    expect(t.columns).toEqual(["a", "b"]);
    expect(t.rows).toEqual([["1", "2"]]);
  });
});
