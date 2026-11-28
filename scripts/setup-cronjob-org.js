// Configura automáticamente el Cron Job en la nube 24/7 en cron-job.org (9:00 AM y 3:00 PM America/Mexico_City)
// para disparar GitHub Actions (workflow_dispatch) al segundo exacto con la PC 100% apagada.
// Uso: node scripts/setup-cronjob-org.js <CRONJOB_ORG_API_KEY>

import "dotenv/config";
import { execSync } from "node:child_process";

const CRONJOB_API_KEY = process.env.DOCU_CRONJOB_API_KEY || process.env.CRONJOB_API_KEY;
const REPO = process.argv[2] || "juniorlr2001-crypto/docusy";
const WORKFLOW = process.argv[3] || "daily-documentary.yml";

function getGitHubToken() {
  if (process.env.GH_PAT || process.env.GITHUB_TOKEN) {
    return process.env.GH_PAT || process.env.GITHUB_TOKEN;
  }
  const out = execSync("git credential fill", {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const line = out.split(/\r?\n/).find(l => l.startsWith("password="));
  if (!line) throw new Error("No se encontró token de GitHub en git credential manager.");
  return line.slice("password=".length).trim();
}

async function main() {
  if (!CRONJOB_API_KEY) {
    console.error("Falta la API Key de cron-job.org. Pásala como argumento: node scripts/setup-cronjob-org.js <TU_API_KEY>");
    process.exit(1);
  }

  const ghToken = getGitHubToken();

  const payload = {
    job: {
      url: `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      enabled: true,
      saveResponses: true,
      title: REPO.includes("viral-survival")
        ? `AlertaBiometrica Auto-Publish 9AM & 3PM (${REPO})`
        : `Docusy Auto-Publish 9AM & 3PM (${REPO})`,
      schedule: {
        timezone: "America/Mexico_City",
        expiresAt: 0,
        hours: [9, 15],
        mdays: [-1],
        minutes: [0],
        months: [-1],
        wdays: [-1],
      },
      requestMethod: 1, // 1 = POST in cron-job.org REST API
      extendedData: {
        headers: {
          "Authorization": `Bearer ${ghToken}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "cron-job-org-docusy-dispatcher",
        },
        body: REPO.includes("viral-survival")
          ? JSON.stringify({ ref: "main" })
          : JSON.stringify({ ref: "main", inputs: { trigger_source: "cloudflare_cron" } }),
      },
    },
  };

  const res = await fetch("https://api.cron-job.org/jobs", {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${CRONJOB_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Error en cron-job.org API (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }

  console.log(`✅ Cron Job 24/7 creado con éxito en cron-job.org! Job ID: ${data.jobId}`);
  console.log("⏰ Horario configurado: 09:00 AM y 03:00 PM (America/Mexico_City) -> Disparo instantáneo en GitHub Actions.");
}

main().catch(err => {
  console.error("❌", err.message);
  process.exit(1);
});
