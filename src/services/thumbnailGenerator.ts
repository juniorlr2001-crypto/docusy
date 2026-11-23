import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { DocumentaryScript } from '../types.js';
import { EpisodeMediaCurator } from './mediaCurator.js';
import { escXml } from './motionGraphics.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

function splitHeadlineLines(headline: string): [string, string] {
  const words = headline.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return [words.join(' '), ''];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function extractFrameFromVideo(videoPath: string, outImagePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .inputOptions(['-ss 00:00:02'])
      .outputOptions(['-y', '-vframes 1', '-q:v 2'])
      .output(outImagePath)
      .on('end', () => resolve(outImagePath))
      .on('error', err => reject(err))
      .run();
  });
}

function outlinedPosterText(opts: {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
}): string {
  const safe = escXml(opts.text);
  const sw = Math.max(10, Math.round(opts.fontSize * 0.14));
  return [
    `<text x="${opts.x}" y="${opts.y + 8}" fill="#000000" fill-opacity="0.72" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="2">${safe}</text>`,
    `<text x="${opts.x}" y="${opts.y}" fill="none" stroke="#020617" stroke-width="${sw}" stroke-linejoin="round" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="2">${safe}</text>`,
    `<text x="${opts.x}" y="${opts.y}" fill="${opts.fill}" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="2">${safe}</text>`,
  ].join('');
}

/**
 * Generates an IMAX / Dark Knight movie-poster style 1280x720 YouTube thumbnail (<2MB JPEG):
 * - Priority 1: Dedicated hero AI cinema frame (fal.ai FLUX / Cloudflare FLUX.1 Schnell)
 * - Priority 2: Sharpest curated HD video frame from the documentary itself (NEVER random unrelated stock photos)
 * - Sculpted contrast scrim keeping 70%+ of the dramatic subject vivid + dual-stroked poster typography + optional stat pill
 */
export async function generateDocumentaryThumbnail(
  script: DocumentaryScript,
  workDir: string,
  outputPath: string,
  options?: {
    curator?: EpisodeMediaCurator;
    fallbackVideoPath?: string;
    fallbackImagePath?: string;
  }
): Promise<string> {
  const bgPath = path.join(workDir, 'thumb_bg_raw.jpg');
  const curator = options?.curator || new EpisodeMediaCurator();

  let bgReady = fs.existsSync(bgPath) && fs.statSync(bgPath).size > 20_000;

  if (!bgReady) {
    const aiBg = await curator.tryGenerateHeroAiImage({
      promptEn: `${script.thumbnailPromptEn}. Dramatic IMAX 70mm theatrical movie poster composition, monumental focal subject clearly lit on the right 60% of frame, moody steel-blue atmosphere with warm amber rim light, dark atmospheric space on the left for title typography`,
      styleGuideEn: script.visualStyleGuideEn,
      aspect: '16:9',
      outPath: bgPath,
      ignoreBudget: true,
    });
    if (aiBg) {
      bgReady = true;
    }
  }

  // Fallback 2: extract real dramatic frame from curated documentary video clip
  if (!bgReady && options?.fallbackVideoPath && fs.existsSync(options.fallbackVideoPath)) {
    try {
      await extractFrameFromVideo(options.fallbackVideoPath, bgPath);
      if (fs.existsSync(bgPath) && fs.statSync(bgPath).size > 15_000) {
        bgReady = true;
        console.log('[Thumbnail] 🎞️ Usando fotograma HD del metraje principal como base del póster.');
      }
    } catch {
      // fall through
    }
  }

  // Fallback 3: reuse best hero scene image
  if (!bgReady && options?.fallbackImagePath && fs.existsSync(options.fallbackImagePath)) {
    fs.copyFileSync(options.fallbackImagePath, bgPath);
    bgReady = true;
  }

  // Emergency offline canvas
  if (!bgReady) {
    const fallbackSvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="fg" cx="72%" cy="45%" r="65%">
          <stop offset="0%" stop-color="#1e3a5f"/>
          <stop offset="55%" stop-color="#0a1628"/>
          <stop offset="100%" stop-color="#02050d"/>
        </radialGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#fg)"/>
    </svg>`;
    await sharp(Buffer.from(fallbackSvg)).jpeg({ quality: 92 }).toFile(bgPath);
  }

  const [line1, line2] = splitHeadlineLines(script.thumbnailHeadline);
  const badgeText = escXml((script.thumbnailSubBadge || 'EXPEDIENTE REAL').toUpperCase().slice(0, 26));
  const statBadge = script.thumbnailStatBadge
    ? escXml(script.thumbnailStatBadge.toUpperCase().slice(0, 16))
    : '';

  const maxChars = Math.max(line1.length, line2.length, 6);
  const fontSize = maxChars <= 8 ? 128 : maxChars <= 12 ? 108 : 88;
  const line1Y = line2 ? 368 : 428;
  const line2Y = line1Y + Math.round(fontSize * 1.08);

  const accentColor =
    script.mood === 'tension'
      ? '#EF4444'
      : script.mood === 'mystery'
        ? '#38BDF8'
        : '#FACC15';

  const statPillW = statBadge ? Math.min(340, Math.max(190, statBadge.length * 22 + 54)) : 0;
  const statPillSvg = statBadge
    ? `<rect x="${1226 - statPillW}" y="46" width="${statPillW}" height="64" rx="12" fill="#020617" fill-opacity="0.86" stroke="${accentColor}" stroke-width="3"/>
       <text x="${1226 - statPillW / 2}" y="89" text-anchor="middle" fill="${accentColor}" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="34" font-weight="900" letter-spacing="2">${statBadge}</text>`
    : '';

  const overlaySvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="leftScrim" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.88"/>
        <stop offset="40%" stop-color="#020617" stop-opacity="0.62"/>
        <stop offset="68%" stop-color="#020617" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bottomScrim" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.72"/>
        <stop offset="32%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <!-- Sculpted IMAX contrast scrims (keeps right 65% subject vivid & crisp) -->
    <rect width="1280" height="720" fill="url(#leftScrim)"/>
    <rect width="1280" height="720" fill="url(#bottomScrim)"/>

    <!-- Left cinema accent bar -->
    <rect x="48" y="156" width="12" height="${line2 ? 368 : 254}" rx="6" fill="${accentColor}"/>

    <!-- Top documentary tag pill -->
    <rect x="78" y="156" width="${Math.min(540, Math.max(240, badgeText.length * 21 + 56))}" height="56" rx="10" fill="#DC2626"/>
    <text x="104" y="193" fill="#FFFFFF" font-family="Arial Black, Impact, Segoe UI, sans-serif" font-size="25" font-weight="900" letter-spacing="2.5">${badgeText}</text>

    <!-- Massive dual-stroked IMAX poster headline -->
    ${outlinedPosterText({ x: 78, y: line1Y, text: line1, fontSize, fill: '#FFFFFF' })}
    ${line2 ? outlinedPosterText({ x: 78, y: line2Y, text: line2, fontSize, fill: accentColor }) : ''}

    <!-- Optional top-right high-CTR stat pill -->
    ${statPillSvg}

    <!-- Subtle sleek cinema bottom accent strip -->
    <rect x="0" y="708" width="1280" height="12" fill="${accentColor}"/>
  </svg>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(bgPath)
    .resize(1280, 720, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
    .linear(1.12, -10)
    .modulate({ saturation: 1.16 })
    .sharpen({ sigma: 1.1 })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 93, mozjpeg: true })
    .toFile(outputPath);

  console.log(`[Thumbnail] 🖼️ Póster IMAX 16:9 generado en: ${outputPath}`);
  return outputPath;
}

/**
 * Generates a high-CTR 1080x1920 vertical 9:16 poster thumbnail for YouTube Shorts / Reels / TikTok,
 * reusing the hero poster background (or first vertical scene) with zero extra AI quota cost.
 */
export async function generateShortThumbnail(
  script: DocumentaryScript,
  workDir: string,
  outputPath: string,
  options?: { fallbackImagePath?: string }
): Promise<string> {
  const candidates = [
    path.join(workDir, 'thumb_bg_raw.jpg'),
    options?.fallbackImagePath || '',
    path.join(workDir, 'scenes_9x16', 'short_scene_1.jpg'),
  ].filter(p => p && fs.existsSync(p) && fs.statSync(p).size > 15_000);

  const bgPath = candidates[0];
  const [line1, line2] = splitHeadlineLines(script.thumbnailHeadline);
  const badgeText = escXml(
    (script.thumbnailStatBadge || script.thumbnailSubBadge || 'HISTORIA REAL').toUpperCase().slice(0, 22)
  );
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const rawHook = (script.bridgeShort.hookTitle || '').trim().toUpperCase();
  const rawHead = (script.thumbnailHeadline || '').trim().toUpperCase();
  const isDuplicate = !rawHook || norm(rawHook) === norm(rawHead) || norm(rawHook).includes(norm(rawHead).slice(0, 12));
  const subPillSource = isDuplicate
    ? (script.thumbnailSubBadge || 'EXPEDIENTE REAL').trim().toUpperCase()
    : rawHook;
  const subPill = escXml(subPillSource.slice(0, 30));

  const accentColor =
    script.mood === 'tension'
      ? '#EF4444'
      : script.mood === 'mystery'
        ? '#38BDF8'
        : '#FACC15';

  const maxChars = Math.max(line1.length, line2.length, 6);
  const fontSize = maxChars <= 7 ? 142 : maxChars <= 11 ? 116 : 92;
  const line1Y = line2 ? 1270 : 1360;
  const line2Y = line1Y + Math.round(fontSize * 1.12);

  const badgeW = Math.min(620, Math.max(320, badgeText.length * 24 + 80));
  const pillW = Math.min(860, Math.max(460, subPill.length * 22 + 80));

  const overlaySvg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sTopScrim" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.86"/>
        <stop offset="30%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="sBotScrim" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.94"/>
        <stop offset="44%" stop-color="#020617" stop-opacity="0.52"/>
        <stop offset="68%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#sTopScrim)"/>
    <rect width="1080" height="1920" fill="url(#sBotScrim)"/>

    <!-- Top date/stat badge -->
    <rect x="${Math.round((1080 - badgeW) / 2)}" y="185" width="${badgeW}" height="70" rx="14" fill="#DC2626"/>
    <text x="540" y="232" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Impact, Segoe UI, sans-serif" font-size="33" font-weight="900" letter-spacing="3">${badgeText}</text>

    <!-- Massive centered vertical movie-poster headline -->
    <text x="540" y="${line1Y + 9}" text-anchor="middle" fill="#000000" fill-opacity="0.78" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line1)}</text>
    <text x="540" y="${line1Y}" text-anchor="middle" fill="none" stroke="#020617" stroke-width="22" stroke-linejoin="round" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line1)}</text>
    <text x="540" y="${line1Y}" text-anchor="middle" fill="#FFFFFF" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line1)}</text>

    ${
      line2
        ? `<text x="540" y="${line2Y + 9}" text-anchor="middle" fill="#000000" fill-opacity="0.78" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line2)}</text>
           <text x="540" y="${line2Y}" text-anchor="middle" fill="none" stroke="#020617" stroke-width="22" stroke-linejoin="round" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line2)}</text>
           <text x="540" y="${line2Y}" text-anchor="middle" fill="${accentColor}" font-family="Impact, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line2)}</text>`
        : ''
    }

    <!-- Bottom hook pill -->
    <rect x="${Math.round((1080 - pillW) / 2)}" y="1510" width="${pillW}" height="74" rx="16" fill="#020617" fill-opacity="0.88" stroke="#FACC15" stroke-width="3"/>
    <text x="540" y="1558" text-anchor="middle" fill="#FACC15" font-family="Arial Black, Segoe UI, sans-serif" font-size="30" font-weight="900" letter-spacing="1.5">${subPill}</text>

    <rect x="0" y="1904" width="1080" height="16" fill="${accentColor}"/>
  </svg>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const base = bgPath
    ? sharp(bgPath).resize(1080, 1920, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
    : sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 8, g: 16, b: 32, alpha: 1 } } });

  await base
    .linear(1.12, -10)
    .modulate({ saturation: 1.15 })
    .sharpen({ sigma: 1.1 })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 93, mozjpeg: true })
    .toFile(outputPath);

  console.log(`[Thumbnail] 📱 Póster vertical Short 9:16 generado en: ${outputPath}`);
  return outputPath;
}
