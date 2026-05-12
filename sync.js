// Opcjonalny synchronizator TASKS.md -> agenda.md.
//
// Aktywuje się tylko gdy w .env ustawiono TASKS_PATH. Inaczej sync jest
// pomijany i agenda.md pozostaje pod kontrolą agenta/użytkownika.
//
// Format wejściowy (TASKS.md): markdown z sekcjami `## ...PILNE`,
// `## ...PROJEKTY W TOKU`. Każdy task to `### Tytuł` z opcjonalnym
// `- **Deadline:** YYYY-MM-DD [HH:MM]`. Status zawierający `WYSŁANE`,
// `Ukończone` lub `✅` -> task pomijany.
//
// Format wyjściowy (agenda.md): zgodny z `render.js` -> nagłówek `# Agenda`,
// pole `**Data:**`, sekcja `## Zadania`, lista numerowana z opcjonalnym
// ` | YYYY-MM-DD [HH:MM]`.

const { promises: fs } = require("fs");
const path = require("path");

const SECTION_PILNE = 1;
const SECTION_TOKU = 2;

function detectSection(line) {
  if (!line.startsWith("## ")) return null;
  if (/PILNE/.test(line)) return SECTION_PILNE;
  if (/TOKU/.test(line)) return SECTION_TOKU;
  return 0; // znana sekcja, ale nie nasza -> reset
}

function isCompletedStatus(line) {
  if (!/Status:/.test(line)) return false;
  return /WYSŁANE|WYSLANE|Ukończone|Ukonczone|✅/.test(line);
}

function extractDeadline(line) {
  // Tylko literalne "Deadline:" - pomija "Deadline przegapiony" itp.
  if (!/Deadline:/.test(line)) return null;
  const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) return null;
  const timeMatch = line.match(/(\d{2}:\d{2})/);
  return timeMatch ? `${dateMatch[1]} ${timeMatch[1]}` : dateMatch[1];
}

function parseTasks(md, limit) {
  const lines = md.split(/\r?\n/);
  const tasks = [];
  let section = 0;
  let cur = null;

  const flush = () => {
    if (!cur) return;
    if (!cur.skip && tasks.length < limit) {
      const out = cur.deadline ? `${cur.title} | ${cur.deadline}` : cur.title;
      tasks.push(out);
    }
    cur = null;
  };

  for (const raw of lines) {
    if (raw.startsWith("## ")) {
      flush();
      const s = detectSection(raw);
      section = s == null ? section : s;
      continue;
    }
    if (section <= 0) continue;

    if (raw.startsWith("### ")) {
      flush();
      cur = { title: raw.slice(4).trim(), deadline: null, skip: false };
      continue;
    }
    if (!cur) continue;

    if (isCompletedStatus(raw)) {
      cur.skip = true;
      continue;
    }
    const dl = extractDeadline(raw);
    if (dl) cur.deadline = dl;
  }
  flush();
  return tasks;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function buildAgendaMd(tasks, date) {
  const list = tasks.length
    ? tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "1. Brak pilnych zadań";

  return `# Agenda

**Data:** ${date}

## Zadania

${list}
`;
}

async function atomicWrite(targetPath, content) {
  const tmpPath = targetPath + ".tmp";
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, targetPath);
}

// Jeśli sync jest wyłączony lub TASKS.md nie istnieje -> zwraca
// { synced: false, reason }. Nie rzuca - render leci dalej z istniejącym
// agenda.md (failsafe). Inne błędy (np. zepsuty markdown) propagują się.
async function syncTasksToAgenda({ tasksPath, agendaPath, limit = 5 }) {
  if (!tasksPath) {
    return { synced: false, reason: "TASKS_PATH not set" };
  }

  let md;
  try {
    md = await fs.readFile(tasksPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { synced: false, reason: `TASKS file not found: ${tasksPath}` };
    }
    throw err;
  }

  const tasks = parseTasks(md, limit);
  const content = buildAgendaMd(tasks, formatDate());

  await fs.mkdir(path.dirname(agendaPath), { recursive: true });
  await atomicWrite(agendaPath, content);

  return { synced: true, count: tasks.length };
}

module.exports = { syncTasksToAgenda, parseTasks, buildAgendaMd };
