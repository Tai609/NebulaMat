import { describe, expect, it } from "vitest";
import {
  createArxivProvider,
  createPubMedProvider,
  createSemanticScholarProvider,
} from "./literatureProviders";

function response(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 503, text: async () => body } as Response;
}

describe("InnoClaw literature providers", () => {
  it("normalizes arXiv Atom entries into a source-grounded evidence card", async () => {
    const provider = createArxivProvider({
      fetch: async () => response(`
        <feed>
          <entry>
            <id>https://arxiv.org/abs/2401.00001v2</id>
            <title>  A test paper  </title>
            <published>2024-01-03T00:00:00Z</published>
            <author><name>A. Author</name></author>
            <summary>A bounded result.</summary>
          </entry>
        </feed>`),
    });
    const card = await provider.search({ query: "bounded result", maxResults: 3 });
    expect(card.retrievalStatus).toBe("success");
    expect(card.sources[0]).toMatchObject({ title: "A test paper", arxivId: "2401.00001" });
    expect(card.rawExcerpts[0]).toMatchObject({ text: "A bounded result.", sourceIndex: 0 });
    expect(card.sourceFamily).toBe("provider:arxiv");
  });

  it("uses PubMed esearch IDs and efetch metadata without fabricating abstracts", async () => {
    let calls = 0;
    const provider = createPubMedProvider({
      fetch: async (input) => {
        calls += 1;
        if (String(input).includes("esearch")) return response("<IdList><Id>123</Id></IdList>");
        return response(`
          <PubmedArticleSet><PubmedArticle>
            <MedlineCitation><PMID>123</PMID><Article>
              <ArticleTitle>PubMed paper</ArticleTitle>
              <Abstract><AbstractText Label="BACKGROUND">Observed effect.</AbstractText></Abstract>
            </Article></MedlineCitation>
            <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1/test</ArticleId></ArticleIdList></PubmedData>
          </PubmedArticle>
          </PubmedArticleSet>`);
      },
    });
    const card = await provider.search({ query: "observed effect" });
    expect(calls).toBe(2);
    expect(card.sources[0]).toMatchObject({ title: "PubMed paper", pmid: "123", doi: "10.1/test" });
    expect(card.rawExcerpts[0].text).toContain("Observed effect.");
  });

  it("keeps Semantic Scholar abstracts optional and marks empty responses honestly", async () => {
    const provider = createSemanticScholarProvider({ fetch: async () => response(JSON.stringify({ data: [] })) });
    const card = await provider.search({ query: "no matching paper" });
    expect(card.retrievalStatus).toBe("empty");
    expect(card.sourcesFound).toBe(0);
    expect(card.rawExcerpts).toEqual([]);
  });
});
