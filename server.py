from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import json
import math
import os
import re


ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "4173"))

STOP_WORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "onto", "are", "was", "were", "been",
    "being", "have", "has", "had", "does", "did", "can", "could", "should", "would", "may", "might",
    "what", "when", "where", "which", "why", "how", "about", "after", "before", "between", "within",
    "without", "using", "used", "use", "than", "then", "their", "there", "these", "those", "such",
    "also", "more", "most", "less", "least", "over", "under", "per", "via", "our", "your", "its",
    "his", "her", "they", "them"
}

EXPANSIONS = {
    "cancer": ["tumor", "tumour", "oncology", "malignancy"],
    "immunotherapy": ["checkpoint", "pd-1", "pd-l1", "ctla-4", "immune"],
    "microbiome": ["microbiota", "gut", "intestinal", "flora"],
    "climate": ["warming", "temperature", "carbon", "emissions"],
    "genetics": ["genomic", "genome", "variant", "heritability"],
    "brain": ["neural", "neuronal", "cortical", "neuroscience"],
    "ai": ["artificial intelligence", "machine learning", "deep learning"],
    "protein": ["proteomic", "enzyme", "peptide", "structure"],
    "cell": ["cellular", "single-cell", "tissue"],
    "drug": ["therapeutic", "treatment", "compound", "pharmacological"],
}

NATURE_PATTERNS = [
    re.compile(r"\bnature\b", re.I),
    re.compile(r"\bnature\s+(communications|medicine|biotechnology|genetics|methods|neuroscience|physics|chemistry|immunology|microbiology|materials|energy|climate|ecology|aging|astronomy|electronics|food|plants|water|human behaviour|structural|cancer)\b", re.I),
    re.compile(r"\bscientific reports\b", re.I),
    re.compile(r"\bnpj\b", re.I),
    re.compile(r"\blab animal\b", re.I),
]


def tokenize(text):
    words = re.sub(r"[^a-z0-9\s-]", " ", (text or "").lower()).split()
    return [word for word in words if len(word) > 2 and word not in STOP_WORDS]


def expand_query(query):
    additions = []
    for token in tokenize(query):
        additions.extend(EXPANSIONS.get(token, []))
    return f"{query} {' '.join(additions)}"


def clamp(value, low, high):
    return max(low, min(high, value))


def is_nature_family(paper):
    venue = f"{paper.get('venue', '')} {paper.get('publisher', '')}"
    return any(pattern.search(venue) for pattern in NATURE_PATTERNS)


def abstract_from_index(index):
    if not index:
        return ""
    words = {}
    for word, positions in index.items():
        for position in positions:
            words[position] = word
    return " ".join(words[index] for index in sorted(words))


def fetch_json(url, headers=None):
    request = Request(url, headers=headers or {})
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_openalex(work):
    source = ((work.get("primary_location") or {}).get("source") or {})
    authors = [
        ((entry.get("author") or {}).get("display_name"))
        for entry in (work.get("authorships") or [])[:6]
    ]
    return {
        "id": work.get("doi") or work.get("id"),
        "title": work.get("title") or work.get("display_name") or "Untitled article",
        "abstract": abstract_from_index(work.get("abstract_inverted_index")),
        "year": work.get("publication_year"),
        "date": work.get("publication_date"),
        "venue": source.get("display_name") or "",
        "publisher": source.get("publisher") or "",
        "doi": work.get("doi") or "",
        "url": work.get("doi") or ((work.get("primary_location") or {}).get("landing_page_url")) or work.get("id") or "",
        "authors": [author for author in authors if author],
        "citationCount": work.get("cited_by_count") or 0,
        "openAccess": bool((work.get("open_access") or {}).get("is_oa")),
        "concepts": [concept.get("display_name") for concept in (work.get("concepts") or [])[:8] if concept.get("display_name")],
        "source": "OpenAlex",
    }


def search_openalex(query, limit):
    params = urlencode({
        "search": query,
        "per-page": str(limit),
        "select": "id,doi,title,display_name,publication_year,publication_date,authorships,primary_location,abstract_inverted_index,cited_by_count,concepts,open_access,type",
    })
    body = fetch_json(f"https://api.openalex.org/works?{params}", {
        "User-Agent": "nature-semantic-finder/0.1 (mailto:local@example.com)"
    })
    return [normalize_openalex(work) for work in body.get("results", [])]


def normalize_semantic_scholar(paper):
    doi = f"https://doi.org/{paper.get('externalIds', {}).get('DOI')}" if paper.get("externalIds", {}).get("DOI") else ""
    return {
        "id": paper.get("paperId") or doi or paper.get("url"),
        "title": paper.get("title") or "Untitled article",
        "abstract": paper.get("abstract") or (paper.get("tldr") or {}).get("text") or "",
        "year": paper.get("year"),
        "date": paper.get("publicationDate"),
        "venue": paper.get("venue") or (paper.get("publicationVenue") or {}).get("name") or "",
        "publisher": "",
        "doi": doi,
        "url": doi or paper.get("url") or (paper.get("openAccessPdf") or {}).get("url") or "",
        "authors": [author.get("name") for author in (paper.get("authors") or [])[:6] if author.get("name")],
        "citationCount": paper.get("citationCount") or 0,
        "openAccess": bool(paper.get("isOpenAccess") or (paper.get("openAccessPdf") or {}).get("url")),
        "concepts": paper.get("fieldsOfStudy") or [],
        "source": "Semantic Scholar",
    }


def strip_tags(text):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def normalize_springer(record):
    doi = f"https://doi.org/{record.get('doi')}" if record.get("doi") else ""
    urls = record.get("url") or []
    article_url = ""
    if urls:
        html_urls = [entry.get("value") for entry in urls if entry.get("format") == "html"]
        article_url = (html_urls or [urls[0].get("value")])[0] or ""
    return {
        "id": doi or article_url or record.get("identifier") or record.get("title"),
        "title": record.get("title") or "Untitled article",
        "abstract": strip_tags(record.get("abstract") or ""),
        "year": int(str(record.get("publicationDate") or "0")[:4] or 0) or None,
        "date": record.get("publicationDate") or "",
        "venue": record.get("publicationName") or "",
        "publisher": record.get("publisher") or "Springer Nature",
        "doi": doi,
        "url": article_url or doi,
        "authors": [creator.get("creator") for creator in (record.get("creators") or [])[:6] if creator.get("creator")],
        "citationCount": 0,
        "openAccess": str(record.get("openaccess") or "").lower() == "true",
        "concepts": [value for value in (record.get("subject"), record.get("articleType")) if value],
        "source": "Springer Nature",
    }


def search_springer_nature(query, limit, api_key):
    api_key = (api_key or os.environ.get("SPRINGER_NATURE_API_KEY") or os.environ.get("SPRINGER_API_KEY") or "").strip()
    if not api_key:
        raise ValueError("Add a Springer Nature API key to search live Nature records.")
    params = urlencode({
        "q": query,
        "p": str(min(limit, 100)),
        "api_key": api_key,
    })
    body = fetch_json(f"https://api.springernature.com/meta/v2/json?{params}")
    return [normalize_springer(record) for record in body.get("records", [])]


def test_springer_key(api_key):
    api_key = (api_key or "").strip()
    if not api_key:
        return False, "Paste a Springer Nature API key first."
    params = urlencode({
        "q": "Nature",
        "p": "1",
        "api_key": api_key,
    })
    try:
        body = fetch_json(f"https://api.springernature.com/meta/v2/json?{params}")
    except HTTPError as error:
        if error.code in (401, 403):
            return False, "Springer Nature rejected this key."
        if error.code == 429:
            return False, "Springer Nature rate-limited the check. Try again later."
        return False, f"Springer Nature returned HTTP {error.code}."
    except URLError:
        return False, "Could not reach Springer Nature from this server."
    except Exception:
        return False, "The key check failed before Springer Nature returned a usable response."

    try:
        total = int((body.get("result") or [{}])[0].get("total", "0"))
    except (TypeError, ValueError, IndexError):
        total = len(body.get("records") or [])
    if total > 0 or body.get("records"):
        return True, "Key works. Springer Nature returned metadata."
    return True, "Key was accepted, but the test query returned no records."


def search_semantic_scholar(query, limit):
    params = urlencode({
        "query": query,
        "limit": str(limit),
        "fields": "title,abstract,authors,year,venue,publicationVenue,url,externalIds,citationCount,isOpenAccess,openAccessPdf,publicationDate,tldr,fieldsOfStudy",
    })
    body = fetch_json(f"https://api.semanticscholar.org/graph/v1/paper/search?{params}")
    return [normalize_semantic_scholar(paper) for paper in body.get("data", [])]


def rank(query, papers):
    query_tokens = set(tokenize(expand_query(query)))
    ranked = []
    for paper in papers:
        haystack = f"{paper.get('title', '')} {paper.get('abstract', '')} {paper.get('venue', '')} {' '.join(paper.get('concepts', []))}"
        doc_tokens = set(tokenize(haystack))
        title_tokens = set(tokenize(paper.get("title", "")))
        overlap = len(query_tokens & doc_tokens)
        title_overlap = len(query_tokens & title_tokens)
        abstract_depth = clamp(len(paper.get("abstract", "")) / 900, 0, 1)
        citation_signal = clamp(math.log10((paper.get("citationCount") or 0) + 1) / 4, 0, 1)
        recency_signal = clamp(((paper.get("year") or 2000) - 2000) / 26, 0, 1)
        nature_boost = 0.15 if is_nature_family(paper) else 0
        score = (
            clamp(overlap / max(8, len(query_tokens)), 0, 1) * 0.55
            + clamp(title_overlap / max(3, len(query_tokens)), 0, 1) * 0.18
            + abstract_depth * 0.1
            + citation_signal * 0.08
            + recency_signal * 0.04
            + nature_boost
        )
        matched = list(query_tokens & doc_tokens)[:5]
        reasons = []
        if matched:
            reasons.append(f"matches concepts around {', '.join(matched)}")
        if paper.get("abstract"):
            reasons.append("has abstract-level evidence for screening")
        if is_nature_family(paper):
            reasons.append("comes from a Nature-family venue")
        paper = dict(paper)
        paper["score"] = round(clamp(score, 0, 1), 3)
        paper["relevance"] = "; ".join(reasons) or "related by metadata and venue context"
        ranked.append(paper)
    return sorted(ranked, key=lambda item: item["score"], reverse=True)


def split_sentences(text):
    clean = re.sub(r"\s+", " ", text or "").strip()
    if not clean:
        return []
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9])", clean)
    return [sentence.strip() for sentence in sentences if 45 <= len(sentence.strip()) <= 320]


def sentence_score(sentence, query_tokens):
    sentence_tokens = set(tokenize(sentence))
    if not sentence_tokens:
        return 0
    overlap = len(query_tokens & sentence_tokens)
    density = overlap / max(6, len(sentence_tokens))
    return overlap * 0.75 + density


def make_article_label(index, paper):
    author = paper.get("authors", [""])[0] if paper.get("authors") else ""
    year = paper.get("year") or (str(paper.get("date") or "")[:4])
    if author and year:
        return f"{author} et al., {year}"
    if year:
        return f"Article {index}, {year}"
    return f"Article {index}"


def build_answer(query, results):
    evidence = []
    query_tokens = set(tokenize(expand_query(query)))
    for index, paper in enumerate(results[:8], start=1):
        scored = [
            (sentence_score(sentence, query_tokens), sentence)
            for sentence in split_sentences(paper.get("abstract") or "")
        ]
        scored.sort(reverse=True, key=lambda item: item[0])
        if scored and scored[0][0] > 0:
            evidence.append({
                "articleIndex": index,
                "label": make_article_label(index, paper),
                "title": paper.get("title") or "Untitled article",
                "url": paper.get("url") or paper.get("doi") or "",
                "text": scored[0][1],
                "score": scored[0][0],
            })

    if not evidence:
        return {
            "summary": "I found articles that may be relevant, but the available abstracts did not contain enough direct evidence to draft a reliable answer.",
            "points": [],
            "note": "Open the articles below for full text, especially if you are signed in to Nature.",
        }

    evidence.sort(reverse=True, key=lambda item: item["score"])
    top = evidence[:4]
    summary = "Based on the retrieved abstracts, the strongest answer is that the literature points to several connected findings rather than a single definitive result."
    points = [
        {
            "text": paraphrase_evidence(item["text"]),
            "refs": [item["articleIndex"]],
        }
        for item in top
    ]
    return {
        "summary": summary,
        "points": points,
        "sources": [
            {
                "articleIndex": item["articleIndex"],
                "label": item["label"],
                "title": item["title"],
                "url": item["url"],
            }
            for item in top
        ],
        "note": "This answer is generated from titles, metadata, and available abstracts, not from paywalled full text unless your API access returns it.",
    }


def paraphrase_evidence(sentence):
    text = sentence.strip()
    text = re.sub(r"^(we|this study|these results|our results|our findings)\s+", "", text, flags=re.I)
    if not text:
        return sentence.strip()
    return text[0].upper() + text[1:]


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        request_path = urlparse(self.path).path
        if request_path == "/api/test-springer-key":
            self.handle_test_springer_key()
            return
        if request_path != "/api/search":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        query = (payload.get("query") or "").strip()
        if not query:
            self.send_json(400, {"error": "Type a research question first."})
            return

        limit = max(10, min(80, int(payload.get("limit") or 60)))
        springer_api_key = (payload.get("springerApiKey") or "").strip()
        source_errors = []
        papers = []
        try:
            papers.extend(search_springer_nature(query, min(limit, 50), springer_api_key))
        except Exception as error:
            source_errors.append(str(error))

        seen = set()
        unique = []
        for paper in papers:
            key = (paper.get("doi") or paper.get("title") or "").lower()
            if key and key not in seen:
                seen.add(key)
                unique.append(paper)

        results = rank(query, unique)[:20]
        answer = build_answer(query, results)
        self.send_json(200, {
            "query": query,
            "rankingMode": "Springer Nature metadata ranking",
            "totalCandidates": len(unique),
            "sourceErrors": source_errors,
            "answer": answer,
            "results": results,
        })

    def handle_test_springer_key(self):
        length = int(self.headers.get("content-length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_json(400, {"ok": False, "message": "Could not read the key check request."})
            return
        ok, message = test_springer_key(payload.get("springerApiKey") or "")
        self.send_json(200 if ok else 400, {"ok": ok, "message": message})

    def do_GET(self):
        request_path = urlparse(self.path).path
        path = "index.html" if request_path in ("/", "") else request_path.lstrip("/")
        file_path = (PUBLIC / path).resolve()
        if PUBLIC.resolve() not in file_path.parents and file_path != PUBLIC.resolve():
            self.send_error(403)
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
        }.get(file_path.suffix, "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Nature Semantic Finder running at http://{HOST}:{PORT}")
    server.serve_forever()
