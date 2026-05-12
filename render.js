const { promises: fs } = require("fs");
const path = require("path");

const TEMPLATE_PATH = path.join(__dirname, "template.html");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Wyciąga deadline z linii zadania. Akceptowane formaty po separatorze `|`:
//   YYYY-MM-DD          -> data bez godziny (koniec dnia 23:59:59)
//   YYYY-MM-DD HH:MM    -> data z godziną
// Zwraca { text, due, hasTime }. due = Date albo null.
function extractDeadline(line) {
  const idx = line.lastIndexOf("|");
  if (idx === -1) return { text: line.trim(), due: null, hasTime: false };

  const text = line.slice(0, idx).trim();
  const raw = line.slice(idx + 1).trim();

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return { text: line.trim(), due: null, hasTime: false };

  const [, y, mo, d, hh, mm] = m;
  const due = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    hh ? Number(hh) : 23,
    mm ? Number(mm) : 59,
    hh ? 0 : 59
  );
  if (isNaN(due.getTime())) return { text: line.trim(), due: null, hasTime: false };

  return { text, due, hasTime: Boolean(hh) };
}

function parseAgenda(md) {
  // Liberalne dopasowanie: dwukropek może być wewnątrz bold-a (`**Data:**`)
  // albo poza (`**Data**:`). Case-insensitive.
  const dateMatch = md.match(/\*\*\s*data\s*:?\s*\*\*\s*:?\s*(.+)/i);
  const updatedMatch = md.match(
    /\*\*\s*(?:ostatnia\s+)?aktualizacja\s*:?\s*\*\*\s*:?\s*(.+)/i
  );
  const tasks = [];
  const taskRe = /^\s*\d+\.\s+(.+)$/gm;
  let m;
  while ((m = taskRe.exec(md)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    tasks.push(extractDeadline(raw));
  }

  const errors = [];
  const date = dateMatch ? dateMatch[1].trim() : null;
  const updated = updatedMatch ? updatedMatch[1].trim() : null;
  if (!date) errors.push("brakuje pola **Data:**");
  if (tasks.length === 0) errors.push("brak zadań (oczekiwana lista numerowana 1. 2. 3.)");

  return { date, updated, tasks, errors };
}

// Formatuje wartość czasu (jako liczba ms) na zwięzły string typu
// "1d 5h", "3h 20m", "45m". Wartości muszą być >= 0.
function formatDuration(diffMs, hasTime) {
  const diffDays = Math.floor(diffMs / 86400000);
  const diffHours = Math.floor((diffMs % 86400000) / 3600000);
  const diffMinutes = Math.floor((diffMs % 3600000) / 60000);

  // Bez godziny — granularność dzienna
  if (!hasTime) {
    return `${Math.max(1, diffDays)}d`;
  }

  if (diffDays > 0) {
    return diffHours > 0 ? `${diffDays}d ${diffHours}h` : `${diffDays}d`;
  }
  if (diffHours > 0) {
    return diffMinutes > 0 ? `${diffHours}h ${diffMinutes}m` : `${diffHours}h`;
  }
  if (diffMinutes > 0) return `${diffMinutes}m`;
  return "0m";
}

// Zwraca { label, overdue } gdzie label to string do wyświetlenia w badge'u
// (np. "1d 5h" / "3h 20m" / "Dziś" / "Teraz") a overdue=true gdy zadanie jest
// po terminie (label pokazuje wtedy ile czasu minęło OD deadline'u, np. "2d 3h").
// Zwraca null gdy brak deadline'u.
function formatCountdown(due, hasTime, now = new Date()) {
  if (!due) return null;

  const isToday =
    now.getDate() === due.getDate() &&
    now.getMonth() === due.getMonth() &&
    now.getFullYear() === due.getFullYear();

  if (due < now) {
    // Overdue — odliczamy w drugą stronę (od deadline'u do teraz)
    const diffMs = now.getTime() - due.getTime();
    return { label: formatDuration(diffMs, hasTime), overdue: true };
  }

  const diffMs = due.getTime() - now.getTime();

  if (!hasTime) {
    if (isToday) return { label: "Dziś", overdue: false };
    return { label: formatDuration(diffMs, false), overdue: false };
  }

  // hasTime, w przyszłości
  if (diffMs < 60000) return { label: "Teraz", overdue: false };
  return { label: formatDuration(diffMs, true), overdue: false };
}

function nowClock() {
  return new Date().toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 3 segmenty 20-min dla bieżącej godziny:
//   "filled"  -> minione (pełne, czarne)
//   "current" -> trwający (samo obramowanie)
//   "empty"   -> przyszłe (puste)
function hourBlocks(now = new Date()) {
  const minutes = now.getMinutes();
  const currentIdx = Math.floor(minutes / 20); // 0..2
  return [0, 1, 2].map((i) => {
    if (i < currentIdx) return "filled";
    if (i === currentIdx) return "current";
    return "empty";
  });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function renderHourTimeline(now = new Date()) {
  const blocks = hourBlocks(now)
    .map((state) => `<span class="hour-block ${state}"></span>`)
    .join("");
  return `
    <div class="hour-row">
      <span class="hour-label">${pad2(now.getHours())}:</span>
      <span class="hour-blocks">${blocks}</span>
    </div>
  `;
}

function formatUpdatedNow(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(
    now.getDate()
  )} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function renderBody(parsed) {
  if (parsed.errors.length > 0) {
    const list = parsed.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("");
    return `
      <div class="error">
        <h1>Błąd parsowania agenda.md</h1>
        <ul>${list}</ul>
      </div>
    `;
  }

  const now = new Date();
  const tasks = parsed.tasks
    .slice(0, 5)
    .map((t) => {
      const c = formatCountdown(t.due, t.hasTime, now);
      let right = "";
      if (c) {
        const cls = c.overdue ? "countdown overdue" : "countdown";
        right = `<span class="${cls}">${escapeHtml(c.label)}</span>`;
      }
      return `<li><span class="text">${escapeHtml(t.text)}</span>${right}</li>`;
    })
    .join("");

  const footer = `<div class="footer">ostatnia aktualizacja: ${escapeHtml(
    formatUpdatedNow(now)
  )}</div>`;

  return `
    ${renderHourTimeline(now)}
    <div class="date">${escapeHtml(parsed.date)}</div>
    <div class="heading">Zadania</div>
    <ol class="tasks">${tasks}</ol>
    ${footer}
  `;
}

async function buildHtml(agendaPath, dims) {
  const template = await fs.readFile(TEMPLATE_PATH, "utf8");

  let parsed;
  try {
    const md = await fs.readFile(agendaPath, "utf8");
    parsed = parseAgenda(md);
  } catch (err) {
    parsed = {
      date: null,
      updated: null,
      tasks: [],
      errors: [`nie można odczytać pliku ${agendaPath}: ${err.message}`],
    };
  }

  const body = renderBody(parsed);
  return template
    .replace(/\{\{WIDTH\}\}/g, String(dims.width))
    .replace(/\{\{HEIGHT\}\}/g, String(dims.height))
    .replace(/\{\{BODY\}\}/g, body);
}

module.exports = { buildHtml, parseAgenda, formatCountdown };
