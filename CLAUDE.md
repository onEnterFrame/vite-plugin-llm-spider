# CLAUDE.md

Vite plugin that generates LLM context files (llm.txt, CONTEXT.md) during build for AI-optimized documentation.

## Installation

```bash
npm install vite-plugin-llm-spider
```

## Usage

```javascript
// vite.config.js
import { llmSpider } from 'vite-plugin-llm-spider'

export default {
  plugins: [
    llmSpider({
      // options
    })
  ]
}
```

## Generated Files

- `llm.txt` - Structured context file for LLMs
- `CONTEXT.md` - Human-readable version
- `llm-context.json` - Machine-readable JSON

## Options

```javascript
llmSpider({
  outDir: 'dist',           // Output directory
  include: ['**/*.md'],     // Files to include
  exclude: ['node_modules'],// Files to exclude
  sitemap: true,            // Generate sitemap
  maxSize: 100000,          // Max output size
})
```

## Why LLM SEO?

Traditional SEO optimizes for search engines. LLM SEO (GEO - Generative Engine Optimization) optimizes for AI systems that read and summarize your content.

## Published

Available on npm as `vite-plugin-llm-spider`.
