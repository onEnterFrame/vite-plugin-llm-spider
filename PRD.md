## PRD: `vite-plugin-llm-spider`

### 1) Summary

A Vite build plugin that generates **LLM-friendly Markdown snapshots** of selected public routes and publishes a curated index at **`/llms.txt`**. The Markdown endpoints follow the **".md appended to the same URL"** convention (and for directory-like URLs, use `index.html.md`). ([llms-txt][1])

Primary use: make SPAs and content-heavy Vite apps easier for AI agents/tools to understand by providing clean, low-noise text renditions plus a deterministic index.

---

### 2) Problem

Vite SPAs often:

- Render most content via JS hydration
- Include nav/footers/menus/popup noise
- Are difficult to crawl deterministically (dynamic routes, polling, auth)

Agents can't reliably extract "main content" from HTML, and "crawl everything" tends to explode or capture garbage.

---

### 3) Goals

**G1.** Generate Markdown renditions of key public pages at build time (post-bundle).
**G2.** Generate `dist/llms.txt` in the spec format (H1 + summary + file lists, with optional sections). ([llms-txt][1])
**G3.** Work on any Vite app (Vue/React/Svelte/etc.) without requiring SSR.
**G4.** Provide two discovery approaches:

- Recommended: explicit route list (deterministic, safe)
- Optional: controlled crawl (BFS, depth/limit/excludes)

**G5.** Be safe-by-default (avoid accidentally exporting private/auth pages).

---

### 4) Non-goals

- Crawling authenticated dashboards by default
- Automatically solving param routes (`/course/:id`) without user input
- Becoming an SEO feature (sitemaps remain opt-in)
- Training or scraping third-party content

---

### 5) Primary users

- **Developers shipping Vite SPAs** who want AI-readable docs/marketing/help pages.
- **AI-agent tooling / RAG pipelines** that want a stable entry point (`/llms.txt`) and clean text pages.

---

### 6) User stories

1. As a developer, after `vite build`, I want `dist/llms.txt` and `*.md` pages generated automatically.
2. As a developer, I want to exclude `/admin`, `/login`, `/account`, etc.
3. As a developer, I want to define "main content" selector(s) so output isn't 80% navigation.
4. As an agent, I want a curated list of the important pages, not every URL on the site. ([llms-txt][1])

---

### 7) Functional requirements

#### FR1 — Build hook & execution timing

- Plugin runs only on `vite build`
- Executes in `closeBundle()` (post output generation) ([vitejs][2])

#### FR2 — Page selection modes

- **Mode A (recommended):** `routes: [{ path, title, section, optional, notes }]`
- **Mode B (optional):** crawl with BFS:
  - seeds (default `/`)
  - maxDepth
  - maxPages
  - concurrency
  - exclude patterns

#### FR3 — Rendering

- Start a local server serving the built `outDir` (via Vite `preview()` API). ([vitejs][3])
- Use headless browser (Puppeteer) to visit each route and capture HTML after it settles.
- Configurable:
  - `waitUntil` (`networkidle2` default)
  - `timeoutMs`
  - `waitForSelector` (strongly recommended for SPAs)
  - `postLoadDelayMs`
  - request blocking (analytics, trackers)

#### FR4 — Extraction & cleanup

- Remove noisy elements before conversion using **CSS selectors** (Cheerio).
- Extract main content via `mainSelector` list; fallback to `main`, then `body`.

#### FR5 — Conversion

- Convert cleaned HTML → Markdown using Turndown.
- Do not rely on Turndown for CSS selector removal; its remove/keep filters are tag/function based. ([GitHub][4])

#### FR6 — Output URL strategy (spec-aligned)

Default output mode: **"sibling"**

- `/pricing` → `pricing.md`
- `/docs/` → `docs/index.html.md`
- `/` → `index.html.md`
  This matches the "append `.md` (or `index.html.md`)" convention. ([llms-txt][1])

Also support **"subdir"** output (e.g. `ai/…`) as an option for teams who want isolation.

#### FR7 — `llms.txt` generation

Generate `dist/llms.txt`:

- H1 title (required)
- blockquote summary
- H2 sections with Markdown lists (deterministic ordering)
- special `## Optional` section support ([llms-txt][1])

Use **relative links** inside `llms.txt` (no leading `/`) so it works in subpath deployments.

#### FR8 — Determinism & safety

- Stable ordering independent of concurrency
- URL normalization:
  - strip `#hash`
  - optionally strip `?query` (default yes)
  - normalize trailing slashes

- Max pages cutoff
- Skip non-HTML routes (assets, PDFs, mailto, tel, etc.)

---

### 8) Non-functional requirements

- **Performance:** concurrency controls; avoid exploding memory.
- **Reliability:** timeouts + continue-on-error (don't fail entire build unless configured).
- **Security:** never export private routes by default; make "crawl mode" opt-in and conservative.
- **CI compatibility:** provide `enabled` flag and Puppeteer launch args override (no-sandbox).

---

### 9) Output artifacts

- `dist/llms.txt`
- `dist/**/*.md` (spec-aligned paths)
- optional:
  - `dist/agents.txt` (format TBD; not default)
  - `dist/sitemap-llms.xml` (opt-in only)

---

### 10) Risks & mitigations

- **Apps that never go idle:** default to `networkidle2`, allow `waitForSelector`, add post-load delay.
- **Accidentally hitting prod APIs during crawl:** request blocking + hooks to rewrite/abort requests.
- **Duplicate/looping URLs:** normalization + maxPages + exclude patterns.
- **Auth-only content renders empty:** explicitly out of scope; provide hooks to inject cookies/tokens if user insists.

---

### 11) Milestones

1. MVP (explicit routes only + sibling output + llms.txt)
2. Crawl mode (BFS + limits + excludes)
3. Request blocking + before/after hooks
4. Optional sitemap output
5. CI hardened docs + examples repo

---

### 12) Acceptance criteria (Definition of Done)

After `npm run build`:

- `dist/llms.txt` exists and follows the H1 + summary + file list structure ([llms-txt][1])
- Markdown files exist for each configured route (correct mapping for `/` and directory routes)
- Build does not re-run itself or recurse
- Output ordering is stable across runs
- Excluded routes are not generated

---

[1]: https://llmstxt.org/ "The /llms.txt file – llms-txt"
[2]: https://vite.dev/guide/api-plugin "Plugin API | Vite"
[3]: https://vite.dev/guide/api-javascript "JavaScript API | Vite"
[4]: https://github.com/mixmark-io/turndown "GitHub - mixmark-io/turndown"
