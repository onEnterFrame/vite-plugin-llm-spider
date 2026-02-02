import type { Plugin } from 'vite'
import type { Page, LaunchOptions } from 'puppeteer'

export interface RouteDef {
  /** URL path (e.g., '/pricing', '/docs/') */
  path: string
  /** Display title in llms.txt */
  title?: string
  /** H2 section grouping in llms.txt */
  section?: string
  /** If true, goes under "## Optional" section */
  optional?: boolean
  /** Appended to link in llms.txt */
  notes?: string
}

export interface CrawlOptions {
  /** Enable BFS crawl mode */
  enabled?: boolean
  /** Starting URLs (default: ['/']) */
  seeds?: string[]
  /** Max link depth to follow (default: 2) */
  maxDepth?: number
  /** Max pages to capture (default: 50) */
  maxPages?: number
  /** Concurrent page loads (default: 3) */
  concurrency?: number
  /** Strip query params from URLs (default: true) */
  stripQuery?: boolean
}

export interface RenderOptions {
  /** Puppeteer waitUntil option (default: 'networkidle2') */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2'
  /** Page load timeout in ms (default: 30000) */
  timeoutMs?: number
  /** Wait for this selector before extracting (recommended for SPAs) */
  waitForSelector?: string | null
  /** Extra delay after load in ms (default: 0) */
  postLoadDelayMs?: number
  /** URL patterns to block (analytics, trackers) */
  blockRequests?: (string | RegExp)[]
  /** Puppeteer launch options */
  launchOptions?: LaunchOptions
  /** Called before page.goto() */
  beforeGoto?: (page: Page, ctx: { route: string }) => Promise<void>
  /** Called before content extraction */
  beforeExtract?: (page: Page, ctx: { route: string }) => Promise<void>
}

export interface ExtractOptions {
  /** CSS selectors for main content (first match wins) */
  mainSelector?: string | string[]
  /** CSS selectors to remove before extraction */
  removeSelectors?: string[]
}

export interface MarkdownOptions {
  /** Add YAML frontmatter with source/title/date (default: true) */
  addFrontmatter?: boolean
  /** Turndown options */
  turndown?: {
    headingStyle?: 'setext' | 'atx'
    codeBlockStyle?: 'indented' | 'fenced'
    emDelimiter?: '_' | '*'
  }
}

export interface OutputOptions {
  /** Output mode: 'sibling' (default) or 'subdir' */
  mode?: 'sibling' | 'subdir'
  /** Subdirectory name when mode='subdir' (default: 'ai') */
  subdir?: string
  /** Index filename (default: 'llms.txt') */
  llmsTxtFileName?: string
  /** H1 title in llms.txt */
  llmsTitle?: string | null
  /** Summary blockquote in llms.txt */
  llmsSummary?: string
  /** Sort pages alphabetically (default: true) */
  sort?: boolean
}

export interface LlmSpiderOptions {
  /** Enable/disable plugin (default: true) */
  enabled?: boolean
  /** Explicit route list (recommended) */
  routes?: RouteDef[]
  /** Crawl mode options (off by default) */
  crawl?: CrawlOptions
  /** URL patterns to exclude */
  exclude?: (string | RegExp)[]
  /** Rendering options */
  render?: RenderOptions
  /** Content extraction options */
  extract?: ExtractOptions
  /** Markdown generation options */
  markdown?: MarkdownOptions
  /** Output options */
  output?: OutputOptions
  /** Log level (default: 'info') */
  logLevel?: 'silent' | 'info' | 'debug'
}

/**
 * Vite plugin that generates LLM-friendly Markdown snapshots
 * and a curated llms.txt index.
 */
export default function llmSpiderPlugin(options?: LlmSpiderOptions): Plugin

export { llmSpiderPlugin }
