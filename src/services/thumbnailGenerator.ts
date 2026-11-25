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
  if (words.length === 0) return ['HISTORIA', 'REAL'];
  if (words.length === 1) return [words[0], ''];
  if (words.length === 2) return [words[0], words[1]];
  // Balance character length between line 1 and line 2 for maximum font size
  let bestSplit = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ');
    const l2 = words.slice(i).join(' ');
    const diff = Math.abs(l1.length - l2.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSplit = i;
    }
  }
  return [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
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
  const sw = Math.max(12, Math.round(opts.fontSize * 0.16));
  return [
    `<text x="${opts.x + 5}" y="${opts.y + 10}" fill="#000000" fill-opacity="0.88" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="1.5">${safe}</text>`,
    `<text x="${opts.x}" y="${opts.y}" fill="none" stroke="#000000" stroke-width="${sw}" stroke-linejoin="round" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="1.5">${safe}</text>`,
    `<text x="${opts.x}" y="${opts.y}" fill="${opts.fill}" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="1.5">${safe}</text>`,
  ].join('');
}

/**
 * Thumbnail Engine 2.0 (Netflix / Lemmino / Veritasium High-CTR Edition):
 * - Strict Rule-of-Thirds layout: Typography stays within the left 52% (x=68..680) so it NEVER covers faces or focal subjects on the right!
 * - Auto-scaling top-right stat badge that NEVER overflows its yellow border box (even for 14-16 char strings like "12,262 METROS").
 * - Authentic photorealistic 70mm cinema color grading (no burnt neon-orange cartoon skin).
 * - Multi-attempt AI generation with dedicated retry so thumbnails never fall back to unrelated stock beaches.
 */
export async function generateDocumentaryThumbnail(
  script: DocumentaryScript,
  workDir: string,
  outputPath: string,
  options?: {
    curator?: EpisodeMediaCurator;
    fallbackVideoPath?: string;
    fallbackImagePath?: string;
    forceRegenerateBg?: boolean;
  }
): Promise<string> {
  const bgPath = path.join(workDir, 'thumb_bg_raw.jpg');
  const curator = options?.curator || new EpisodeMediaCurator();

  let bgReady =
    !options?.forceRegenerateBg &&
    fs.existsSync(bgPath) &&
    fs.statSync(bgPath).size > 20_000;

  if (!bgReady) {
    const aiBg = await curator.tryGenerateHeroAiImage({
      promptEn: `Netflix / National Geographic IMAX 70mm documentary poster frame: ${script.thumbnailPromptEn}. Rule-of-thirds composition: main focal subject or dramatic historical scene positioned cleanly on the RIGHT side of the frame (right 55% of canvas), darker atmospheric negative space on the LEFT side (left 40% of canvas) for title placement. Authentic photorealistic cinema photography, natural realistic skin texture and lighting, dramatic volumetric rim light, ultra-sharp focus, 8k detail, NO cartoon or painted look, NO oversaturated orange skin, NO text, NO letters, NO watermarks`,
      styleGuideEn: script.visualStyleGuideEn,
      aspect: '16:9',
      outPath: bgPath,
      ignoreBudget: true,
    });
    if (aiBg) {
      bgReady = true;
    }
  }

  // Fallback 2: reuse best hero AI scene image before ever touching generic stock video
  if (!bgReady && options?.fallbackImagePath && fs.existsSync(options.fallbackImagePath)) {
    fs.copyFileSync(options.fallbackImagePath, bgPath);
    bgReady = true;
  }

  // Fallback 3: extract real dramatic frame from curated documentary video clip
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
  const rawSubBadge = (script.thumbnailSubBadge || 'EXPEDIENTE REAL').toUpperCase().trim().slice(0, 24);
  const badgeText = escXml(rawSubBadge);
  const rawStatBadge = script.thumbnailStatBadge
    ? script.thumbnailStatBadge.toUpperCase().trim().slice(0, 16)
    : '';
  const statBadge = escXml(rawStatBadge);

  // Strict width cap: keep headline inside the left 52% of the frame (max ~610px width)
  // so it NEVER covers faces or focal objects on the right half of the thumbnail!
  const maxChars = Math.max(line1.length, line2.length, 5);
  const fittedByWidth = Math.floor(610 / (maxChars * 0.65));
  const fontSize = Math.min(128, Math.max(68, fittedByWidth));
  const line1Y = line2 ? 410 : 465;
  const line2Y = line1Y + Math.round(fontSize * 1.08);

  // High-CTR electric yellow (#FFE600) or vibrant red (#FF3B30) for line 2
  const accentColor = script.mood === 'tension' ? '#FF3B30' : '#FFE600';

  // Auto-fitting top-right stat pill: dynamically adjusts font-size and width so text NEVER overflows the box
  const statFontSize = rawStatBadge.length > 13 ? 29 : rawStatBadge.length > 10 ? 32 : 36;
  const statPillW = rawStatBadge
    ? Math.min(470, Math.max(210, Math.round(rawStatBadge.length * (statFontSize * 0.72) + 64)))
    : 0;
  const statPillX = 1236 - statPillW;
  const statPillSvg = rawStatBadge
    ? `<rect x="${statPillX}" y="40" width="${statPillW}" height="68" rx="14" fill="#020617" fill-opacity="0.90" stroke="${accentColor}" stroke-width="4"/>
       <text x="${Math.round(statPillX + statPillW / 2)}" y="${Math.round(40 + 34 + statFontSize * 0.36)}" text-anchor="middle" fill="${accentColor}" font-family="Arial Black, Liberation Sans, Impact, Segoe UI, sans-serif" font-size="${statFontSize}" font-weight="900" letter-spacing="1.5">${statBadge}</text>`
    : '';

  const subBadgeFontSize = rawSubBadge.length > 18 ? 23 : 25;
  const subBadgeW = Math.min(540, Math.max(240, Math.round(rawSubBadge.length * (subBadgeFontSize * 0.70) + 56)));
  const barTopY = line2 ? 228 : 280;
  const barHeight = line2 ? Math.round(fontSize * 2.25 + 88) : Math.round(fontSize * 1.25 + 88);

  const overlaySvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="leftScrim" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.88"/>
        <stop offset="36%" stop-color="#020617" stop-opacity="0.54"/>
        <stop offset="56%" stop-color="#020617" stop-opacity="0.05"/>
        <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bottomScrim" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.62"/>
        <stop offset="28%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="subjectGlow" cx="76%" cy="46%" r="48%">
        <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.12"/>
        <stop offset="60%" stop-color="#38BDF8" stop-opacity="0.05"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <!-- Subtle subject spotlight + localized left text contrast scrim (keeps right subject 100% clean & sharp) -->
    <rect width="1280" height="720" fill="url(#subjectGlow)"/>
    <rect width="1280" height="720" fill="url(#leftScrim)"/>
    <rect width="1280" height="720" fill="url(#bottomScrim)"/>

    <!-- Left high-impact accent bar -->
    <rect x="42" y="${barTopY}" width="12" height="${barHeight}" rx="6" fill="${accentColor}"/>

    <!-- Top high-contrast crimson badge -->
    <rect x="68" y="${barTopY}" width="${subBadgeW}" height="56" rx="11" fill="#E11D48" stroke="#FFFFFF" stroke-width="2.2"/>
    <text x="${Math.round(68 + subBadgeW / 2)}" y="${Math.round(barTopY + 28 + subBadgeFontSize * 0.36)}" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Liberation Sans, Impact, Segoe UI, sans-serif" font-size="${subBadgeFontSize}" font-weight="900" letter-spacing="2">${badgeText}</text>

    <!-- Compact left-zone dual-stroked 2-line poster headline (never crosses over the right-side focal subject) -->
    ${outlinedPosterText({ x: 68, y: line1Y, text: line1, fontSize, fill: '#FFFFFF' })}
    ${line2 ? outlinedPosterText({ x: 68, y: line2Y, text: line2, fontSize, fill: accentColor }) : ''}

    <!-- Top-right auto-fitted high-CTR stat pill -->
    ${statPillSvg}

    <!-- High-visibility frame border bar -->
    <rect x="0" y="708" width="1280" height="12" fill="${accentColor}"/>
  </svg>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(bgPath)
    .resize(1280, 720, { fit: 'cover', position: 'east', kernel: 'lanczos3' })
    .modulate({ brightness: 1.07, saturation: 1.12 })
    .linear(1.08, -3)
    .sharpen({ sigma: 1.15 })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 94, mozjpeg: true })
    .toFile(outputPath);

  console.log(`[Thumbnail] 🖼️ Póster IMAX 16:9 v2.0 generado en: ${outputPath}`);
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
  const rawBadge = (script.thumbnailStatBadge || script.thumbnailSubBadge || 'HISTORIA REAL').toUpperCase().trim().slice(0, 22);
  const badgeText = escXml(rawBadge);
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
  const fontSize = maxChars <= 7 ? 136 : maxChars <= 11 ? 110 : 86;
  const line1Y = line2 ? 1270 : 1360;
  const line2Y = line1Y + Math.round(fontSize * 1.12);

  const badgeW = Math.min(680, Math.max(320, Math.round(rawBadge.length * 25 + 88)));
  const pillW = Math.min(920, Math.max(460, Math.round(subPillSource.slice(0, 30).length * 23 + 88)));

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
    <text x="540" y="232" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Liberation Sans, Impact, Segoe UI, sans-serif" font-size="32" font-weight="900" letter-spacing="2.5">${badgeText}</text>

    <!-- Massive centered vertical movie-poster headline -->
    <text x="540" y="${line1Y + 9}" text-anchor="middle" fill="#000000" fill-opacity="0.78" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line1)}</text>
    <text x="540" y="${line1Y}" text-anchor="middle" fill="none" stroke="#020617" stroke-width="22" stroke-linejoin="round" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line1)}</text>
    <text x="540" y="${line1Y}" text-anchor="middle" fill="#FFFFFF" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line1)}</text>

    ${
      line2
        ? `<text x="540" y="${line2Y + 9}" text-anchor="middle" fill="#000000" fill-opacity="0.78" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line2)}</text>
           <text x="540" y="${line2Y}" text-anchor="middle" fill="none" stroke="#020617" stroke-width="22" stroke-linejoin="round" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line2)}</text>
           <text x="540" y="${line2Y}" text-anchor="middle" fill="${accentColor}" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="2">${escXml(line2)}</text>`
        : ''
    }

    <!-- Bottom hook pill -->
    <rect x="${Math.round((1080 - pillW) / 2)}" y="1510" width="${pillW}" height="74" rx="16" fill="#020617" fill-opacity="0.88" stroke="#FACC15" stroke-width="3"/>
    <text x="540" y="1558" text-anchor="middle" fill="#FACC15" font-family="Arial Black, Liberation Sans, Segoe UI, sans-serif" font-size="29" font-weight="900" letter-spacing="1.5">${subPill}</text>

    <rect x="0" y="1904" width="1080" height="16" fill="${accentColor}"/>
  </svg>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const base = bgPath
    ? sharp(bgPath).resize(1080, 1920, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
    : sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 8, g: 16, b: 32, alpha: 1 } } });

  await base
    .linear(1.08, -6)
    .modulate({ saturation: 1.10 })
    .sharpen({ sigma: 1.1 })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 93, mozjpeg: true })
    .toFile(outputPath);

  console.log(`[Thumbnail] 📱 Póster vertical Short 9:16 generado en: ${outputPath}`);
  return outputPath;
}
