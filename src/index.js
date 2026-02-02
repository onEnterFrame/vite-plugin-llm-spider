import { preview } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import puppeteer from "puppeteer";

/**
 * @typedef {{ path: string, title?: string, section?: string, optional?: boolean, notes?: string }} RouteDef
 */

/**
 * Vite Plugin: LLM Spider
 * - Generates Markdown snapshots + dist/llms.txt
 * - Spec-aligned default output: ".md appended" / "index.html.md" for directory URLs.
 */
export default function llmSpiderPlugin(userOptions = {}) {
  /** @type {import('vite').ResolvedConfig | undefined} */
  let resolvedConfig;

  // Deep merge helper
  function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && !(source[key] instanceof RegExp)) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  const defaults = {
    enabled: true,

    // Recommended: explicit list
    routes: /** @type {RouteDef[] | undefined} */ (undefined),

    // Optional crawl mode (off by default)
    crawl: {
      enabled: false,
      seeds: ["/"],
      maxDepth: 2,
      maxPages: 50,
      concurrency: 3,
      stripQuery: true,
    },

    exclude: ["/login", "/admin", "/account"],

    render: {
      waitUntil: "networkidle2", // more forgiving than networkidle0 for SPAs
      timeoutMs: 30_000,
      waitForSelector: null, // e.g. "main" or "#app main"
      postLoadDelayMs: 0,
      blockRequests: [
        /google-analytics\.com/i,
        /googletagmanager\.com/i,
        /segment\.com/i,
        /hotjar\.com/i,
      ],
      launchOptions: {
        headless: "new",
        // For CI containers you may need:
        // args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
      /**
       * @param {import('puppeteer').Page} _page
       * @param {{ route: string }} _ctx
       */
      beforeGoto: async (_page, _ctx) => {},
      /**
       * @param {import('puppeteer').Page} _page
       * @param {{ route: string }} _ctx
       */
      beforeExtract: async (_page, _ctx) => {},
    },

    extract: {
      mainSelector: ["main", "#main-content", "[data-main]"],
      removeSelectors: [
        "script",
        "style",
        "noscript",
        "nav",
        "header",
        "footer",
        "svg",
        "iframe",
        "[role='alert']",
        ".cookie",
        ".cookie-banner",
        ".modal",
      ],
    },

    markdown: {
      addFrontmatter: true,
      turndown: {
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        emDelimiter: "_",
      },
    },

    output: {
      // "sibling" => /pricing -> pricing.md ; /docs/ -> docs/index.html.md ; / -> index.html.md
      mode: "sibling",
      subdir: "ai", // used only when mode === "subdir"
      llmsTxtFileName: "llms.txt",
      llmsTitle: null, // defaults to package name or project dir
      llmsSummary:
        "LLM-friendly index of important pages and their Markdown equivalents.",
      sort: true,
    },

    logLevel: "info", // "silent" | "info" | "debug"
  };

  const options = deepMerge(defaults, userOptions);

  const log = {
    info: (...args) =>
      options.logLevel === "info" || options.logLevel === "debug"
        ? console.log(...args)
        : undefined,
    debug: (...args) =>
      options.logLevel === "debug" ? console.log(...args) : undefined,
    warn: (...args) =>
      options.logLevel !== "silent" ? console.warn(...args) : undefined,
  };

  function isExcluded(route) {
    return (options.exclude || []).some((p) => {
      if (p instanceof RegExp) return p.test(route);
      return route.includes(p);
    });
  }

  function normalizeRoute(input, { stripQuery = true } = {}) {
    if (!input) return null;

    // Ignore non-page links
    if (
      input.startsWith("mailto:") ||
      input.startsWith("tel:") ||
      input.startsWith("javascript:")
    )
      return null;

    // Convert relative -> absolute-ish (we only keep paths)
    // If input is like "./about" or "about", normalize to "/about"
    let s = input.trim();

    // Remove protocol absolute links
    if (s.startsWith("http://") || s.startsWith("https://")) return null;

    // Drop hash/query
    const hashIdx = s.indexOf("#");
    if (hashIdx >= 0) s = s.slice(0, hashIdx);

    if (stripQuery) {
      const qIdx = s.indexOf("?");
      if (qIdx >= 0) s = s.slice(0, qIdx);
    }

    // Ignore empty after stripping
    if (!s) return null;

    // Normalize relative paths
    if (!s.startsWith("/")) {
      if (s.startsWith("./"))
        s = s.slice(1); // "./x" -> "/x"
      else s = "/" + s;
    }

    // Collapse multiple slashes
    s = s.replace(/\/{2,}/g, "/");

    return s;
  }

  function routeToMdWebPath(route) {
    // route is base-relative and starts with "/"
    if (route === "/") return "index.html.md";
    if (route.endsWith("/")) return route.slice(1) + "index.html.md"; // "docs/" -> "docs/index.html.md"
    return route.slice(1) + ".md"; // "pricing" -> "pricing.md"
  }

  function routeToMdFsPath(distDir, route) {
    const rel = routeToMdWebPath(route); // already relative
    if (options.output.mode === "subdir") {
      return path.join(distDir, options.output.subdir, rel);
    }
    return path.join(distDir, rel);
  }

  function makeLlmsLink(relMdPath) {
    // Use relative links (no leading slash) so it works in subpath deployments.
    // If subdir mode: links should include "ai/..."
    return relMdPath.replace(/\\/g, "/");
  }

  async function safeCloseHttpServer(server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return {
    name: "vite-plugin-llm-spider",
    apply: "build",

    configResolved(rc) {
      resolvedConfig = rc;
    },

    async closeBundle() {
      if (!options.enabled) return;
      if (!resolvedConfig)
        throw new Error("LLM Spider: missing resolved Vite config");

      const distDir = resolvedConfig.build.outDir || "dist";
      const basePath = (resolvedConfig.base || "/").replace(/\\/g, "/");

      // ---- Resolve route list ----
      /** @type {RouteDef[]} */
      let routeDefs = [];

      if (Array.isArray(options.routes) && options.routes.length) {
        routeDefs = options.routes.map((r) => ({
          path: normalizeRoute(r.path, { stripQuery: true }) || "/",
          title: r.title,
          section: r.section || "Pages",
          optional: !!r.optional,
          notes: r.notes,
        }));
      } else if (options.crawl?.enabled) {
        // Crawl mode: route defs will be created as discovered.
        routeDefs = [];
      } else {
        // Default minimal route
        routeDefs = [{ path: "/", section: "Pages" }];
      }

      log.info("\nLLM Spider: generating markdown + llms.txt");
      log.debug("distDir:", distDir, "base:", basePath);

      // ---- Start preview server for built output ----
      // Vite preview API returns a PreviewServer with httpServer + resolvedUrls.
      const previewServer = await preview({
        root: resolvedConfig.root,
        base: resolvedConfig.base,
        build: { outDir: distDir },
        preview: { port: 0, open: false, host: '127.0.0.1' },
        configFile: false,
        plugins: [], // avoid loading user plugins again
        logLevel: "silent",
      });

      // Wait for server to be fully listening
      await new Promise((resolve, reject) => {
        const server = previewServer.httpServer;
        if (server.listening) {
          resolve();
        } else {
          server.once('listening', resolve);
          server.once('error', reject);
          // Timeout after 5s
          setTimeout(() => reject(new Error('Preview server failed to start')), 5000);
        }
      });

      const addr = previewServer.httpServer.address();
      if (!addr || typeof addr === "string") {
        await safeCloseHttpServer(previewServer.httpServer);
        throw new Error("LLM Spider: could not determine preview server port");
      }

      // Build a base URL that respects Vite's base path
      // Example: http://127.0.0.1:4173/app/  (if base="/app/")
      const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
      const baseUrl = `http://127.0.0.1:${addr.port}${normalizedBase}`;
      
      log.debug("Preview server at:", baseUrl);

      const browser = await puppeteer.launch(options.render.launchOptions);
      const turndown = new TurndownService(options.markdown.turndown);
      turndown.use(gfm);

      /** @type {Set<string>} */
      const visited = new Set();

      /** @type {{ route: string, title?: string, section: string, optional: boolean, notes?: string, mdRelPath: string }[]} */
      const captured = [];

      // Crawl queue stores base-relative routes (no base prefix)
      /** @type {{ route: string, depth: number }[]} */
      const queue = [];

      // Seed queue
      if (options.crawl?.enabled) {
        for (const seed of options.crawl.seeds || ["/"]) {
          const nr = normalizeRoute(seed, {
            stripQuery: options.crawl.stripQuery,
          });
          if (nr) queue.push({ route: nr, depth: 0 });
        }
      } else {
        for (const rd of routeDefs) queue.push({ route: rd.path, depth: 0 });
      }

      const maxDepth = options.crawl?.enabled ? options.crawl.maxDepth : 0;
      const maxPages = options.crawl?.enabled
        ? options.crawl.maxPages
        : queue.length;
      const concurrency = options.crawl?.enabled
        ? options.crawl.concurrency
        : 3;

      async function captureOne(route) {
        if (visited.has(route)) return;
        if (isExcluded(route)) return;
        if (captured.length >= maxPages) return;

        visited.add(route);

        const page = await browser.newPage();

        // Request blocking (best effort)
        if (options.render.blockRequests?.length) {
          await page.setRequestInterception(true);
          page.on("request", (req) => {
            const url = req.url();
            const blocked = options.render.blockRequests.some((p) =>
              p instanceof RegExp ? p.test(url) : url.includes(p),
            );
            if (blocked) req.abort();
            else req.continue();
          });
        }

        try {
          const pageUrl =
            route === "/" ? baseUrl : baseUrl + route.replace(/^\//, "");
          await options.render.beforeGoto(page, { route });

          await page.goto(pageUrl, {
            waitUntil: options.render.waitUntil,
            timeout: options.render.timeoutMs,
          });

          if (options.render.waitForSelector) {
            await page.waitForSelector(options.render.waitForSelector, {
              timeout: options.render.timeoutMs,
            });
          }

          if (options.render.postLoadDelayMs > 0) {
            await new Promise((r) =>
              setTimeout(r, options.render.postLoadDelayMs),
            );
          }

          await options.render.beforeExtract(page, { route });

          const html = await page.content();
          const $ = cheerio.load(html);

          // Remove noisy elements (CSS selectors)
          for (const sel of options.extract.removeSelectors || [])
            $(sel).remove();

          // Pick main content
          const mainSelectors = Array.isArray(options.extract.mainSelector)
            ? options.extract.mainSelector
            : [options.extract.mainSelector];

          let mainHtml = null;
          for (const sel of mainSelectors) {
            if (!sel) continue;
            const node = $(sel).first();
            if (node && node.length) {
              mainHtml = node.html();
              break;
            }
          }
          if (!mainHtml) {
            const main = $("main").first();
            mainHtml = main.length ? main.html() : $("body").html();
          }

          const title = ($("title").text() || "").trim() || route;

          // Convert to Markdown
          const markdownBody = turndown.turndown(mainHtml || "");

          // Write file
          const mdRelPath =
            options.output.mode === "subdir"
              ? path.posix.join(options.output.subdir, routeToMdWebPath(route))
              : routeToMdWebPath(route);

          const fsPath = routeToMdFsPath(distDir, route);
          await fs.mkdir(path.dirname(fsPath), { recursive: true });

          const frontmatter = options.markdown.addFrontmatter
            ? `---\nsource: ${route}\ntitle: ${title}\ngenerated_at: ${new Date().toISOString()}\n---\n\n`
            : "";

          await fs.writeFile(fsPath, frontmatter + markdownBody, "utf8");

          // Map metadata
          const meta = routeDefs.find((r) => r.path === route);
          captured.push({
            route,
            title: meta?.title || title,
            section: meta?.section || "Pages",
            optional: !!meta?.optional,
            notes: meta?.notes,
            mdRelPath,
          });

          log.info(`  ✅ ${route} -> ${mdRelPath}`);

          // Harvest links (crawl mode only)
          if (options.crawl?.enabled) {
            const hrefs = $("a[href]")
              .map((_, a) => $(a).attr("href"))
              .get();

            for (const href of hrefs) {
              const n = normalizeRoute(href, {
                stripQuery: options.crawl.stripQuery,
              });
              if (!n) continue;

              // If site is deployed under a base like "/app/", router-links usually include "/app/..."
              // Strip base prefix when present so our internal route stays base-relative.
              let baseRelative = n;
              if (
                normalizedBase !== "/" &&
                baseRelative.startsWith(normalizedBase)
              ) {
                baseRelative = "/" + baseRelative.slice(normalizedBase.length);
                baseRelative =
                  baseRelative === "//"
                    ? "/"
                    : baseRelative.replace(/\/{2,}/g, "/");
              }

              if (!visited.has(baseRelative) && !isExcluded(baseRelative)) {
                // Depth tracking is handled by the outer loop (we store depth in queue entries)
                // so just push; caller will attach depth.
                queue.push({ route: baseRelative, depth: -1 }); // placeholder depth; will be overwritten
              }
            }
          }
        } catch (err) {
          log.warn(`  ⚠️  failed ${route}: ${err?.message || err}`);
        } finally {
          await page.close();
        }
      }

      try {
        // BFS: process queue in batches
        while (queue.length && captured.length < maxPages) {
          // Fix up crawl depths if needed
          // If we're in crawl mode, queue items may have depth=-1 from harvested links.
          // We'll conservatively treat them as depth=1 unless they were explicitly set.
          const batch = queue.splice(0, concurrency).map((item) => {
            const depth = item.depth >= 0 ? item.depth : 1;
            return { route: item.route, depth };
          });

          await Promise.all(
            batch.map(async ({ route, depth }) => {
              if (options.crawl?.enabled && depth > maxDepth) return;
              await captureOne(route);

              // If crawl mode, increase depth for any newly harvested links
              if (options.crawl?.enabled) {
                // Patch any depth=-1 entries added during captureOne
                for (let i = 0; i < queue.length; i++) {
                  if (queue[i].depth === -1) queue[i].depth = depth + 1;
                }
              }
            }),
          );
        }

        // ---- Generate llms.txt ----
        const llmsTitle =
          options.output.llmsTitle || resolvedConfig?.env?.mode || "Site";

        // Deterministic ordering
        const items = options.output.sort
          ? [...captured].sort((a, b) => a.route.localeCompare(b.route))
          : captured;

        // Group by section, with Optional special handling
        /** @type {Map<string, typeof items>} */
        const bySection = new Map();
        /** @type {typeof items} */
        const optionalItems = [];

        for (const item of items) {
          if (item.optional) optionalItems.push(item);
          else {
            const s = item.section || "Pages";
            bySection.set(s, [...(bySection.get(s) || []), item]);
          }
        }

        let llms = `# ${llmsTitle}\n\n> ${options.output.llmsSummary}\n\n`;

        for (const [section, sectionItems] of bySection.entries()) {
          llms += `## ${section}\n\n`;
          for (const it of sectionItems) {
            const link = makeLlmsLink(it.mdRelPath);
            const label = it.title || it.route;
            const notes = it.notes ? `: ${it.notes}` : "";
            llms += `- [${label}](${link})${notes}\n`;
          }
          llms += `\n`;
        }

        if (optionalItems.length) {
          llms += `## Optional\n\n`;
          for (const it of optionalItems) {
            const link = makeLlmsLink(it.mdRelPath);
            const label = it.title || it.route;
            const notes = it.notes ? `: ${it.notes}` : "";
            llms += `- [${label}](${link})${notes}\n`;
          }
          llms += `\n`;
        }

        const llmsPath = path.join(distDir, options.output.llmsTxtFileName);
        await fs.writeFile(llmsPath, llms, "utf8");

        log.info(
          `\nLLM Spider: wrote ${captured.length} markdown pages + ${options.output.llmsTxtFileName}\n`,
        );
      } finally {
        await browser.close();
        await safeCloseHttpServer(previewServer.httpServer);
      }
    },
  };
}
