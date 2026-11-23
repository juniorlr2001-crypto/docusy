import fs from 'fs';
import http from 'http';
import path from 'path';
import readline from 'readline';
import { CONFIG } from './config.js';

const PORT = 4815;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
].join(' ');

function askLine(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function upsertEnvValue(envPath: string, key: string, value: string): void {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = `${content.trimEnd()}\n${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, content, 'utf-8');
}

async function runYouTubeOAuthSetup(): Promise<void> {
  console.log('\n====================================================================');
  console.log('🔐 ASISTENTE OAUTH2 DE YOUTUBE — DOCU-VIRAL ENGINE');
  console.log('====================================================================\n');

  const envPath = path.join(CONFIG.PROJECT_ROOT, '.env');
  let clientId = CONFIG.YOUTUBE_CLIENT_ID;
  let clientSecret = CONFIG.YOUTUBE_CLIENT_SECRET;

  if (!clientId) {
    console.log('1. En Google Cloud Console -> APIs y Servicios -> Biblioteca, habilita "YouTube Data API v3".');
    console.log('2. En Credenciales -> Crear credenciales -> ID de cliente OAuth (Aplicación de escritorio o Web).');
    console.log(`3. Si eliges Aplicación Web, agrega este Redirect URI autorizado: ${REDIRECT_URI}\n`);
    clientId = await askLine('👉 Pega tu DOCU_YOUTUBE_CLIENT_ID: ');
  }
  if (!clientSecret) {
    clientSecret = await askLine('👉 Pega tu DOCU_YOUTUBE_CLIENT_SECRET: ');
  }

  if (!clientId || !clientSecret) {
    throw new Error('Se requieren DOCU_YOUTUBE_CLIENT_ID y DOCU_YOUTUBE_CLIENT_SECRET.');
  }

  upsertEnvValue(envPath, 'DOCU_YOUTUBE_CLIENT_ID', clientId);
  upsertEnvValue(envPath, 'DOCU_YOUTUBE_CLIENT_SECRET', clientSecret);

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

  console.log('\n🌐 Abre este enlace en tu navegador y selecciona el canal de YouTube del proyecto:\n');
  console.log(authUrl);
  console.log(`\n⏳ Esperando autorización en ${REDIRECT_URI} ...\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url || req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      const urlObj = new URL(req.url, `http://localhost:${PORT}`);
      const authCode = urlObj.searchParams.get('code');
      const err = urlObj.searchParams.get('error');

      // If user visits http://localhost:4815 or /oauth2callback directly without code/error, redirect them to Google OAuth!
      if (!authCode && !err) {
        res.writeHead(302, { Location: authUrl });
        res.end();
        return;
      }

      if (err || !authCode) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2>❌ Autorización cancelada: ${err}</h2>`);
        server.close();
        reject(new Error(err || 'No se recibió código OAuth'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>✅ Canal de YouTube (docusy) conectado con éxito. Ya puedes cerrar esta pestaña.</h2>');
      server.close();
      resolve(authCode);
    });

    server.listen(PORT);
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData: any = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.refresh_token) {
    throw new Error(
      `No se obtuvo refresh_token (${tokenRes.status}): ${JSON.stringify(tokenData)}`
    );
  }

  upsertEnvValue(envPath, 'DOCU_YOUTUBE_REFRESH_TOKEN', tokenData.refresh_token);

  console.log('✅ DOCU_YOUTUBE_REFRESH_TOKEN guardado automáticamente en .env\n');
}

runYouTubeOAuthSetup().catch(err => {
  console.error('\n❌ Error en configuración OAuth de YouTube:', err?.message || err);
  process.exit(1);
});
