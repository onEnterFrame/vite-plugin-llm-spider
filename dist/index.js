// src/index.js
import { preview } from "vite";
import fs from "fs/promises";
import path from "path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
var puppeteer = null;
async function loadPuppeteer() {
  if (!puppeteer) {
    puppeteer = await import("puppeteer");
  }
  return puppeteer.default || puppeteer;
}
function llmSpiderPlugin(userOptions = {}) {
  let resolvedConfig;
  function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) && !(source[key] instanceof RegExp)) {
        result[key] = deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
  const defaults = {
    enabled: true,
    // Static mode: read HTML files directly from dist/ without browser
    // - true: always use static mode (no Puppeteer)
    // - false: always use browser rendering
    // - "auto" (default): use static when crawl is disabled, browser when crawl is enabled
    static: "auto",
    // Recommended: explicit list
    routes: (
      /** @type {RouteDef[] | undefined} */
      void 0
    ),
    // Optional crawl mode (off by default)
    crawl: {
      enabled: false,
      seeds: ["/"],
      maxDepth: 2,
      maxPages: 50,
      concurrency: 3,
      stripQuery: true
    },
    exclude: ["/login", "/admin", "/account"],
    render: {
      waitUntil: "networkidle2",
      // more forgiving than networkidle0 for SPAs
      timeoutMs: 3e4,
      waitForSelector: null,
      // e.g. "main" or "#app main"
      postLoadDelayMs: 0,
      blockRequests: [
        /google-analytics\.com/i,
        /googletagmanager\.com/i,
        /segment\.com/i,
        /hotjar\.com/i
      ],
      launchOptions: {
        headless: "new"
        // For CI containers you may need:
        // args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
      /**
       * @param {import('puppeteer').Page} _page
       * @param {{ route: string }} _ctx
       */
      beforeGoto: async (_page, _ctx) => {
      },
      /**
       * @param {import('puppeteer').Page} _page
       * @param {{ route: string }} _ctx
       */
      beforeExtract: async (_page, _ctx) => {
      }
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
        ".modal"
      ]
    },
    markdown: {
      addFrontmatter: true,
      turndown: {
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        emDelimiter: "_"
      }
    },
    output: {
      // "sibling" => /pricing -> pricing.md ; /docs/ -> docs/index.html.md ; / -> index.html.md
      mode: "sibling",
      subdir: "ai",
      // used only when mode === "subdir"
      llmsTxtFileName: "llms.txt",
      llmsTitle: null,
      // defaults to package name or project dir
      llmsSummary: "LLM-friendly index of important pages and their Markdown equivalents.",
      sort: true
    },
    logLevel: "info"
    // "silent" | "info" | "debug"
  };
  const options = deepMerge(defaults, userOptions);
  const log = {
    info: (...args) => options.logLevel === "info" || options.logLevel === "debug" ? console.log(...args) : void 0,
    debug: (...args) => options.logLevel === "debug" ? console.log(...args) : void 0,
    warn: (...args) => options.logLevel !== "silent" ? console.warn(...args) : void 0
  };
  function isExcluded(route) {
    return (options.exclude || []).some((p) => {
      if (p instanceof RegExp) return p.test(route);
      return route.includes(p);
    });
  }
  function normalizeRoute(input, { stripQuery = true } = {}) {
    if (!input) return null;
    if (input.startsWith("mailto:") || input.startsWith("tel:") || input.startsWith("javascript:"))
      return null;
    let s = input.trim();
    if (s.startsWith("http://") || s.startsWith("https://")) return null;
    const hashIdx = s.indexOf("#");
    if (hashIdx >= 0) s = s.slice(0, hashIdx);
    if (stripQuery) {
      const qIdx = s.indexOf("?");
      if (qIdx >= 0) s = s.slice(0, qIdx);
    }
    if (!s) return null;
    if (!s.startsWith("/")) {
      if (s.startsWith("./"))
        s = s.slice(1);
      else s = "/" + s;
    }
    s = s.replace(/\/{2,}/g, "/");
    return s;
  }
  function routeToMdWebPath(route) {
    if (route === "/") return "index.html.md";
    if (route.endsWith("/")) return route.slice(1) + "index.html.md";
    return route.slice(1) + ".md";
  }
  function routeToMdFsPath(distDir, route) {
    const rel = routeToMdWebPath(route);
    if (options.output.mode === "subdir") {
      return path.join(distDir, options.output.subdir, rel);
    }
    return path.join(distDir, rel);
  }
  function routeToHtmlFsPath(distDir, route) {
    if (route === "/") return path.join(distDir, "index.html");
    if (route.endsWith("/")) return path.join(distDir, route.slice(1), "index.html");
    return path.join(distDir, route.slice(1) + ".html");
  }
  function makeLlmsLink(relMdPath) {
    return relMdPath.replace(/\\/g, "/");
  }
  async function safeCloseHttpServer(server) {
    await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }
  function shouldUseStaticMode() {
    var _a;
    if (options.static === true) return true;
    if (options.static === false) return false;
    return !((_a = options.crawl) == null ? void 0 : _a.enabled);
  }
  return {
    name: "vite-plugin-llm-spider",
    apply: "build",
    configResolved(rc) {
      resolvedConfig = rc;
    },
    async closeBundle() {
      var _a, _b, _c, _d, _e, _f;
      if (!options.enabled) return;
      if (!resolvedConfig)
        throw new Error("LLM Spider: missing resolved Vite config");
      const distDir = resolvedConfig.build.outDir || "dist";
      const basePath = (resolvedConfig.base || "/").replace(/\\/g, "/");
      const useStaticMode = shouldUseStaticMode();
      let routeDefs = [];
      if (Array.isArray(options.routes) && options.routes.length) {
        routeDefs = options.routes.map((r) => ({
          path: normalizeRoute(r.path, { stripQuery: true }) || "/",
          title: r.title,
          section: r.section || "Pages",
          optional: !!r.optional,
          notes: r.notes
        }));
      } else if ((_a = options.crawl) == null ? void 0 : _a.enabled) {
        routeDefs = [];
      } else {
        routeDefs = [{ path: "/", section: "Pages" }];
      }
      log.info(`
LLM Spider: generating markdown + llms.txt (${useStaticMode ? "static" : "browser"} mode)`);
      log.debug("distDir:", distDir, "base:", basePath);
      const turndown = new TurndownService(options.markdown.turndown);
      turndown.use(gfm);
      const captured = [];
      if (useStaticMode) {
        log.debug("Using static mode - reading HTML files directly from dist/");
        for (const rd of routeDefs) {
          const route = rd.path;
          if (isExcluded(route)) continue;
          let htmlPath = routeToHtmlFsPath(distDir, route);
          let htmlContent = null;
          try {
            htmlContent = await fs.readFile(htmlPath, "utf8");
          } catch {
            if (!route.endsWith("/") && route !== "/") {
              const altPath = path.join(distDir, route.slice(1), "index.html");
              try {
                htmlContent = await fs.readFile(altPath, "utf8");
                htmlPath = altPath;
              } catch {
                try {
                  htmlContent = await fs.readFile(path.join(distDir, "index.html"), "utf8");
                  htmlPath = path.join(distDir, "index.html");
                  log.debug(`  Using SPA fallback index.html for ${route}`);
                } catch {
                  log.warn(`  \u26A0\uFE0F  No HTML found for ${route}`);
                  continue;
                }
              }
            }
          }
          if (!htmlContent) continue;
          const $ = cheerio.load(htmlContent);
          for (const sel of options.extract.removeSelectors || [])
            $(sel).remove();
          const mainSelectors = Array.isArray(options.extract.mainSelector) ? options.extract.mainSelector : [options.extract.mainSelector];
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
          const markdownBody = turndown.turndown(mainHtml || "");
          const mdRelPath = options.output.mode === "subdir" ? path.posix.join(options.output.subdir, routeToMdWebPath(route)) : routeToMdWebPath(route);
          const fsPath = routeToMdFsPath(distDir, route);
          await fs.mkdir(path.dirname(fsPath), { recursive: true });
          const frontmatter = options.markdown.addFrontmatter ? `---
source: ${route}
title: ${title}
generated_at: ${(/* @__PURE__ */ new Date()).toISOString()}
---

` : "";
          await fs.writeFile(fsPath, frontmatter + markdownBody, "utf8");
          captured.push({
            route,
            title: rd.title || title,
            section: rd.section || "Pages",
            optional: !!rd.optional,
            notes: rd.notes,
            mdRelPath
          });
          log.info(`  \u2705 ${route} -> ${mdRelPath}`);
        }
      } else {
        const previewServer = await preview({
          root: resolvedConfig.root,
          base: resolvedConfig.base,
          build: { outDir: distDir },
          preview: { port: 0, open: false, host: "127.0.0.1" },
          configFile: false,
          plugins: [],
          logLevel: "silent"
        });
        await new Promise((resolve, reject) => {
          const server = previewServer.httpServer;
          if (server.listening) {
            resolve();
          } else {
            server.once("listening", resolve);
            server.once("error", reject);
            setTimeout(() => reject(new Error("Preview server failed to start")), 5e3);
          }
        });
        const addr = previewServer.httpServer.address();
        if (!addr || typeof addr === "string") {
          await safeCloseHttpServer(previewServer.httpServer);
          throw new Error("LLM Spider: could not determine preview server port");
        }
        const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
        const baseUrl = `http://127.0.0.1:${addr.port}${normalizedBase}`;
        log.debug("Preview server at:", baseUrl);
        const pup = await loadPuppeteer();
        const browser = await pup.launch(options.render.launchOptions);
        const visited = /* @__PURE__ */ new Set();
        const queue = [];
        if ((_b = options.crawl) == null ? void 0 : _b.enabled) {
          for (const seed of options.crawl.seeds || ["/"]) {
            const nr = normalizeRoute(seed, {
              stripQuery: options.crawl.stripQuery
            });
            if (nr) queue.push({ route: nr, depth: 0 });
          }
        } else {
          for (const rd of routeDefs) queue.push({ route: rd.path, depth: 0 });
        }
        const maxDepth = ((_c = options.crawl) == null ? void 0 : _c.enabled) ? options.crawl.maxDepth : 0;
        const maxPages = ((_d = options.crawl) == null ? void 0 : _d.enabled) ? options.crawl.maxPages : queue.length;
        const concurrency = ((_e = options.crawl) == null ? void 0 : _e.enabled) ? options.crawl.concurrency : 3;
        async function captureOne(route) {
          var _a2, _b2, _c2;
          if (visited.has(route)) return;
          if (isExcluded(route)) return;
          if (captured.length >= maxPages) return;
          visited.add(route);
          const page = await browser.newPage();
          if ((_a2 = options.render.blockRequests) == null ? void 0 : _a2.length) {
            await page.setRequestInterception(true);
            page.on("request", (req) => {
              const url = req.url();
              const blocked = options.render.blockRequests.some(
                (p) => p instanceof RegExp ? p.test(url) : url.includes(p)
              );
              if (blocked) req.abort();
              else req.continue();
            });
          }
          try {
            const pageUrl = route === "/" ? baseUrl : baseUrl + route.replace(/^\//, "");
            await options.render.beforeGoto(page, { route });
            await page.goto(pageUrl, {
              waitUntil: options.render.waitUntil,
              timeout: options.render.timeoutMs
            });
            if (options.render.waitForSelector) {
              await page.waitForSelector(options.render.waitForSelector, {
                timeout: options.render.timeoutMs
              });
            }
            if (options.render.postLoadDelayMs > 0) {
              await new Promise(
                (r) => setTimeout(r, options.render.postLoadDelayMs)
              );
            }
            await options.render.beforeExtract(page, { route });
            const html = await page.content();
            const $ = cheerio.load(html);
            let harvestedHrefs = [];
            if ((_b2 = options.crawl) == null ? void 0 : _b2.enabled) {
              harvestedHrefs = $("a[href]").map((_, a) => $(a).attr("href")).get();
              log.debug(`  Found ${harvestedHrefs.length} links on ${route}:`, harvestedHrefs.slice(0, 15));
            }
            for (const sel of options.extract.removeSelectors || [])
              $(sel).remove();
            const mainSelectors = Array.isArray(options.extract.mainSelector) ? options.extract.mainSelector : [options.extract.mainSelector];
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
            const markdownBody = turndown.turndown(mainHtml || "");
            const mdRelPath = options.output.mode === "subdir" ? path.posix.join(options.output.subdir, routeToMdWebPath(route)) : routeToMdWebPath(route);
            const fsPath = routeToMdFsPath(distDir, route);
            await fs.mkdir(path.dirname(fsPath), { recursive: true });
            const frontmatter = options.markdown.addFrontmatter ? `---
source: ${route}
title: ${title}
generated_at: ${(/* @__PURE__ */ new Date()).toISOString()}
---

` : "";
            await fs.writeFile(fsPath, frontmatter + markdownBody, "utf8");
            const meta = routeDefs.find((r) => r.path === route);
            captured.push({
              route,
              title: (meta == null ? void 0 : meta.title) || title,
              section: (meta == null ? void 0 : meta.section) || "Pages",
              optional: !!(meta == null ? void 0 : meta.optional),
              notes: meta == null ? void 0 : meta.notes,
              mdRelPath
            });
            log.info(`  \u2705 ${route} -> ${mdRelPath}`);
            if ((_c2 = options.crawl) == null ? void 0 : _c2.enabled) {
              for (const href of harvestedHrefs) {
                const n = normalizeRoute(href, {
                  stripQuery: options.crawl.stripQuery
                });
                if (!n) continue;
                let baseRelative = n;
                if (normalizedBase !== "/" && baseRelative.startsWith(normalizedBase)) {
                  baseRelative = "/" + baseRelative.slice(normalizedBase.length);
                  baseRelative = baseRelative === "//" ? "/" : baseRelative.replace(/\/{2,}/g, "/");
                }
                if (!visited.has(baseRelative) && !isExcluded(baseRelative)) {
                  queue.push({ route: baseRelative, depth: -1 });
                }
              }
            }
          } catch (err) {
            log.warn(`  \u26A0\uFE0F  failed ${route}: ${(err == null ? void 0 : err.message) || err}`);
          } finally {
            await page.close();
          }
        }
        try {
          while (queue.length && captured.length < maxPages) {
            const batch = queue.splice(0, concurrency).map((item) => {
              const depth = item.depth >= 0 ? item.depth : 1;
              return { route: item.route, depth };
            });
            await Promise.all(
              batch.map(async ({ route, depth }) => {
                var _a2, _b2;
                if (((_a2 = options.crawl) == null ? void 0 : _a2.enabled) && depth > maxDepth) return;
                await captureOne(route);
                if ((_b2 = options.crawl) == null ? void 0 : _b2.enabled) {
                  for (let i = 0; i < queue.length; i++) {
                    if (queue[i].depth === -1) queue[i].depth = depth + 1;
                  }
                }
              })
            );
          }
        } finally {
          await browser.close();
          await safeCloseHttpServer(previewServer.httpServer);
        }
      }
      const llmsTitle = options.output.llmsTitle || ((_f = resolvedConfig == null ? void 0 : resolvedConfig.env) == null ? void 0 : _f.mode) || "Site";
      const items = options.output.sort ? [...captured].sort((a, b) => a.route.localeCompare(b.route)) : captured;
      const bySection = /* @__PURE__ */ new Map();
      const optionalItems = [];
      for (const item of items) {
        if (item.optional) optionalItems.push(item);
        else {
          const s = item.section || "Pages";
          bySection.set(s, [...bySection.get(s) || [], item]);
        }
      }
      let llms = `# ${llmsTitle}

> ${options.output.llmsSummary}

`;
      for (const [section, sectionItems] of bySection.entries()) {
        llms += `## ${section}

`;
        for (const it of sectionItems) {
          const link = makeLlmsLink(it.mdRelPath);
          const label = it.title || it.route;
          const notes = it.notes ? `: ${it.notes}` : "";
          llms += `- [${label}](${link})${notes}
`;
        }
        llms += `
`;
      }
      if (optionalItems.length) {
        llms += `## Optional

`;
        for (const it of optionalItems) {
          const link = makeLlmsLink(it.mdRelPath);
          const label = it.title || it.route;
          const notes = it.notes ? `: ${it.notes}` : "";
          llms += `- [${label}](${link})${notes}
`;
        }
        llms += `
`;
      }
      const llmsPath = path.join(distDir, options.output.llmsTxtFileName);
      await fs.writeFile(llmsPath, llms, "utf8");
      log.info(
        `
LLM Spider: wrote ${captured.length} markdown pages + ${options.output.llmsTxtFileName}
`
      );
    }
  };
}
export {
  llmSpiderPlugin as default,
  llmSpiderPlugin
};
//# sourceMappingURL=index.js.map