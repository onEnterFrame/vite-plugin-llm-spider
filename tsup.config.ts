import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.js'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  external: ['vite', 'puppeteer', 'cheerio', 'turndown', 'turndown-plugin-gfm'],
})
