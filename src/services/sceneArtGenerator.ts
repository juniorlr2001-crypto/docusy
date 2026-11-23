import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { EpisodeMediaCurator } from './mediaCurator.js';

export interface SceneArtOptions {
  promptEn: string;
  styleGuideEn: string;
  pexelsFallbackQuery: string;
  outputPath: string;
  aspect: '16:9' | '9:16';
  curator?: EpisodeMediaCurator;
  ignoreBudget?: boolean;
}

/**
 * Generates an IMAX-grade 100% original hero image using fal.ai or Cloudflare FLUX.1 Schnell.
 * NEVER falls back silently to random off-topic stock photos.
 */
export async function generateSceneArtwork(options: SceneArtOptions): Promise<{ path: string; provider: string } | null> {
  const curator = options.curator || new EpisodeMediaCurator();
  const res = await curator.tryGenerateHeroAiImage({
    promptEn: options.promptEn,
    styleGuideEn: options.styleGuideEn,
    aspect: options.aspect,
    outPath: options.outputPath,
    ignoreBudget: options.ignoreBudget,
  });
  if (res) {
    return { path: res.path, provider: res.provider };
  }

  // Only emit clean dark cinema gradient if caller explicitly needs a placeholder file
  if (!fs.existsSync(options.outputPath)) {
    const w = options.aspect === '16:9' ? 1920 : 1080;
    const h = options.aspect === '16:9' ? 1080 : 1920;
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="62%" cy="44%" r="72%">
          <stop offset="0%" stop-color="#172a45"/>
          <stop offset="55%" stop-color="#091322"/>
          <stop offset="100%" stop-color="#02050d"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>`;
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toFile(options.outputPath);
  }
  return { path: options.outputPath, provider: 'procedural-backdrop' };
}
