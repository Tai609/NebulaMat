import { describe, expect, it } from "vitest";
import { genomeFormat, packRows, parseGenome, type GenomeFeature } from "./genome";

describe("genomeFormat", () => {
  it("maps extensions to formats", () => {
    expect(genomeFormat("bed")).toBe("bed");
    expect(genomeFormat("GFF3")).toBe("gff");
    expect(genomeFormat("gtf")).toBe("gtf");
    expect(genomeFormat("vcf")).toBe("vcf");
    expect(genomeFormat("bedgraph")).toBe("bedgraph");
    expect(genomeFormat("png")).toBeNull();
  });
});

describe("parseGenome", () => {
  it("parses BED (0-based half-open → 1-based inclusive) with name/score/strand", () => {
    const d = parseGenome("chr1\t0\t100\tgeneA\t500\t+\nchr1\t200\t260\tgeneB\t0\t-", "bed");
    expect(d.features).toHaveLength(2);
    expect(d.features[0]).toMatchObject({ chrom: "chr1", start: 1, end: 100, name: "geneA", score: 500, strand: "+" });
    expect(d.features[1]).toMatchObject({ start: 201, end: 260, strand: "-" });
  });

  it("parses GFF3 with type, 1-based coords, and Name from attributes", () => {
    const gff = "##gff-version 3\nchr2\tsrc\tgene\t1000\t2000\t.\t+\t.\tID=g1;Name=BRCA1\n";
    const d = parseGenome(gff, "gff");
    expect(d.features).toHaveLength(1); // header skipped
    expect(d.features[0]).toMatchObject({ chrom: "chr2", start: 1000, end: 2000, type: "gene", strand: "+", name: "BRCA1" });
  });

  it("parses GTF name from gene_name attribute", () => {
    const gtf = 'chr3\tsrc\texon\t5\t50\t.\t-\t.\tgene_id "ENSG1"; gene_name "TP53";\n';
    const d = parseGenome(gtf, "gtf");
    expect(d.features[0]).toMatchObject({ type: "exon", strand: "-", name: "TP53" });
  });

  it("parses VCF (POS 1-based, REF span, ID as name), skipping headers", () => {
    const vcf = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr1\t100\trs1\tACG\tA\t60\tPASS\t.\n";
    const d = parseGenome(vcf, "vcf");
    expect(d.features).toHaveLength(1);
    expect(d.features[0]).toMatchObject({ chrom: "chr1", start: 100, end: 102, name: "rs1", type: "variant", score: 60 });
  });

  it("groups features by contig, busiest first", () => {
    const d = parseGenome("chrX\t0\t10\nchr1\t0\t10\nchr1\t20\t30\nchr1\t40\t50", "bed");
    expect(d.contigs.map((c) => c.name)).toEqual(["chr1", "chrX"]);
    expect(d.contigs[0]).toMatchObject({ name: "chr1", min: 1, max: 50, count: 3 });
  });

  it("skips comments/blank lines and rejects malformed rows", () => {
    const d = parseGenome("# comment\n\nchr1\t0\t10\nchr1\tNaN\tbad\n", "bed");
    expect(d.features).toHaveLength(1);
  });
});

describe("packRows", () => {
  it("puts overlapping features in different rows, disjoint ones in the same row", () => {
    const feats: GenomeFeature[] = [
      { chrom: "c", start: 1, end: 100 },
      { chrom: "c", start: 50, end: 150 }, // overlaps #0 → row 1
      { chrom: "c", start: 200, end: 300 }, // disjoint → reuses row 0
    ];
    const rows = packRows(feats);
    expect(rows[0]).toBe(0);
    expect(rows[1]).toBe(1);
    expect(rows[2]).toBe(0);
  });
});
