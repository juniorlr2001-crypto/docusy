// Cloudflare Worker Cron Trigger for docusy (juniorlr2001-crypto/docusy)
// Dispara puntualmente a las 9:00 AM y 3:00 PM (America/Mexico_City, UTC-6)
// vía GitHub Actions workflow_dispatch API (que inicia en ~2 segundos sin el retraso de horas del cron interno de GitHub).
// Crones configurados en Cloudflare:
//   - "0 15 * * *"  (9:00 AM Ciudad de México - Disparo principal matutino)
//   - "45 15 * * *" (9:45 AM Ciudad de México - Respaldo matutino si el primero falló)
//   - "0 21 * * *"  (3:00 PM Ciudad de México - Disparo principal vespertino)
//   - "45 21 * * *" (3:45 PM Ciudad de México - Respaldo vespertino si el primero falló)

const REPO = "juniorlr2001-crypto/docusy";
const WORKFLOW_FILE = "daily-documentary.yml";
const TIMEZONE = "America/Mexico_City";

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
    mxMinute: parseInt(parts.minute, 10),
    formatted: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${TIMEZONE})`
  };
}

async function getStatusAndOptionallyTrigger(shouldTrigger, cronExpr) {
  const nowParts = getMexicoTimeParts(new Date());
  const { mxDate, mxHour } = nowParts;
  const isMorning = mxHour < 15;

  const ghHeaders = {
    "Authorization": `Bearer ${GH_PAT}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "docusy-cloudflare-cron-worker",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  // 1. Verificar si ya hay una ejecución en curso o en cola
  const runsResp = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=10`, {
    headers: ghHeaders
  });
  if (!runsResp.ok) {
    throw new Error(`Error consultando runs de GitHub: HTTP ${runsResp.status}`);
  }
  const runsData = await runsResp.json();
  const workflowRuns = Array.isArray(runsData.workflow_runs) ? runsData.workflow_runs : [];
  const activeRun = workflowRuns.find(r =>
    r.status === "in_progress" || r.status === "queued" || r.status === "waiting" || r.status === "pending"
  );

  // 2. Consultar historial real de episodios publicados en la rama radar-state
  let todayCount = 0;
  let morningCount = 0;
  let afternoonCount = 0;
  let lastPublished = null;

  const histResp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/data/published_topics.json?ref=radar-state`,
    {
      headers: {
        ...ghHeaders,
        "Accept": "application/vnd.github.raw+json"
      }
    }
  );

  if (histResp.ok) {
    const hist = await histResp.json();
    const log = Array.isArray(hist.historyLog) ? hist.historyLog : [];
    for (const entry of log) {
      if (!entry.usedAt || entry.usedAt === "backfilled") continue;
      const d = new Date(entry.usedAt);
      if (isNaN(d.getTime())) continue;
      const ep = getMexicoTimeParts(d);
      lastPublished = { id: entry.id, usedAt: entry.usedAt, mxTime: ep.formatted };
      if (ep.mxDate === mxDate) {
        todayCount++;
        if (ep.mxHour < 15) morningCount++;
        else afternoonCount++;
      }
    }
  }

  const statusReport = {
    nowMexico: nowParts.formatted,
    slot: isMorning ? "morning (9:00 AM)" : "afternoon (3:00 PM)",
    cron: cronExpr || "manual_check",
    activeRun: activeRun ? { id: activeRun.id, run_number: activeRun.run_number, status: activeRun.status, created_at: activeRun.created_at } : null,
    todayStats: { mxDate, todayCount, morningCount, afternoonCount },
    lastPublished
  };

  if (!shouldTrigger) {
    return { action: "status_only", ...statusReport };
  }

  // 3. Reglas de guardia para no duplicar ni publicar de madrugada
  if (mxHour < 8 || mxHour >= 21) {
    return { action: "skipped", reason: "outside_mexico_daytime_hours", ...statusReport };
  }
  if (activeRun) {
    return { action: "skipped", reason: "workflow_already_running", ...statusReport };
  }
  if (todayCount >= 2) {
    return { action: "skipped", reason: "daily_limit_2_episodes_reached", ...statusReport };
  }
  if (isMorning && morningCount >= 1) {
    return { action: "skipped", reason: "morning_episode_already_published", ...statusReport };
  }
  if (!isMorning && afternoonCount >= 1) {
    return { action: "skipped", reason: "afternoon_episode_already_published", ...statusReport };
  }

  // 4. Disparar workflow_dispatch en GitHub Actions
  let dispatchResp = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: "main",
        inputs: { trigger_source: "cloudflare_cron" }
      })
    }
  );

  // Fallback por si el input trigger_source aún no está presente
  if (dispatchResp.status === 422) {
    dispatchResp = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: { ...ghHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main" })
      }
    );
  }

  if (!dispatchResp.ok) {
    const errText = await dispatchResp.text();
    throw new Error(`Fallo al disparar workflow_dispatch: HTTP ${dispatchResp.status} - ${errText}`);
  }

  return {
    action: "dispatched",
    httpStatus: dispatchResp.status,
    ...statusReport
  };
}

addEventListener("scheduled", event => {
  event.waitUntil(
    getStatusAndOptionallyTrigger(true, event.cron)
      .then(res => console.log("Resultado cron docusy:", JSON.stringify(res)))
      .catch(err => console.error("Error en cron docusy:", err.message))
  );
});

addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  const triggerRequested = url.searchParams.get("trigger") === "true" && req.headers.get("X-Trigger-Key") === GH_PAT;
  event.respondWith(
    getStatusAndOptionallyTrigger(triggerRequested, "http_request")
      .then(res => new Response(JSON.stringify(res, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }))
      .catch(err => new Response(JSON.stringify({ error: err.message }, null, 2), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }))
  );
});
