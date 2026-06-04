const form = document.querySelector("#searchForm");
const question = document.querySelector("#question");
const authorFilter = document.querySelector("#authorFilter");
const journalFilter = document.querySelector("#journalFilter");
const fromYear = document.querySelector("#fromYear");
const toYear = document.querySelector("#toYear");
const articleTypeFilter = document.querySelector("#articleTypeFilter");
const openAccessOnly = document.querySelector("#openAccessOnly");
const citationWeight = document.querySelector("#citationWeight");
const citationWeightValue = document.querySelector("#citationWeightValue");
const springerApiKey = document.querySelector("#springerApiKey");
const testSpringerKey = document.querySelector("#testSpringerKey");
const springerKeyStatus = document.querySelector("#springerKeyStatus");
const proxyPrefix = document.querySelector("#proxyPrefix");
const button = document.querySelector("#searchButton");
const results = document.querySelector("#results");
const message = document.querySelector("#message");
const answerPanel = document.querySelector("#answerPanel");
const resultTitle = document.querySelector("#resultTitle");
const candidateCount = document.querySelector("#candidateCount");
const modePill = document.querySelector("#modePill");

if (window.location.protocol === "file:") {
  showMessage("This page was opened as a file, so search cannot work. Start the app in Terminal, leave Terminal open, then open http://127.0.0.1:4173 in your browser.", true);
  message.innerHTML = `This page was opened as a file, so search cannot work. Start the app in Terminal, leave Terminal open, then open <a href="http://127.0.0.1:4173">http://127.0.0.1:4173</a>.`;
  resultTitle.textContent = "Open the local app address";
  button.disabled = true;
}

springerApiKey.value = localStorage.getItem("natureFinderSpringerApiKey") || "";
proxyPrefix.value = localStorage.getItem("natureFinderProxyPrefix") || "";
citationWeightValue.textContent = `${citationWeight.value}%`;

citationWeight.addEventListener("input", () => {
  citationWeightValue.textContent = `${citationWeight.value}%`;
});

springerApiKey.addEventListener("input", () => {
  localStorage.setItem("natureFinderSpringerApiKey", springerApiKey.value.trim());
  setKeyStatus("");
});

testSpringerKey.addEventListener("click", async () => {
  const apiKey = springerApiKey.value.trim();
  if (!apiKey) {
    setKeyStatus("Paste a Springer Nature API key first.", "bad");
    return;
  }

  testSpringerKey.disabled = true;
  testSpringerKey.textContent = "Testing...";
  setKeyStatus("Checking with Springer Nature...");

  try {
    const data = await testSpringerKeyValue(apiKey);
    setKeyStatus(data.message || "Key works.", "ok");
  } catch (error) {
    setKeyStatus(error.message || "The key did not work.", "bad");
  } finally {
    testSpringerKey.disabled = false;
    testSpringerKey.textContent = "Test key";
  }
});

proxyPrefix.addEventListener("input", () => {
  localStorage.setItem("natureFinderProxyPrefix", proxyPrefix.value.trim());
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (window.location.protocol === "file:") {
    showMessage("Search needs the local server. Open http://127.0.0.1:4173 instead of this file.", true);
    return;
  }
  const query = question.value.trim();
  if (!query) {
    showMessage("Type a research question first.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Searching...";
  results.innerHTML = "";
  answerPanel.hidden = true;
  answerPanel.innerHTML = "";
  resultTitle.textContent = "Searching Springer Nature records";
  candidateCount.textContent = "";
  showMessage("Searching Springer Nature metadata, then ranking records by conceptual fit.");

  try {
    const data = await searchArticles(query);

    modePill.textContent = sentenceCase(data.rankingMode);
    resultTitle.textContent = data.results.length ? "Most relevant Nature records" : "No matching Nature records found";
    candidateCount.textContent = `${data.totalCandidates} candidates`;
    const warnings = data.sourceErrors?.length ? ` Some sources reported issues: ${data.sourceErrors.join(" | ")}` : "";
    showMessage(`${sentenceCase(data.rankingMode)} used across Springer Nature metadata and available abstracts. Open article links on nature.com for the publisher experience.${warnings}`, Boolean(data.sourceErrors?.length && !data.results.length));
    renderAnswer(data.answer || buildClientAnswer(query, data.results || []));
    renderResults(data.results);
  } catch (error) {
    resultTitle.textContent = "Search could not complete";
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Search Nature journals";
  }
});

function renderResults(papers) {
  results.innerHTML = "";
  papers.forEach((paper, index) => {
    const card = document.createElement("article");
    card.className = "paper";
    card.id = `article-${index + 1}`;
    const href = applyProxy(paper.url || paper.doi || "#");
    const authors = paper.authors?.length ? paper.authors.join(", ") : "Authors unavailable";
    const date = paper.date || paper.year || "Date unavailable";
    const venue = paper.venue || "Venue unavailable";
    const abstract = paper.abstract ? truncate(paper.abstract, 520) : "No abstract was available from the public metadata source.";
    const natureHref = makeNatureSearchUrl(paper);
    const citations = Number(paper.citationCount || 0);
    const citationText = citations > 0 ? `${citations.toLocaleString()} citations` : "";
    const tags = [...new Set([paper.source, paper.openAccess ? "Open access" : "", paper.articleType || "", citationText, ...paper.concepts.slice(0, 4)].filter(Boolean))];

    card.innerHTML = `
      <div class="paper-top">
        <h3><a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${escapeHtml(paper.title)}</a></h3>
        <div class="score">${Math.round(paper.score * 100)}%</div>
      </div>
      <p class="meta">${escapeHtml(venue)} · ${escapeHtml(String(date))} · ${escapeHtml(authors)}</p>
      <p class="reason">${escapeHtml(paper.relevance || "Ranked as conceptually relevant.")}</p>
      <p class="abstract">${escapeHtml(abstract)}</p>
      <div class="article-actions">
        <a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">Open article</a>
        <a href="${escapeAttribute(natureHref)}" target="_blank" rel="noreferrer">Find on Nature</a>
      </div>
      <div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    `;
    results.append(card);
  });
}

async function searchArticles(query) {
  const payload = {
    query,
    filters: getFilters(),
    springerApiKey: springerApiKey.value.trim(),
    limit: 60
  };

  if (window.location.protocol !== "file:") {
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) return await response.json();
    } catch {
      // GitHub Pages does not run the Python backend, so static mode takes over there.
    }
  }

  return staticSearch(query, payload);
}

async function staticSearch(query, payload) {
  const sourceErrors = [];
  const settled = await Promise.allSettled([
    searchSpringerBrowser(query, payload.limit, payload.springerApiKey)
  ]);
  let papers = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      papers = papers.concat(result.value);
    } else {
      sourceErrors.push(result.reason?.message || "A source could not be reached.");
    }
  }

  const unique = applyFilters(uniqueBy(papers, (paper) => (paper.doi || paper.title || "").toLowerCase()), payload.filters);

  const ranked = rankPapers(query, unique, payload.filters).slice(0, 20);
  return {
    query,
    rankingMode: payload.filters.mode === "keywords" ? "Springer Nature exact-word ranking" : "Springer Nature semantic ranking",
    totalCandidates: unique.length,
    sourceErrors,
    answer: buildClientAnswer(query, ranked),
    results: ranked
  };
}

async function testSpringerKeyValue(apiKey) {
  if (window.location.protocol !== "file:") {
    try {
      const response = await fetch("/api/test-springer-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ springerApiKey: apiKey })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "The key did not work.");
      return data;
    } catch {
      // Static GitHub Pages mode checks directly from the browser.
    }
  }

  return testSpringerKeyBrowser(apiKey);
}

async function testSpringerKeyBrowser(apiKey) {
  const url = new URL("https://api.springernature.com/meta/v2/json");
  url.searchParams.set("q", "Nature");
  url.searchParams.set("p", "1");
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Springer Nature rejected this key.");
    if (response.status === 429) throw new Error("Springer Nature rate-limited the check. Try again later.");
    throw new Error(`Springer Nature returned HTTP ${response.status}.`);
  }
  const data = await response.json();
  const total = Number(data.result?.[0]?.total || data.records?.length || 0);
  return {
    ok: true,
    message: total > 0 ? "Key works. Springer Nature returned metadata." : "Key was accepted, but the test query returned no records."
  };
}

async function searchSpringerBrowser(query, limit, apiKey) {
  if (!apiKey) throw new Error("Add a Springer Nature API key to search live Nature records.");
  const url = new URL("https://api.springernature.com/meta/v2/json");
  url.searchParams.set("q", query);
  url.searchParams.set("p", String(Math.min(limit, 100)));
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Springer Nature returned HTTP ${response.status}.`);
  const data = await response.json();
  return (data.records || []).map(normalizeSpringerBrowser);
}

function normalizeSpringerBrowser(record) {
  const doi = record.doi ? `https://doi.org/${record.doi}` : "";
  const urls = record.url || [];
  const articleUrl = urls.find((entry) => entry.format === "html")?.value || urls[0]?.value || "";
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
    citationCount: Number(record.citationCount || record.citedByCount || record.citedbycount || 0),
    openAccess: String(record.openaccess || "").toLowerCase() === "true",
    articleType: record.articleType || "",
    concepts: [record.subject, record.articleType].filter(Boolean),
    source: "Springer Nature metadata"
  };
}

function rankPapers(query, papers, filters = getFilters()) {
  const queryTokens = new Set(tokenize(filters.mode === "keywords" ? query : `${query} ${expandQueryHints(query)}`));
  return papers.map((paper) => {
    const haystack = `${paper.title} ${paper.abstract} ${paper.venue} ${(paper.concepts || []).join(" ")}`;
    const docTokens = new Set(tokenize(haystack));
    const titleTokens = new Set(tokenize(paper.title));
    const overlap = countOverlap(queryTokens, docTokens);
    const titleOverlap = countOverlap(queryTokens, titleTokens);
    const exactPhrase = String(haystack).toLowerCase().includes(String(query).toLowerCase());
    const abstractDepth = clamp((paper.abstract || "").length / 900, 0, 1);
    const citationSignal = clamp(Math.log10((paper.citationCount || 0) + 1) / 4, 0, 1);
    const recencySignal = paper.year ? clamp((paper.year - 2000) / 26, 0, 1) : 0;
    const natureBoost = 0.15;
    const citationInfluence = clamp(Number(filters.citationWeight || 0) / 100, 0, 1);
    const textScore = filters.mode === "keywords"
      ? clamp(overlap / Math.max(1, queryTokens.size), 0, 1) * 0.68 + (exactPhrase ? 0.22 : 0) + clamp(titleOverlap / Math.max(1, queryTokens.size), 0, 1) * 0.1
      : clamp(overlap / Math.max(8, queryTokens.size), 0, 1) * 0.55 + clamp(titleOverlap / Math.max(3, queryTokens.size), 0, 1) * 0.18;
    const score =
      textScore * (1 - citationInfluence * 0.35) +
      abstractDepth * 0.1 +
      citationSignal * (0.08 + citationInfluence * 0.35) +
      recencySignal * 0.04 +
      natureBoost;
    return {
      ...paper,
      score: Number(clamp(score, 0, 1).toFixed(3)),
      relevance: explainStaticRelevance(queryTokens, paper, filters)
    };
  }).sort((a, b) => b.score - a.score);
}

function explainStaticRelevance(queryTokens, paper, filters = getFilters()) {
  const docTokens = new Set(tokenize(`${paper.title} ${paper.abstract} ${(paper.concepts || []).join(" ")}`));
  const matched = [...queryTokens].filter((token) => docTokens.has(token)).slice(0, 5);
  const reasons = [];
  if (matched.length) reasons.push(`matches concepts around ${matched.join(", ")}`);
  if (filters.mode === "keywords") reasons.push("ranked by exact-word overlap");
  if (paper.abstract) reasons.push("has abstract-level evidence for screening");
  if (Number(paper.citationCount || 0) > 0 && Number(filters.citationWeight || 0) > 0) reasons.push("citation count influenced ranking");
  reasons.push("comes from Springer Nature metadata");
  return reasons.join("; ") || "related by metadata and venue context";
}

function getFilters() {
  return {
    mode: document.querySelector('input[name="searchMode"]:checked')?.value || "semantic",
    author: authorFilter.value.trim(),
    journal: journalFilter.value.trim(),
    fromYear: Number(fromYear.value) || null,
    toYear: Number(toYear.value) || null,
    articleType: articleTypeFilter.value.trim(),
    openAccessOnly: openAccessOnly.checked,
    citationWeight: Number(citationWeight.value) || 0
  };
}

function applyFilters(papers, filters) {
  return papers.filter((paper) => {
    if (filters.author && !(paper.authors || []).some((author) => includesLoose(author, filters.author))) return false;
    if (filters.journal && !includesLoose(paper.venue || "", filters.journal)) return false;
    if (filters.fromYear && (!paper.year || paper.year < filters.fromYear)) return false;
    if (filters.toYear && (!paper.year || paper.year > filters.toYear)) return false;
    if (filters.articleType && !includesLoose(paper.articleType || paper.concepts?.join(" ") || "", filters.articleType)) return false;
    if (filters.openAccessOnly && !paper.openAccess) return false;
    return true;
  });
}

function includesLoose(value, needle) {
  return String(value || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function renderAnswer(answer) {
  if (!answer) {
    answerPanel.hidden = true;
    return;
  }

  const paragraph = buildAnswerParagraph(answer);
  const sources = (answer.sources || []).map((source) => `
    <li>
      <a href="#article-${source.articleIndex}">${escapeHtml(source.label)}</a>
      <span>${escapeHtml(source.title)}</span>
    </li>
  `).join("");

  answerPanel.innerHTML = `
    <div class="answer-heading">
      <p class="eyebrow">Evidence answer</p>
      <h2>Answer from the retrieved articles</h2>
    </div>
    <p class="answer-paragraph">${paragraph}</p>
    ${sources ? `<div class="answer-sources"><h3>Articles used</h3><ol>${sources}</ol></div>` : ""}
    ${answer.note ? `<p class="answer-note">${escapeHtml(answer.note)}</p>` : ""}
  `;
  answerPanel.hidden = false;
}

function buildAnswerParagraph(answer) {
  const points = answer.points || [];
  if (!points.length) {
    return escapeHtml(answer.summary || "I found articles that may be relevant, but the available abstracts did not contain enough direct evidence to draft a reliable answer.");
  }

  const sentences = points.map((point, index) => {
    const lead = index === 0 ? "" : " ";
    return `${lead}${escapeHtml(ensureSentence(point.text))}${renderCitations(point.refs || [], answer.sources || [])}`;
  }).join("");

  const intro = makeAnswerIntro(answer.summary);
  return `${intro}${lowercaseFirstHtml(sentences)}`;
}

function makeAnswerIntro(summary) {
  const value = String(summary || "").trim();
  if (!value || value.includes("several connected findings") || value === "The retrieved research suggests that") {
    return "The retrieved abstracts highlight this evidence: ";
  }
  if (/[.!?]$/.test(value)) return `${escapeHtml(value)} `;
  return `${escapeHtml(value)} `;
}

function ensureSentence(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function lowercaseFirstHtml(html) {
  return html.replace(/^(\s*)([A-Z])/, (_, space, letter) => `${space}${letter.toLowerCase()}`);
}

function buildClientAnswer(query, papers) {
  const evidence = papers
    .slice(0, 8)
    .map((paper, index) => {
      const sentence = bestEvidenceSentence(query, paper);
      return sentence ? {
        articleIndex: index + 1,
        label: makeArticleLabel(index + 1, paper),
        title: paper.title || "Untitled article",
        url: paper.url || paper.doi || "",
        text: sentence
      } : null;
    })
    .filter(Boolean)
    .slice(0, 4);

  if (!evidence.length) {
    return {
      summary: "I found articles that may be relevant, but the available abstracts did not contain enough direct evidence to draft a reliable answer.",
      points: [],
      sources: [],
      note: "Open the articles below for full text, especially if you are signed in to Nature."
    };
  }

  return {
    summary: "The retrieved abstracts highlight this evidence:",
    points: evidence.map((item) => ({
      text: cleanEvidenceSentence(item.text),
      refs: [item.articleIndex]
    })),
    sources: evidence.map((item) => ({
      articleIndex: item.articleIndex,
      label: item.label,
      title: item.title,
      url: item.url
    })),
    note: "This answer is generated from titles, metadata, and available abstracts, not from paywalled full text unless your API access returns it."
  };
}

function bestEvidenceSentence(query, paper) {
  if (!paper.abstract) return "";
  const queryTokens = new Set(tokenize(`${query} ${expandQueryHints(query)}`));
  const sentences = splitSentences(paper.abstract);
  let best = "";
  let bestScore = 0;
  for (const sentence of sentences) {
    const tokens = new Set(tokenize(sentence));
    let overlap = 0;
    for (const token of queryTokens) {
      if (tokens.has(token)) overlap += 1;
    }
    const score = overlap + overlap / Math.max(6, tokens.size);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : sentences[0] || "";
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 340);
}

function tokenize(text) {
  const stopWords = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "are", "was", "were", "been", "have", "has", "does", "did", "can", "could", "should", "would", "may", "might", "what", "when", "where", "which", "why", "how", "about", "after", "before", "between", "within", "using", "used", "use", "than", "their", "there", "these", "those", "also", "more", "most"]);
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function expandQueryHints(query) {
  const lower = query.toLowerCase();
  const hints = [];
  if (lower.includes("microbiome")) hints.push("microbiota gut intestinal flora");
  if (lower.includes("immunotherapy")) hints.push("checkpoint pd-1 pd-l1 ctla-4 immune");
  if (lower.includes("cancer")) hints.push("tumor tumour oncology malignancy");
  if (lower.includes("climate")) hints.push("warming temperature carbon emissions");
  if (lower.includes("genetic")) hints.push("genomic genome variant heritability");
  return hints.join(" ");
}

function cleanEvidenceSentence(sentence) {
  const cleaned = String(sentence || "")
    .replace(/^(we|this study|these results|our results|our findings)\s+/i, "")
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : sentence;
}

function makeArticleLabel(index, paper) {
  const author = paper.authors?.[0] || "";
  const year = paper.year || String(paper.date || "").slice(0, 4);
  if (author && year) return `${author} et al., ${year}`;
  if (year) return `Article ${index}, ${year}`;
  return `Article ${index}`;
}

function renderCitations(refs, sources) {
  return refs.map((ref) => {
    const source = sources.find((item) => item.articleIndex === ref);
    const label = source?.label || `Article ${ref}`;
    return `<a class="citation" href="#article-${ref}" title="${escapeAttribute(label)}">${ref}</a>`;
  }).join("");
}

function abstractFromInvertedIndex(index) {
  if (!index) return "";
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.filter(Boolean).join(" ");
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
  return [
    /\bnature\b/i,
    /\bnature\s+(communications|medicine|biotechnology|genetics|methods|neuroscience|physics|chemistry|immunology|microbiology|materials|energy|climate|ecology|aging|astronomy|electronics|food|plants|water|human behaviour|structural|cancer)\b/i,
    /\bscientific reports\b/i,
    /\bnpj\b/i,
    /\blab animal\b/i
  ].some((pattern) => pattern.test(venue));
}

function countOverlap(left, right) {
  let count = 0;
  for (const item of left) {
    if (right.has(item)) count += 1;
  }
  return count;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function stripTags(text) {
  return String(text).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setKeyStatus(text, state = "") {
  springerKeyStatus.textContent = text;
  springerKeyStatus.classList.toggle("ok", state === "ok");
  springerKeyStatus.classList.toggle("bad", state === "bad");
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1).trim()}...` : text;
}

function sentenceCase(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  const safe = String(value || "#");
  if (!/^https?:\/\//i.test(safe)) return "#";
  return escapeHtml(safe);
}

function applyProxy(url) {
  const safeUrl = String(url || "");
  const prefix = proxyPrefix.value.trim();
  if (!prefix || !/^https?:\/\//i.test(safeUrl) || !/^https?:\/\//i.test(prefix)) return safeUrl;
  return `${prefix}${encodeURIComponent(safeUrl)}`;
}

function makeNatureSearchUrl(paper) {
  const doi = String(paper.doi || "").replace(/^https?:\/\/doi.org\//i, "");
  const query = doi || paper.title || "";
  return `https://www.nature.com/search?q=${encodeURIComponent(query)}`;
}
