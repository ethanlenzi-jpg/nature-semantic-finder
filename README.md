# Nature.com Semantic Search Prototype

A proposal prototype for a semantic search layer on nature.com. It searches Springer Nature metadata, ranks article records by conceptual relevance to a research question, and generates an evidence-linked answer from available abstracts.

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

## Springer Nature Metadata

If you have a Springer Nature API key, start the app like this:

```sh
SPRINGER_NATURE_API_KEY=your_api_key python3 server.py
```

The app uses Springer Nature metadata only. Browser subscription passwords are intentionally not stored or automated by this app.
