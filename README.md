# Nature Semantic Finder

A local first version of a research-question search tool. It gathers candidate papers from public scholarly metadata sources, optionally includes Springer Nature metadata when an API key is available, and ranks results by conceptual relevance rather than simple keyword matching.

## Run

```sh
python3 server.py
```

When it works, Terminal may look like it is doing nothing. That is normal: leave that Terminal window open so the app keeps running.

Then open:

```text
http://127.0.0.1:4173
```

Do not open `public/index.html` directly. If the browser address starts with `file://`, search will not work.

## Publish With GitHub Pages

This project is set up to publish the `public/` folder with GitHub Pages Actions.

1. Create a new GitHub repository.
2. In Terminal, from this folder, run:

```sh
git init
git add .
git commit -m "Initial Nature Semantic Finder site"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

3. On GitHub, open the repository settings.
4. Go to **Pages**.
5. Under **Build and deployment**, choose **GitHub Actions**.
6. Wait for the **Deploy GitHub Pages** action to finish.

The Pages version is static. It can search public metadata directly from the browser, and it can test a Springer Nature API key from the browser. The local Python server is still better for development and for avoiding browser API/CORS limits.

## Optional Semantic Ranking

The app works without paid services using hybrid metadata ranking. For stronger semantic ranking, enable OpenAI embeddings in the interface and paste an API key. The key is stored only in your browser's local storage and is not written into project files.

## Optional Springer Nature Metadata

If you have a Springer Nature API key, start the app like this:

```sh
SPRINGER_NATURE_API_KEY=your_api_key python3 server.py
```

The app will then add Springer Nature metadata results to the candidate pool. Browser subscription passwords are intentionally not stored or automated by this app.
