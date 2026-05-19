import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const natureVenuePatterns = [
  /\bnature\b/i,
  /\bnature\s+(communications|medicine|biotechnology|genetics|methods|neuroscience|physics|chemistry|immunology|microbiology|materials|energy|climate|ecology|aging|astronomy|electronics|food|plants|water|human behaviour|structural|cancer)\b/i,
  /\bscientific reports\b/i,
  /\bnpj\b/i,
  /\blab animal\b/i
];

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isNatureFamily(paper) {
  const venue = `${paper.venue || ""} ${paper.publisher || ""}`;
  return natureVenuePatterns.some((pattern) => pattern.test(venue));
}

function abstractFromInvertedIndex(index) {
  if (!index) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.filter(Boolean).join(" ");
}

function normalizeOpenAlex(work) {
  const source = work.primary_location?.source || {};
  const authors = (work.authorships || [])
    .slice(0, 6)
    .map((entry) => entry.author?.display_name)
    .filter(Boolean);
  return {
    id: work.doi || work.id,
    title: work.title || work.display_name || "Untitled article",
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
    year: work.publication_year,
    date: work.publication_date,
    venue: source.display_name || "",
    publisher: source.publisher || "",
    doi: work.doi || "",
    url: work.doi || work.primary_location?.landing_page_url || work.id || "",
    authors,
    citationCount: work.cited_by_count || 0,
    openAccess: Boolean(work.open_access?.is_oa),
    concepts: (work.concepts || []).slice(0, 8).map((concept) => concept.display_name).filter(Boolean),
    source: "OpenAlex"
  };
}

function normalizeSemanticScholar(paper) {
  const doi = paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : "";
  return {
    id: paper.paperId || doi || paper.url,
    title: paper.title || "Untitled article",
    abstract: paper.abstract || paper.tldr?.text || "",
    year: paper.year,
    date: paper.publicationDate,
    venue: paper.venue || paper.publicationVenue?.name || "",
    publisher: "",
    doi,
    url: doi || paper.url || paper.openAccessPdf?.url || "",
    authors: (paper.authors || []).slice(0, 6).map((author) => author.name).filter(Boolean),
    citationCount: paper.citationCount || 0,
    openAccess: Boolean(paper.isOpenAccess || paper.openAccessPdf?.url),
    concepts: paper.fieldsOfStudy || [],
    source: "Semantic Scholar"
  };
}

function normalizeSpringer(record) {
  const doi = record.doi ? `https://doi.org/${record.doi}` : "";
  const articleUrl = Array.isArray(record.url)
    ? record.url.find((entry) => entry.format === "html")?.value || record.url[0]?.value
    : "";
  return {
    id: doi || articleUrl || record.identifier || record.title,
    title: record.title || "Untitled article",
    abstract: stripTags(record.abstract || ""),
    year: Number(String(record.publicationDate || "").slice(0, 4)) || undefined,
    date: record.publicationDate || "",
    venue: record.publicationName || "",
    publisher: record.publisher || "Springer Nature",
    doi,
    url: articleUrl || doi,
    authors: (record.creators || []).slice(0, 6).map((creator) => creator.creator).filter(Boolean),
    citationCount: 0,
    openAccess: String(record.openaccess || "").toLowerCase() === "true",
    concepts: [record.subject, record.articleType].filter(Boolean),
    source: "Springer Nature"
  };
}

function stripTags(text) {
  return String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function fallbackRank(query, papers) {
  const queryTokens = tokenize(expandQuery(query));
  const querySet = new Set(queryTokens);
  return papers.map((paper) => {
    const haystack = `${paper.title} ${paper.abstract} ${paper.venue} ${paper.concepts.join(" ")}`;
    const tokens = tokenize(haystack);
    const docSet = new Set(tokens);
    let overlap = 0;
    for (const token of querySet) {
      if (docSet.has(token)) overlap += 1;
    }
    const titleTokens = new Set(tokenize(paper.title));
    let titleOverlap = 0;
    for (const token of querySet) {
      if (titleTokens.has(token)) titleOverlap += 1;
    }
    const abstractDepth = clamp((paper.abstract || "").length / 900, 0, 1);
    const citationSignal = clamp(Math.log10((paper.citationCount || 0) + 1) / 4, 0, 1);
    const recencySignal = paper.year ? clamp((paper.year - 2000) / 26, 0, 1) : 0;
    const natureBoost = isNatureFamily(paper) ? 0.15 : 0;
    const score =
      clamp(overlap / Math.max(8, querySet.size), 0, 1) * 0.55 +
      clamp(titleOverlap / Math.max(3, querySet.size), 0, 1) * 0.18 +
      abstractDepth * 0.1 +
      citationSignal * 0.08 +
      recencySignal * 0.04 +
      natureBoost;
    return { ...paper, score: clamp(score, 0, 1), relevance: explainFallback(querySet, paper) };
  });
}

function explainFallback(querySet, paper) {
  const textTokens = new Set(tokenize(`${paper.title} ${paper.abstract} ${paper.concepts.join(" ")}`));
  const matched = [...querySet].filter((token) => textTokens.has(token)).slice(0, 5);
  const reasons = [];
  if (matched.length) reasons.push(`matches concepts around ${matched.join(", ")}`);
  if (paper.abstract) reasons.push("has abstract-level evidence for screening");
  if (isNatureFamily(paper)) reasons.push("comes from a Nature-family venue");
  if (paper.citationCount > 100) reasons.push("is frequently cited");
  return reasons.join("; ") || "related by metadata and venue context";
}

async function embedTexts(texts, apiKey, model) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "text-embedding-3-small",
      input: texts
    })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${details.slice(0, 200)}`);
  }
  const body = await response.json();
  return body.data.map((item) => item.embedding);
}

function cosine(a, b) {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    left += a[i] * a[i];
    right += b[i] * b[i];
  }
  return dot / (Math.sqrt(left) * Math.sqrt(right) || 1);
}

async function semanticRank(query, papers, apiKey, model) {
  const inputs = [
    query,
    ...papers.map((paper) =>
      [
        paper.title,
        paper.venue,
        paper.concepts.join(", "),
        (paper.abstract || "").slice(0, 2500)
      ].filter(Boolean).join("\n")
    )
  ];
  const embeddings = await embedTexts(inputs, apiKey, model);
  const queryEmbedding = embeddings[0];
  return papers.map((paper, index) => {
    const similarity = cosine(queryEmbedding, embeddings[index + 1]);
    const normalized = (similarity + 1) / 2;
    const citationSignal = clamp(Math.log10((paper.citationCount || 0) + 1) / 5, 0, 1);
    const natureBoost = isNatureFamily(paper) ? 0.06 : 0;
    return {
      ...paper,
      score: clamp(normalized * 0.86 + citationSignal * 0.08 + natureBoost, 0, 1),
      relevance: `semantic similarity to the research question${isNatureFamily(paper) ? "; Nature-family venue" : ""}`
    };
  });
}

async function searchOpenAlex(query, limit) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("select", "id,doi,title,display_name,publication_year,publication_date,authorships,primary_location,abstract_inverted_index,cited_by_count,concepts,open_access,type");
  const response = await fetch(url, { headers: { "user-agent": "nature-semantic-finder/0.1 (mailto:local@example.com)" } });
  if (!response.ok) throw new Error(`OpenAlex failed with ${response.status}`);
  const body = await response.json();
  return (body.results || []).map(normalizeOpenAlex);
}

async function searchSemanticScholar(query, limit) {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("fields", "title,abstract,authors,year,venue,publicationVenue,url,externalIds,citationCount,isOpenAccess,openAccessPdf,publicationDate,tldr,fieldsOfStudy");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Semantic Scholar failed with ${response.status}`);
  const body = await response.json();
  return (body.data || []).map(normalizeSemanticScholar);
}

async function searchSpringerNature(query, limit) {
  const apiKey = process.env.SPRINGER_NATURE_API_KEY || process.env.SPRINGER_API_KEY;
  if (!apiKey) return [];
  const url = new URL("https://api.springernature.com/meta/v2/json");
  url.searchParams.set("q", query);
  url.searchParams.set("p", String(Math.min(limit, 100)));
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Springer Nature failed with ${response.status}`);
  const body = await response.json();
  return (body.records || []).map(normalizeSpringer);
}

async function handleSearch(req, res) {
  let payload = {};
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "Could not read the search request." });
    return;
  }

  const query = String(payload.query || "").trim();
  const limit = clamp(Number(payload.limit || 40), 10, 80);
  const natureOnly = Boolean(payload.natureOnly);
  const apiKey = typeof payload.openAiKey === "string" ? payload.openAiKey.trim() : "";
  const model = typeof payload.embeddingModel === "string" ? payload.embeddingModel.trim() : "";

  if (!query) {
    sendJson(res, 400, { error: "Type a research question first." });
    return;
  }

  const settled = await Promise.allSettled([
    searchSpringerNature(query, limit),
    searchOpenAlex(query, limit),
    searchSemanticScholar(query, Math.min(limit, 50))
  ]);
  const sourceErrors = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason.message);
  const raw = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  let papers = uniqueBy(raw, (paper) => (paper.doi || paper.title).toLowerCase());

  if (natureOnly) {
    papers = papers.filter(isNatureFamily);
  } else {
    papers = papers.sort((a, b) => Number(isNatureFamily(b)) - Number(isNatureFamily(a)));
  }

  let ranked;
  let rankingMode = "hybrid metadata ranking";
  try {
    ranked = apiKey ? await semanticRank(query, papers.slice(0, 60), apiKey, model) : fallbackRank(query, papers);
    if (apiKey) rankingMode = "embedding semantic ranking";
  } catch (error) {
    ranked = fallbackRank(query, papers);
    sourceErrors.push(error.message);
  }

  ranked = ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((paper) => ({ ...paper, score: Number(paper.score.toFixed(3)) }));

  sendJson(res, 200, {
    query,
    rankingMode,
    totalCandidates: papers.length,
    sourceErrors,
    results: ranked
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "POST" && url.pathname === "/api/search") {
    handleSearch(req, res).catch((error) => sendJson(res, 500, { error: error.message }));
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Nature Semantic Finder running at http://${host}:${port}`);
});

const stopWords = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto", "are", "was", "were", "been", "being",
  "have", "has", "had", "does", "did", "can", "could", "should", "would", "may", "might", "what", "when",
  "where", "which", "why", "how", "about", "after", "before", "between", "within", "without", "using",
  "used", "use", "into", "than", "then", "their", "there", "these", "those", "such", "also", "more", "most",
  "less", "least", "over", "under", "per", "via", "our", "your", "its", "his", "her", "they", "them"
]);

const expansionMap = new Map([
  ["cancer", ["tumor", "tumour", "oncology", "malignancy"]],
  ["immunotherapy", ["checkpoint", "pd-1", "pd-l1", "ctla-4", "immune"]],
  ["microbiome", ["microbiota", "gut", "intestinal", "flora"]],
  ["climate", ["warming", "temperature", "carbon", "emissions"]],
  ["genetics", ["genomic", "genome", "variant", "heritability"]],
  ["brain", ["neural", "neuronal", "cortical", "neuroscience"]],
  ["ai", ["artificial intelligence", "machine learning", "deep learning"]],
  ["protein", ["proteomic", "enzyme", "peptide", "structure"]],
  ["cell", ["cellular", "single-cell", "tissue"]],
  ["drug", ["therapeutic", "treatment", "compound", "pharmacological"]]
]);

function expandQuery(query) {
  const tokens = tokenize(query);
  const additions = [];
  for (const token of tokens) {
    if (expansionMap.has(token)) additions.push(...expansionMap.get(token));
  }
  return `${query} ${additions.join(" ")}`;
}
