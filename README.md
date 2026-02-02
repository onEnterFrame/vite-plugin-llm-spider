# vite-plugin-llm-spider

> **Built by [Happy Alien AI](https://happyalien.ai)** — AI-powered tools for eLearning creators.

A Vite build plugin that generates **LLM-friendly Markdown snapshots** of selected public routes and publishes a curated index at **`/llms.txt`**.

Makes SPAs and content-heavy Vite apps easier for AI agents/tools to understand by providing clean, low-noise text renditions plus a deterministic index.

## Features

- 🕷️ **Two discovery modes:** explicit route list (recommended) or controlled BFS crawl
- 📝 **Markdown output:** clean, readable `.md` files following the [llms.txt spec](https://llmstxt.org/)
- 🧹 **Noise removal:** strips nav, footer, modals, cookie banners, etc.
- 🔒 **Safe by default:** explicit excludes, no auth pages by accident
- ⚡ **Works with any Vite framework:** Vue, React, Svelte, Solid, etc.

## Installation

```bash
npm i -D vite-plugin-llm-spider puppeteer
```

## Quick Start

```js
// vite.config.js
import { defineConfig } from "vite";
import llmSpider from "vite-plugin-llm-spider";

export default defineConfig({
  plugins: [
    llmSpider({
      routes: [
        { path: "/", title: "Home", section: "Product" },
        { path: "/pricing", title: "Pricing", section: "Product" },
        { path: "/docs/", title: "Docs", section: "Docs", optional: true },
      ],
      exclude: ["/login", "/admin", "/account"],
      render: {
        waitForSelector: "main",
      },
    }),
  ],
});
```

After `npm run build`, you'll get:

- `dist/llms.txt` — curated index
- `dist/index.html.md` — home page
- `dist/pricing.md` — pricing page  
- `dist/docs/index.html.md` — docs page

## Output Format

The generated `llms.txt` follows the [llmstxt.org](https://llmstxt.org/) spec:

```markdown
# My Site

> LLM-friendly index of important pages and their Markdown equivalents.

## Product

- [Home](index.html.md)
- [Pricing](pricing.md)

## Optional

- [Docs](docs/index.html.md)
```

## Configuration

### Route Definitions

```js
routes: [
  {
    path: "/pricing",      // URL path (required)
    title: "Pricing",      // Display title in llms.txt
    section: "Product",    // H2 section grouping
    optional: false,       // If true, goes under "## Optional"
    notes: "Updated weekly" // Appended to link in llms.txt
  }
]
```

### Crawl Mode (opt-in)

```js
llmSpider({
  crawl: {
    enabled: true,
    seeds: ["/"],
    maxDepth: 2,
    maxPages: 50,
    concurrency: 3,
  },
  exclude: ["/login", "/admin"],
})
```

### Rendering Options

```js
render: {
  waitUntil: "networkidle2",   // Puppeteer wait strategy
  timeoutMs: 30_000,           // Page load timeout
  waitForSelector: "main",     // Wait for element before extracting
  postLoadDelayMs: 200,        // Extra delay after load
  blockRequests: [             // Block analytics/trackers
    /google-analytics\.com/i,
    /hotjar\.com/i,
  ],
  launchOptions: {             // Puppeteer launch options
    headless: "new",
    args: ["--no-sandbox"],    // For CI/Docker
  },
}
```

### Extraction Options

```js
extract: {
  mainSelector: ["main", "#content", "[data-main]"],  // Content selectors (first match wins)
  removeSelectors: [                                   // Elements to strip
    "nav", "header", "footer", "svg", ".modal", ".cookie-banner"
  ],
}
```

### Output Options

```js
output: {
  mode: "sibling",              // "sibling" (default) or "subdir"
  subdir: "ai",                 // Subdir name when mode="subdir"
  llmsTxtFileName: "llms.txt",  // Index filename
  llmsTitle: "My App",          // H1 title
  llmsSummary: "AI-friendly pages",  // Summary blockquote
  sort: true,                   // Alphabetical ordering
}
```

### Markdown Options

```js
markdown: {
  addFrontmatter: true,  // Add YAML frontmatter with source/title/date
  turndown: {            // Turndown options
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  },
}
```

## URL Mapping

Following the llms.txt spec:

| Route | Output File |
|-------|-------------|
| `/` | `index.html.md` |
| `/pricing` | `pricing.md` |
| `/docs/` | `docs/index.html.md` |
| `/docs/api` | `docs/api.md` |

## Hooks

```js
render: {
  async beforeGoto(page, { route }) {
    // Inject auth token for protected pages (use carefully!)
    await page.evaluate(() => {
      localStorage.setItem("token", "dev-token");
    });
  },
  async beforeExtract(page, { route }) {
    // Custom cleanup before extraction
  },
}
```

## CI/Docker

For headless environments:

```js
render: {
  launchOptions: {
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
}
```

## Troubleshooting

### Timeouts
- Use `waitForSelector: "main"` instead of relying on `networkidle`
- Increase `timeoutMs` or add `postLoadDelayMs`

### Output is mostly nav/footer
- Tighten `mainSelector` to your content wrapper
- Add more `removeSelectors`

### CI fails to launch browser
- Add `--no-sandbox` to launch args
- Ensure Puppeteer dependencies are installed

## License

MIT

---

<p align="center">
  <a href="https://happyalien.ai">
    <strong>Happy Alien AI</strong>
  </a>
  <br>
  AI-powered tools for instructional designers and eLearning teams
</p>
