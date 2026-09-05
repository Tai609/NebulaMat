import type { InnoClawEvidenceCard, InnoClawSourceEntry } from "@ai4s/shared";

export type InnoClawLiteratureProviderId = "arxiv" | "pubmed" | "semantic-scholar";

export interface InnoClawLiteratureSearchOptions {
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
}

export interface InnoClawLiteratureProvider {
  id: InnoClawLiteratureProviderId;
  search(options: InnoClawLiteratureSearchOptions): Promise<InnoClawEvidenceCard>;
}

export interface InnoClawLiteratureProviderOptions {
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function xmlDecode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function tagText(fragment: string, tag: string): string | undefined {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = fragment.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  return match ? clean(xmlDecode(match[1].replace(/<[^>]+>/g, " "))) : undefined;
}

function chunks(xml: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "gi"))].map((match) => match[1]);
}

function parseAuthors(fragment: string): string[] {
  return chunks(fragment, "author").map((author) => tagText(author, "name") ?? tagText(author, "collectiveName")).filter((name): name is string => Boolean(name));
}

function boundedMax(value: number | undefined): number {
  return Math.max(1, Math.min(50, Math.floor(value ?? 10)));
}

function cardBase(id: string, query: string, sourceFamily: string): InnoClawEvidenceCard {
  return {
    id,
    query,
    sources: [],
    rawExcerpts: [],
    retrievalStatus: "empty",
    sourcesFound: 0,
    sourcesAttempted: 0,
    sourceFamily,
  };
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const forward = () => controller.abort();
  signal?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forward);
    },
  };
}

async function fetchText(
  request: RequestInfo | URL,
  options: InnoClawLiteratureProviderOptions,
  signal?: AbortSignal,
): Promise<string> {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) throw new Error("No fetch implementation is available for literature retrieval");
  const timed = withTimeout(signal, options.timeoutMs ?? 20_000);
  try {
    const response = await fetcher(request, { headers: { accept: "application/xml, application/json" }, signal: timed.signal });
    if (!response.ok) throw new Error(`Literature provider returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    timed.dispose();
  }
}

function providerError(card: InnoClawEvidenceCard, error: unknown): InnoClawEvidenceCard {
  return {
    ...card,
    retrievalStatus: "failed_retrieval",
    retrievalNotes: error instanceof Error ? error.message : String(error),
  };
}

export function createArxivProvider(options: InnoClawLiteratureProviderOptions = {}): InnoClawLiteratureProvider {
  const endpoint = options.endpoint ?? "https://export.arxiv.org/api/query";
  return {
    id: "arxiv",
    async search({ query, maxResults, signal }) {
      const normalized = clean(query);
      const card = cardBase(`arxiv:${Date.now()}:${normalized}`, normalized, "provider:arxiv");
      try {
        const url = new URL(endpoint);
        url.searchParams.set("search_query", `all:${JSON.stringify(normalized)}`);
        url.searchParams.set("start", "0");
        url.searchParams.set("max_results", String(boundedMax(maxResults)));
        const xml = await fetchText(url, options, signal);
        const entries = chunks(xml, "entry");
        card.sourcesAttempted = entries.length;
        entries.forEach((entry) => {
          const id = clean(tagText(entry, "id"));
          const title = clean(tagText(entry, "title"));
          if (!title) return;
          const source: InnoClawSourceEntry = {
            title,
            url: id || undefined,
            authors: parseAuthors(entry),
            year: Number((tagText(entry, "published") ?? "").slice(0, 4)) || undefined,
            venue: "arXiv",
            arxivId: id?.split("/abs/")[1]?.split("v")[0],
          };
          const sourceIndex = card.sources.length;
          card.sources.push(source);
          const excerpt = clean(tagText(entry, "summary")) || title;
          card.rawExcerpts.push({ text: excerpt, sourceIndex, section: "abstract" });
        });
        card.sourcesFound = card.sources.length;
        card.retrievalStatus = card.sourcesFound ? "success" : "empty";
        card.retrievalNotes = `arXiv API returned ${card.sourcesFound} result(s).`;
        return card;
      } catch (error) {
        return providerError(card, error);
      }
    },
  };
}

export function createPubMedProvider(options: InnoClawLiteratureProviderOptions = {}): InnoClawLiteratureProvider {
  const endpoint = options.endpoint ?? "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  return {
    id: "pubmed",
    async search({ query, maxResults, signal }) {
      const normalized = clean(query);
      const card = cardBase(`pubmed:${Date.now()}:${normalized}`, normalized, "provider:pubmed");
      try {
        const limit = boundedMax(maxResults);
        const searchUrl = new URL(`${endpoint}/esearch.fcgi`);
        searchUrl.searchParams.set("db", "pubmed");
        searchUrl.searchParams.set("term", normalized);
        searchUrl.searchParams.set("retmode", "xml");
        searchUrl.searchParams.set("retmax", String(limit));
        const searchXml = await fetchText(searchUrl, options, signal);
        const ids = chunks(searchXml, "IdList").flatMap((group) => chunks(group, "Id").map(clean)).filter(Boolean);
        card.sourcesAttempted = ids.length;
        if (!ids.length) return card;
        const fetchUrl = new URL(`${endpoint}/efetch.fcgi`);
        fetchUrl.searchParams.set("db", "pubmed");
        fetchUrl.searchParams.set("id", ids.join(","));
        fetchUrl.searchParams.set("retmode", "xml");
        const xml = await fetchText(fetchUrl, options, signal);
        chunks(xml, "PubmedArticle").forEach((article) => {
          const title = tagText(article, "ArticleTitle") ?? tagText(article, "Title");
          if (!title) return;
          const pmid = tagText(article, "PMID");
          const abstract = chunks(article, "AbstractText").map((item) => clean(xmlDecode(item.replace(/<[^>]+>/g, " ")))).filter(Boolean).join(" ");
          const doi = article.match(/<ArticleId IdType=["']doi["']>([^<]+)</i)?.[1];
          const sourceIndex = card.sources.length;
          card.sources.push({ title, url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined, pmid, doi, venue: "PubMed" });
          card.rawExcerpts.push({ text: abstract || title, sourceIndex, section: abstract ? "abstract" : "title" });
        });
        card.sourcesFound = card.sources.length;
        card.retrievalStatus = card.sourcesFound ? "success" : "empty";
        card.retrievalNotes = `PubMed API returned ${card.sourcesFound} result(s).`;
        return card;
      } catch (error) {
        return providerError(card, error);
      }
    },
  };
}

export function createSemanticScholarProvider(options: InnoClawLiteratureProviderOptions = {}): InnoClawLiteratureProvider {
  const endpoint = options.endpoint ?? "https://api.semanticscholar.org/graph/v1/paper/search";
  return {
    id: "semantic-scholar",
    async search({ query, maxResults, signal }) {
      const normalized = clean(query);
      const card = cardBase(`semantic-scholar:${Date.now()}:${normalized}`, normalized, "provider:semantic-scholar");
      try {
        const url = new URL(endpoint);
        url.searchParams.set("query", normalized);
        url.searchParams.set("limit", String(boundedMax(maxResults)));
        url.searchParams.set("fields", "title,abstract,authors,year,venue,url,externalIds");
        const json = JSON.parse(await fetchText(url, options, signal)) as { data?: Array<Record<string, unknown>> };
        const entries = Array.isArray(json.data) ? json.data : [];
        card.sourcesAttempted = entries.length;
        entries.forEach((entry) => {
          const title = clean(typeof entry.title === "string" ? entry.title : undefined);
          if (!title) return;
          const ids = entry.externalIds && typeof entry.externalIds === "object" ? entry.externalIds as Record<string, unknown> : {};
          const paperUrl = typeof entry.url === "string" ? entry.url : undefined;
          const source: InnoClawSourceEntry = {
            title,
            url: paperUrl,
            authors: Array.isArray(entry.authors) ? entry.authors.map((author) => author && typeof author === "object" && typeof (author as { name?: unknown }).name === "string" ? (author as { name: string }).name : "").filter(Boolean) : undefined,
            year: typeof entry.year === "number" ? entry.year : undefined,
            venue: typeof entry.venue === "string" ? entry.venue : "Semantic Scholar",
            doi: typeof ids.DOI === "string" ? ids.DOI : undefined,
            arxivId: typeof ids.ArXiv === "string" ? ids.ArXiv : undefined,
          };
          const sourceIndex = card.sources.length;
          card.sources.push(source);
          const abstract = clean(typeof entry.abstract === "string" ? entry.abstract : undefined);
          card.rawExcerpts.push({ text: abstract || title, sourceIndex, section: abstract ? "abstract" : "title" });
        });
        card.sourcesFound = card.sources.length;
        card.retrievalStatus = card.sourcesFound ? "success" : "empty";
        card.retrievalNotes = `Semantic Scholar API returned ${card.sourcesFound} result(s).`;
        return card;
      } catch (error) {
        return providerError(card, error);
      }
    },
  };
}

export function createInnoClawLiteratureProviderRegistry(
  options: InnoClawLiteratureProviderOptions = {},
): Record<InnoClawLiteratureProviderId, InnoClawLiteratureProvider> {
  return {
    arxiv: createArxivProvider(options),
    pubmed: createPubMedProvider(options),
    "semantic-scholar": createSemanticScholarProvider(options),
  };
}
