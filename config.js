require("dotenv").config();
const path = require("path");

const root = __dirname;

function abs(p) {
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

function bool(v, def) {
  if (v === undefined || v === "") return def;
  return /^(1|true|yes)$/i.test(String(v));
}

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function num(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

const config = {
  port: int(process.env.PORT, 5000),
  agendaPath: abs(process.env.AGENDA_PATH || "./data/agenda.md"),
  outputPath: abs(process.env.OUTPUT_PATH || "./output/kindle.png"),
  tasksPath: process.env.TASKS_PATH ? abs(process.env.TASKS_PATH) : null,
  tasksLimit: int(process.env.TASKS_LIMIT, 5),
  width: int(process.env.WIDTH, 600),
  height: int(process.env.HEIGHT, 800),
  rotation: int(process.env.ROTATION, 0),
  grayscaleDepth: int(process.env.GRAYSCALE_DEPTH, 8),
  colorMode: process.env.COLOR_MODE || "GrayScale",
  contrast: num(process.env.CONTRAST, 1),
  dither: bool(process.env.DITHER, false),
  cronJob: (process.env.CRON_JOB || "").trim(),
  renderingDelay: int(process.env.RENDERING_DELAY, 0),
  renderingTimeout: int(process.env.RENDERING_TIMEOUT, 10000),
  browserLaunchTimeout: int(process.env.BROWSER_LAUNCH_TIMEOUT, 30000),
};

if (config.rotation % 90 !== 0) {
  throw new Error(`Invalid ROTATION: ${config.rotation} (must be multiple of 90)`);
}

module.exports = config;
