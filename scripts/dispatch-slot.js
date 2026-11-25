// Dispara puntualmente el workflow en la nube de GitHub Actions (workflow_dispatch)
// para la tanda Mañana (9:00 AM) o Tarde (3:00 PM) America/Mexico_City si aún no se ha lanzado.
// No consume CPU local: toda la generación y subida corre en los servidores de GitHub Actions.

import { execSync } from "node:child_process";

const REPO = "juniorlr2001-crypto/docusy";
const WORKFLOW_FILE = "daily-documentary.yml";
const TIMEZONE = "America/Mexico_City";

function getGitHubToken() {
  if (process.env.GH_PAT || process.env.GITHUB_TOKEN) {
    return process.env.GH_PAT || process.env.GITHUB_TOKEN;
  }
  const out = execSync("git credential fill", {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8"
  });
  const line = out.split(/\r?\n/).find(l => l.startsWith("password="));
  if (!line) {
    throw new Error("No se encontró token de GitHub en git credential manager.");
  }
  return line.slice("password=".length).trim();
}

function getMexicoTimeParts(dateObj) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(dateObj).map(p => [p.type, p.value]));
  return {
    mxDate: `${parts.year}-${parts.month}-${parts.day}`,
    mxHour: parseInt(parts.hour, 10),
    formatted: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${TIMEZONE})`
  };
}

async function main() {
  const force = process.argv.includes("--force");
  const token = getGitHubToken();
  const nowParts = getMexicoTimeParts(new Date());
  const { mxDate, mxHour } = nowParts;
  const isMorning = mxHour < 15;

  console.log(`[dispatch-slot] Hora actual: ${nowParts.formatted} | Tanda: ${isMorning ? "Mañana (9 AM)" : "Tarde (3 PM)"}`);

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "docusy-slot-dispatcher",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  // 1. Revisar si ya hay un workflow corriendo en GitHub Actions
  const runsResp = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=10`, { headers });
  if (!runsResp.ok) {
    throw new Error(`Error consultando runs de GitHub: HTTP ${runsResp.status}`);
  }
  const runsData = await runsResp.json();
  const activeRun = (runsData.workflow_runs || []).find(r =>
    r.status === "in_progress" || r.status === "queued" || r.status === "waiting" || r.status === "pending"
  );
  if (activeRun) {
    console.log(`⏳ Ya hay una ejecución en curso en GitHub Actions (Run #${activeRun.run_number}, ID ${activeRun.id}). Omitiendo disparo duplicado.`);
    return;
  }

  // 2. Revisar historial en radar-state
  let todayCount = 0;
  let morningCount = 0;
  let afternoonCount = 0;

  const histResp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/data/published_topics.json?ref=radar-state`,
    { headers: { ...headers, "Accept": "application/vnd.github.raw+json" } }
  );
  if (histResp.ok) {
    const hist = await histResp.json();
    for (const entry of hist.historyLog || []) {
      if (!entry.usedAt || entry.usedAt === "backfilled") continue;
      const d = new Date(entry.usedAt);
      if (isNaN(d.getTime())) continue;
      const ep = getMexicoTimeParts(d);
      if (ep.mxDate === mxDate) {
        todayCount++;
        if (ep.mxHour < 15) morningCount++;
        else afternoonCount++;
      }
    }
  }

  console.log(`[dispatch-slot] Episodios publicados hoy (${mxDate}): total=${todayCount}, mañana=${morningCount}, tarde=${afternoonCount}`);

  if (!force) {
    if (mxHour < 8 || mxHour >= 21) {
      console.log("⏸️ Fuera de horario diurno (08:00-20:59 MX). Se omite.");
      return;
    }
    if (todayCount >= 2) {
      console.log("✅ Ya se publicaron los 2 episodios de hoy. Nada que hacer.");
      return;
    }
    if (isMorning && morningCount >= 1) {
      console.log("✅ Ya se publicó el episodio de la mañana hoy. Nada que hacer.");
      return;
    }
    if (!isMorning && afternoonCount >= 1) {
      console.log("✅ Ya se publicó el episodio de la tarde hoy. Nada que hacer.");
      return;
    }
  }

  // 3. Disparar workflow_dispatch en GitHub Actions
  let dispResp = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: { trigger_source: "cloudflare_cron" }
      })
    }
  );
  if (dispResp.status === 422) {
    dispResp = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main" })
      }
    );
  }
  if (!dispResp.ok) {
    const errText = await dispResp.text();
    throw new Error(`Fallo al disparar workflow_dispatch: HTTP ${dispResp.status} - ${errText}`);
  }
  console.log("🚀 Disparo workflow_dispatch enviado con éxito a GitHub Actions (HTTP 204).");
}

main().catch(err => {
  console.error("❌ Error en dispatch-slot:", err.message);
  process.exit(1);
});
