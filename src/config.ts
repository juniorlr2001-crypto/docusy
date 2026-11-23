import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve(process.cwd());
const LOCAL_ENV = path.join(PROJECT_ROOT, '.env');

if (fs.existsSync(LOCAL_ENV)) {
  dotenv.config({ path: LOCAL_ENV });
}

function envFirst(...names: string[]): string {
  for (const name of names) {
    const val = (process.env[name] || '').trim();
    if (val) return val;
  }
  return '';
}

export const CONFIG = {
  PROJECT_ROOT,
  DATA_DIR: path.join(PROJECT_ROOT, 'data'),
  OUTPUT_DIR: path.join(PROJECT_ROOT, 'output'),
  MUSIC_DIR: path.join(PROJECT_ROOT, 'assets', 'music'),
  SFX_DIR: path.join(PROJECT_ROOT, 'assets', 'sfx'),

  // Strictly prefers DOCU_* isolated credentials so this project never drains other projects' quotas
  GEMINI_API_KEY: envFirst('DOCU_GEMINI_API_KEY', 'GEMINI_API_KEY'),
  CLOUDFLARE_ACCOUNT_ID: envFirst('DOCU_CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID'),
  CLOUDFLARE_API_TOKEN: envFirst('DOCU_CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_TOKEN'),
  PEXELS_API_KEY: envFirst('DOCU_PEXELS_API_KEY', 'PEXELS_API_KEY'),
  PIXABAY_API_KEY: envFirst('DOCU_PIXABAY_API_KEY', 'PIXABAY_API_KEY'),

  // Optional Hollywood Cinema tier via fal.ai (FLUX Pro/Dev + Kling/Wan Image-to-Video)
  FAL_KEY: envFirst('DOCU_FAL_KEY', 'FAL_KEY'),
  FAL_IMAGE_MODEL: envFirst('DOCU_FAL_IMAGE_MODEL') || 'fal-ai/flux/dev',
  FAL_VIDEO_MODEL: envFirst('DOCU_FAL_VIDEO_MODEL') || 'fal-ai/kling-video/v1.6/standard/image-to-video',
  MAX_AI_VIDEO_CLIPS_PER_EPISODE: Math.max(0, parseInt(process.env.DOCU_MAX_AI_VIDEOS || '6', 10) || 6),

  // Budget cap for Cloudflare FLUX.1 Schnell (~110 neurons/image -> 28 images ≈ 3,080 neurons/video -> 3 full films/day free)
  MAX_AI_IMAGES_PER_EPISODE: Math.max(0, parseInt(process.env.DOCU_MAX_AI_IMAGES || '28', 10) || 28),

  // Cinema Scope 2.35:1 IMAX letterbox matte (true by default for The Dark Knight movie feel)
  CINEMA_LETTERBOX: (process.env.DOCU_CINEMA_LETTERBOX || 'true').trim().toLowerCase() !== 'false',

  // Strictly isolated YouTube OAuth variables for this documentary channel
  YOUTUBE_CLIENT_ID: envFirst('DOCU_YOUTUBE_CLIENT_ID'),
  YOUTUBE_CLIENT_SECRET: envFirst('DOCU_YOUTUBE_CLIENT_SECRET'),
  YOUTUBE_REFRESH_TOKEN: envFirst('DOCU_YOUTUBE_REFRESH_TOKEN'),
  YOUTUBE_PRIVACY: envFirst('DOCU_YOUTUBE_PRIVACY') || 'unlisted',
  CHANNEL_NAME: envFirst('DOCU_CHANNEL_NAME') || 'Archivos Ocultos',
};

for (const dir of [CONFIG.DATA_DIR, CONFIG.OUTPUT_DIR, CONFIG.MUSIC_DIR, CONFIG.SFX_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
