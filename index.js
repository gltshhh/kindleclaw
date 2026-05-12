require("dotenv").config();
const config = require("./config");
const path = require("path");
const http = require("http");
const { promises: fs } = require("fs");
const fsExtra = require("fs-extra");
const puppeteer = require("puppeteer");
const { CronJob } = require("cron");
const gm = require("gm");
const crypto = require("crypto");

const { buildHtml } = require("./render");
const { syncTasksToAgenda } = require("./sync");

let browser = null;
let renderInFlight = null;

async function getFileHash(filePath) {
  try {
    const buf = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

async function renderHtmlToPngTemp(html, tempPath) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: config.width, height: config.height });
    await page.setContent(html, { waitUntil: "load", timeout: config.renderingTimeout });
    if (config.renderingDelay > 0) {
      await new Promise((r) => setTimeout(r, config.renderingDelay));
    }
    await page.screenshot({ path: tempPath, type: "png", fullPage: false });
  } finally {
    await page.close().catch(() => {});
  }
}

function convertToKindlePng(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    gm(inputPath)
      .gamma(1.0 / 2.2)
      .contrast(config.contrast)
      .dither(config.dither)
      .rotate("white", config.rotation)
      .type(config.colorMode)
      .bitdepth(config.grayscaleDepth)
      .quality(100)
      .strip()
      .write(outputPath, (err) => (err ? reject(err) : resolve()));
  });
}

async function doRender() {
  await fsExtra.ensureDir(path.dirname(config.outputPath));

  if (config.tasksPath) {
    try {
      const r = await syncTasksToAgenda({
        tasksPath: config.tasksPath,
        agendaPath: config.agendaPath,
        limit: config.tasksLimit,
      });
      if (r.synced) {
        console.log(`[sync] TASKS.md -> agenda.md (${r.count} zadań)`);
      } else {
        console.warn(`[sync] pominięty: ${r.reason}`);
      }
    } catch (err) {
      console.error(`[sync] błąd: ${err.message} - używam istniejącego agenda.md`);
    }
  }

  const html = await buildHtml(config.agendaPath, { width: config.width, height: config.height });

  const tempRaw = config.outputPath + ".raw.temp.png";
  const tempFinal = config.outputPath + ".final.temp.png";

  await renderHtmlToPngTemp(html, tempRaw);
  await convertToKindlePng(tempRaw, tempFinal);

  let written = true;
  if (await fsExtra.pathExists(config.outputPath)) {
    const [a, b] = await Promise.all([getFileHash(tempFinal), getFileHash(config.outputPath)]);
    if (a && b && a === b) {
      written = false;
    }
  }

  if (written) {
    await fsExtra.move(tempFinal, config.outputPath, { overwrite: true });
  } else {
    await fsExtra.remove(tempFinal).catch(() => {});
  }
  await fsExtra.remove(tempRaw).catch(() => {});

  const hash = await getFileHash(config.outputPath);
  return { written, hash };
}

async function render() {
  if (renderInFlight) return renderInFlight;
  renderInFlight = (async () => {
    try {
      return await doRender();
    } finally {
      renderInFlight = null;
    }
  })();
  return renderInFlight;
}

async function servePng(req, res) {
  try {
    const data = await fs.readFile(config.outputPath);
    const stat = await fs.stat(config.outputPath);
    const etag = crypto.createHash("sha256").update(data).digest("hex");

    const inm = req.headers["if-none-match"];
    if (inm && inm === `"${etag}"`) {
      res.writeHead(304, {
        ETag: `"${etag}"`,
        "Cache-Control": "no-cache",
      });
      res.end();
      return;
    }

    const headers = {
      "Content-Type": "image/png",
      "Content-Length": Buffer.byteLength(data),
      "Last-Modified": new Date(stat.mtime).toUTCString(),
      ETag: `"${etag}"`,
      "Cache-Control": "no-cache",
    };

    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  } catch (err) {
    console.error("Error serving PNG:", err.message);
    res.writeHead(404);
    res.end("Image not found");
  }
}

async function servePreview(req, res) {
  try {
    const html = await buildHtml(config.agendaPath, { width: config.width, height: config.height });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    console.error("Preview error:", err.message);
    res.writeHead(500);
    res.end("Preview error: " + err.message);
  }
}

async function servePush(req, res) {
  try {
    const result = await render();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...result }));
    console.log(`[push] written=${result.written} hash=${result.hash?.slice(0, 12)}`);
  } catch (err) {
    console.error("Push error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

(async () => {
  console.log(`agenda: ${config.agendaPath}`);
  console.log(`output: ${config.outputPath}`);
  console.log(`size:   ${config.width}x${config.height} (rotation=${config.rotation})`);

  console.log("Launching browser...");
  browser = await puppeteer.launch({
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
    defaultViewport: null,
    timeout: config.browserLaunchTimeout,
    headless: true,
  });

  console.log("Initial render...");
  try {
    const r = await render();
    console.log(`Initial render OK (written=${r.written}, hash=${r.hash?.slice(0, 12)})`);
  } catch (err) {
    console.error("Initial render FAILED:", err);
  }

  if (config.cronJob) {
    console.log(`Cron scheduled: ${config.cronJob}`);
    new CronJob({
      cronTime: config.cronJob,
      onTick: async () => {
        try {
          const r = await render();
          console.log(`[cron] written=${r.written} hash=${r.hash?.slice(0, 12)}`);
        } catch (err) {
          console.error("[cron] render error:", err.message);
        }
      },
      start: true,
    });
  } else {
    console.log("Cron disabled (push-on-demand). POST /push to re-render.");
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;
    const m = req.method;

    if (p === "/preview" && m === "GET") return servePreview(req, res);
    if (p === "/push" && (m === "POST" || m === "GET")) return servePush(req, res);
    if (p === "/" && (m === "GET" || m === "HEAD")) return servePng(req, res);

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found\n\nEndpoints:\n  GET /         -> kindle.png\n  GET /preview  -> HTML debug\n  POST /push    -> re-render\n");
  });

  server.listen(config.port, () => {
    console.log(`Server listening on :${config.port}`);
    console.log(`  GET  http://localhost:${config.port}/         -> kindle.png`);
    console.log(`  GET  http://localhost:${config.port}/preview  -> HTML debug`);
    console.log(`  POST http://localhost:${config.port}/push     -> re-render`);
  });
})().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
