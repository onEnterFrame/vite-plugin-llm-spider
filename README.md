# vite-plugin-llm-spider

> Make your Vite SPA discoverable by AI search engines like ChatGPT, Perplexity, and Google AI Overviews

**Single Page Apps are invisible to AI.** While tools like ChatGPT, Claude, and Perplexity reshape how people find information, SPAs remain hidden behind JavaScript walls. This plugin bridges that gap by generating clean, LLM-friendly markdown snapshots and a standardized index.

- 🤖 **Zero-click optimization** — Get cited in AI answers without complex SSR
- 📈 **LLM SEO / GEO ready** — Clean markdown format that LLMs prefer
- 🎯 **[llms.txt standard](https://llmstxt.org/)** — Machine-readable index for AI agents

> **Built by [Happy Alien AI](https://happyalien.ai)** — We take the busy work out of training development.

## Why This Matters

Traditional SEO optimizes for Google's crawler. **Generative Engine Optimization (GEO)** optimizes for AI systems that synthesize answers from your content. When someone asks ChatGPT or Perplexity a question your site answers, you want to be cited.

SPAs render content via JavaScript — invisible to most AI crawlers. This plugin runs Puppeteer at build time to capture your rendered pages as clean markdown, plus generates an `llms.txt` index that tells AI agents exactly where to look.

## Features

- 🕷️ **Two discovery modes:** explicit route list (recommended) or controlled BFS crawl
- 📝 **Markdown output:** clean, readable `.md` files following the [llms.txt spec](https://llmstxt.org/)
- 🧹 **Noise removal:** strips nav, footer, modals, cookie banners, etc.
- 🔒 **Safe by default:** explicit excludes, no auth pages by accident
- ⚡ **Works with any Vite framework:** Vue, React, Svelte, Solid, etc.

## Installation

```bash
npm i -D @happyalienai/vite-plugin-llm-spider
```

## Quick Start

The plugin auto-discovers your pages by crawling from the root — no configuration needed:

```js
// vite.config.js
import { defineConfig } from "vite";
import llmSpider from "@happyalienai/vite-plugin-llm-spider";

export default defineConfig({
  plugins: [
    llmSpider(),  // That's it! Crawl is enabled by default
  ],
});
```

After `npm run build`, you'll get:

- `dist/llms.txt` — auto-generated index of all discovered pages
- `dist/*.md` — markdown snapshot for each page

### Customize defaults

```js
llmSpider({
  exclude: ["/login", "/admin", "/account"],  // Skip sensitive pages
  crawl: {
    maxDepth: 3,    // How deep to follow links (default: 2)
    maxPages: 100,  // Max pages to capture (default: 50)
  },
  render: {
    waitForSelector: "main",  // Wait for content before extracting
  },
})
```

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

### Static Mode (No Browser Required)

For pre-rendered/SSG sites, you can skip Puppeteer entirely and read HTML files directly:

```js
llmSpider({
  static: true,  // Read from dist/ without browser
  routes: [      // Required when using static mode
    { path: "/", title: "Home" },
    { path: "/about", title: "About" },
  ],
  crawl: { enabled: false },
})
```

Options:
- `true` — Always read HTML files directly (no browser)
- `false` — Always use Puppeteer (required for SPAs that need JS rendering)
- `"auto"` (default) — Use static when crawl is disabled, browser when crawl is enabled

Static mode is ideal for CI environments without Chrome (WSL, Docker, etc.).

### Explicit Routes (Advanced)

For precise control over which pages to include (disables crawl):

```js
llmSpider({
  routes: [
    {
      path: "/pricing",      // URL path (required)
      title: "Pricing",      // Display title in llms.txt
      section: "Product",    // H2 section grouping
      optional: false,       // If true, goes under "## Optional"
      notes: "Updated weekly" // Appended to link in llms.txt
    }
  ],
  crawl: { enabled: false },  // Disable crawl when using explicit routes
})
```

Use explicit routes when you want curated control over your llms.txt index rather than auto-discovery.

### Crawl Options

Crawl is enabled by default. Customize the behavior:

```js
llmSpider({
  crawl: {
    enabled: true,       // Disable with `false` if using explicit routes
    seeds: ["/"],        // Starting URLs
    maxDepth: 2,         // Link depth from seeds
    maxPages: 50,        // Cap on total pages
    concurrency: 3,      // Parallel page loads
    stripQuery: true,    // Ignore ?query params
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
- **Easiest fix:** Use `static: true` if you don't need JS rendering
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
  We take the busy work out of training development.
</p>
