import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { AccentPalette, DocumentaryScript, ThumbnailArchetype } from '../types.js';
import { EpisodeMediaCurator } from './mediaCurator.js';
import { escXml } from './motionGraphics.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const PALETTE_COLORS: Record<AccentPalette, { primary: string; badgeBg: string }> = {
  electric_gold: { primary: '#FFE600', badgeBg: '#E11D48' },
  crimson_alert: { primary: '#FF3B30', badgeBg: '#B91C1C' },
  biolum_cyan: { primary: '#00F5D4', badgeBg: '#0284C7' },
  solar_amber: { primary: '#FF9F1C', badgeBg: '#DC2626' },
  ice_laser: { primary: '#38BDF8', badgeBg: '#1D4ED8' },
};

function splitHeadlineLines(headline: string): [string, string] {
  const words = headline.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['CASO', 'IMPOSIBLE'];
  if (words.length === 1) return [words[0], ''];
  if (words.length === 2) return [words[0], words[1]];
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
      .inputOptions(['-ss 00:00:02.5'])
      .outputOptions(['-y', '-vframes 1', '-q:v 2'])
      .output(outImagePath)
      .on('end', () => resolve(outImagePath))
      .on('error', err => reject(err))
      .run();
  });
}

/**
 * Verifies that an image is a genuine photograph/render (high channel stdev) and NOT a blank solid/gradient fallback!
 */
export async function isGenuinePhotographicImage(imgPath: string): Promise<boolean> {
  if (!imgPath || !fs.existsSync(imgPath)) return false;
  try {
    if (fs.statSync(imgPath).size < 18_000) return false;
    const stats = await sharp(imgPath).stats();
    const maxStdev = Math.max(...stats.channels.slice(0, 3).map(c => c.stdev || 0));
    return maxStdev >= 16; // Solid/radial emergency gradients have stdev ~6-11
  } catch {
    return false;
  }
}

function outlinedPosterText(opts: {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  anchor?: 'start' | 'middle' | 'end';
}): string {
  const safe = escXml(opts.text);
  const sw = Math.max(12, Math.round(opts.fontSize * 0.16));
  const anchor = opts.anchor || 'start';
  return [
    `<text x="${opts.x + 5}" y="${opts.y + 10}" text-anchor="${anchor}" fill="#000000" fill-opacity="0.88" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="1.5">${safe}</text>`,
    `<text x="${opts.x}" y="${opts.y}" text-anchor="${anchor}" fill="none" stroke="#000000" stroke-width="${sw}" stroke-linejoin="round" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="1.5">${safe}</text>`,
    `<text x="${opts.x}" y="${opts.y}" text-anchor="${anchor}" fill="${opts.fill}" font-family="Impact, Liberation Sans, Arial Black, Segoe UI, sans-serif" font-size="${opts.fontSize}" font-weight="900" letter-spacing="1.5">${safe}</text>`,
  ].join('');
}

/**
 * Anti-Factory Thumbnail Engine v2.5:
 * - Rotates across 4 distinct poster compositions (`editorial_left`, `editorial_right`, `cinema_bottom`, `forensic_dossier`)
 *   and 5 color palettes so the channel NEVER looks like a repetitive cookie-cutter template!
 * - Rejects flat gradient fallbacks whenever a real AI scene, Wikimedia photo, or HD video frame is available.
 * - Automatically lifts exposure/gamma on dark scenes so mobile screens at 50% brightness always show vivid detail!
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
    allowEmergencyGradient?: boolean;
  }
): Promise<string> {
  const bgPath = path.join(workDir, 'thumb_bg_raw.jpg');
  const curator = options?.curator || new EpisodeMediaCurator();

  const archetype: ThumbnailArchetype = script.creativeDna?.thumbnailArchetype || 'editorial_left';
  const paletteKey: AccentPalette =
    script.creativeDna?.accentPalette || (script.mood === 'tension' ? 'crimson_alert' : 'electric_gold');
  const palette = PALETTE_COLORS[paletteKey] || PALETTE_COLORS.electric_gold;
  const accentColor = palette.primary;

  let bgReady = !options?.forceRegenerateBg && (await isGenuinePhotographicImage(bgPath));

  const compositionPrompt =
    archetype === 'editorial_right'
      ? 'Rule-of-thirds composition: main dramatic brightly-lit focal subject positioned cleanly on the LEFT side of the frame (left 55% of canvas), darker atmospheric negative space on the RIGHT side for title placement'
      : archetype === 'cinema_bottom'
        ? 'Wide IMAX center-top focal composition: main brightly-lit dramatic subject in the upper-center of the frame, darker atmospheric space in the bottom 30% for cinema poster title'
        : 'Rule-of-thirds composition: main dramatic brightly-lit focal subject positioned cleanly on the RIGHT side of the frame (right 55% of canvas), darker atmospheric negative space on the LEFT side for title placement';

  if (!bgReady) {
    const aiBg = await curator.tryGenerateHeroAiImage({
      promptEn: `High-CTR Netflix / National Geographic IMAX 70mm documentary poster: ${script.thumbnailPromptEn}. ${compositionPrompt}. Strong luminous rim lighting and bright clear subject contrast visible on small mobile screens, realistic textures, NO dark silhouette lost in shadow, NO cartoon look, NO text, NO letters, NO watermarks`,
      styleGuideEn: script.visualStyleGuideEn,
      aspect: '16:9',
      outPath: bgPath,
      ignoreBudget: true,
    });
    if (aiBg && (await isGenuinePhotographicImage(bgPath))) {
      bgReady = true;
    }
  }

  if (!bgReady && options?.fallbackImagePath && (await isGenuinePhotographicImage(options.fallbackImagePath))) {
    fs.copyFileSync(options.fallbackImagePath, bgPath);
    bgReady = true;
  }

  if (!bgReady && options?.fallbackVideoPath && fs.existsSync(options.fallbackVideoPath)) {
    try {
      await extractFrameFromVideo(options.fallbackVideoPath, bgPath);
      if (await isGenuinePhotographicImage(bgPath)) {
        bgReady = true;
        console.log('[Thumbnail] 🎞️ Usando fotograma real HD del episodio como base del póster.');
      }
    } catch {
      // fall through
    }
  }

  if (!bgReady) {
    if (options?.allowEmergencyGradient === false) {
      return '';
    }
    const fallbackSvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="fg" cx="68%" cy="45%" r="65%">
          <stop offset="0%" stop-color="#1e3a5f"/>
          <stop offset="55%" stop-color="#0a1628"/>
          <stop offset="100%" stop-color="#02050d"/>
        </radialGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#fg)"/>
    </svg>`;
    await sharp(Buffer.from(fallbackSvg)).jpeg({ quality: 92 }).toFile(bgPath);
  }

  // Inspect actual image luminance so dark underwater/space/night renders get lifted automatically for mobile CTR!
  const imgStats = await sharp(bgPath).stats().catch(() => null);
  const meanLum = imgStats
    ? (imgStats.channels[0].mean + imgStats.channels[1].mean + imgStats.channels[2].mean) / 3
    : 75;
  const brightnessBoost = meanLum < 38 ? 1.38 : meanLum < 56 ? 1.22 : 1.08;
  const gammaBoost = meanLum < 45 ? 1.32 : 1.05;

  const [line1, line2] = splitHeadlineLines(script.thumbnailHeadline);
  const rawSubBadge = (script.thumbnailSubBadge || 'EXPEDIENTE REAL').toUpperCase().trim().slice(0, 22);
  const badgeText = escXml(rawSubBadge);
  const rawStatBadge = script.thumbnailStatBadge
    ? script.thumbnailStatBadge.toUpperCase().trim().slice(0, 15)
    : '';
  const statBadge = escXml(rawStatBadge);

  const statFontSize = rawStatBadge.length > 12 ? 29 : rawStatBadge.length > 9 ? 32 : 36;
  const statPillW = rawStatBadge
    ? Math.min(460, Math.max(205, Math.round(rawStatBadge.length * (statFontSize * 0.72) + 62)))
    : 0;

  let overlaySvg = '';
  let cropPosition: 'east' | 'west' | 'center' = 'east';

  if (archetype === 'editorial_right') {
    cropPosition = 'west';
    const maxChars = Math.max(line1.length, line2.length, 5);
    const fontSize = Math.min(124, Math.max(68, Math.floor(600 / (maxChars * 0.65))));
    const line1Y = line2 ? 415 : 468;
    const line2Y = line1Y + Math.round(fontSize * 1.08);
    const subBadgeFontSize = rawSubBadge.length > 18 ? 22 : 24;
    const subBadgeW = Math.min(520, Math.max(230, Math.round(rawSubBadge.length * (subBadgeFontSize * 0.70) + 52)));
    const barTopY = line2 ? 232 : 284;
    const barHeight = line2 ? Math.round(fontSize * 2.25 + 86) : Math.round(fontSize * 1.25 + 86);

    const statSvg = rawStatBadge
      ? `<rect x="44" y="40" width="${statPillW}" height="68" rx="14" fill="#020617" fill-opacity="0.90" stroke="${accentColor}" stroke-width="4"/>
         <text x="${Math.round(44 + statPillW / 2)}" y="${Math.round(40 + 34 + statFontSize * 0.36)}" text-anchor="middle" fill="${accentColor}" font-family="Arial Black, Liberation Sans, Impact, sans-serif" font-size="${statFontSize}" font-weight="900" letter-spacing="1.5">${statBadge}</text>`
      : '';

    overlaySvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rightScrim" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#020617" stop-opacity="0.90"/>
          <stop offset="38%" stop-color="#020617" stop-opacity="0.56"/>
          <stop offset="58%" stop-color="#020617" stop-opacity="0.04"/>
          <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#rightScrim)"/>
      <rect x="1226" y="${barTopY}" width="12" height="${barHeight}" rx="6" fill="${accentColor}"/>
      <rect x="${1212 - subBadgeW}" y="${barTopY}" width="${subBadgeW}" height="54" rx="11" fill="${palette.badgeBg}" stroke="#FFFFFF" stroke-width="2"/>
      <text x="${Math.round(1212 - subBadgeW / 2)}" y="${Math.round(barTopY + 27 + subBadgeFontSize * 0.36)}" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Liberation Sans, Impact, sans-serif" font-size="${subBadgeFontSize}" font-weight="900" letter-spacing="2">${badgeText}</text>
      ${outlinedPosterText({ x: 1210, y: line1Y, text: line1, fontSize, fill: '#FFFFFF', anchor: 'end' })}
      ${line2 ? outlinedPosterText({ x: 1210, y: line2Y, text: line2, fontSize, fill: accentColor, anchor: 'end' }) : ''}
      ${statSvg}
      <rect x="0" y="708" width="1280" height="12" fill="${accentColor}"/>
    </svg>`;
  } else if (archetype === 'cinema_bottom') {
    cropPosition = 'center';
    const fullText = [line1, line2].filter(Boolean).join(' ');
    const fontSize = Math.min(122, Math.max(74, Math.floor(1120 / (Math.max(6, fullText.length) * 0.64))));
    const statSvg = rawStatBadge
      ? `<rect x="${1236 - statPillW}" y="38" width="${statPillW}" height="68" rx="14" fill="#020617" fill-opacity="0.90" stroke="${accentColor}" stroke-width="4"/>
         <text x="${Math.round(1236 - statPillW / 2)}" y="${Math.round(38 + 34 + statFontSize * 0.36)}" text-anchor="middle" fill="${accentColor}" font-family="Arial Black, Liberation Sans, Impact, sans-serif" font-size="${statFontSize}" font-weight="900" letter-spacing="1.5">${statBadge}</text>`
      : '';
    const subW = Math.min(500, Math.max(240, rawSubBadge.length * 18 + 56));
    overlaySvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cinemaBot" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#020617" stop-opacity="0.93"/>
          <stop offset="34%" stop-color="#020617" stop-opacity="0.52"/>
          <stop offset="56%" stop-color="#020617" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#cinemaBot)"/>
      <rect x="44" y="40" width="${subW}" height="52" rx="10" fill="${palette.badgeBg}" stroke="#FFFFFF" stroke-width="2"/>
      <text x="${Math.round(44 + subW / 2)}" y="74" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Liberation Sans, sans-serif" font-size="23" font-weight="900" letter-spacing="2">${badgeText}</text>
      ${statSvg}
      ${outlinedPosterText({ x: 640, y: 656, text: fullText, fontSize, fill: accentColor, anchor: 'middle' })}
      <rect x="0" y="708" width="1280" height="12" fill="${accentColor}"/>
    </svg>`;
  } else {
    // `editorial_left` & `forensic_dossier`
    cropPosition = 'east';
    const maxChars = Math.max(line1.length, line2.length, 5);
    const fontSize = Math.min(126, Math.max(68, Math.floor(610 / (maxChars * 0.65))));
    const line1Y = line2 ? 412 : 466;
    const line2Y = line1Y + Math.round(fontSize * 1.08);
    const subBadgeFontSize = rawSubBadge.length > 18 ? 23 : 25;
    const subBadgeW = Math.min(530, Math.max(240, Math.round(rawSubBadge.length * (subBadgeFontSize * 0.70) + 56)));
    const barTopY = line2 ? 228 : 280;
    const barHeight = line2 ? Math.round(fontSize * 2.25 + 88) : Math.round(fontSize * 1.25 + 88);

    const statPillX = 1236 - statPillW;
    const statPillSvg = rawStatBadge
      ? `<rect x="${statPillX}" y="40" width="${statPillW}" height="68" rx="14" fill="#020617" fill-opacity="0.90" stroke="${accentColor}" stroke-width="4"/>
         <text x="${Math.round(statPillX + statPillW / 2)}" y="${Math.round(40 + 34 + statFontSize * 0.36)}" text-anchor="middle" fill="${accentColor}" font-family="Arial Black, Liberation Sans, Impact, Segoe UI, sans-serif" font-size="${statFontSize}" font-weight="900" letter-spacing="1.5">${statBadge}</text>`
      : '';

    const dossierBrackets =
      archetype === 'forensic_dossier'
        ? `<path d="M 720 48 L 762 48 M 720 48 L 720 90" stroke="${accentColor}" stroke-width="4" fill="none" stroke-opacity="0.82"/>
           <path d="M 1236 664 L 1194 664 M 1236 664 L 1236 622" stroke="${accentColor}" stroke-width="4" fill="none" stroke-opacity="0.82"/>`
        : '';

    overlaySvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="leftScrim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#020617" stop-opacity="0.88"/>
          <stop offset="36%" stop-color="#020617" stop-opacity="0.52"/>
          <stop offset="56%" stop-color="#020617" stop-opacity="0.04"/>
          <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="bottomScrim" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#020617" stop-opacity="0.58"/>
          <stop offset="26%" stop-color="#020617" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#leftScrim)"/>
      <rect width="1280" height="720" fill="url(#bottomScrim)"/>
      ${dossierBrackets}
      <rect x="42" y="${barTopY}" width="12" height="${barHeight}" rx="6" fill="${accentColor}"/>
      <rect x="68" y="${barTopY}" width="${subBadgeW}" height="56" rx="11" fill="${palette.badgeBg}" stroke="#FFFFFF" stroke-width="2.2"/>
      <text x="${Math.round(68 + subBadgeW / 2)}" y="${Math.round(barTopY + 28 + subBadgeFontSize * 0.36)}" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Liberation Sans, Impact, Segoe UI, sans-serif" font-size="${subBadgeFontSize}" font-weight="900" letter-spacing="2">${badgeText}</text>
      ${outlinedPosterText({ x: 68, y: line1Y, text: line1, fontSize, fill: '#FFFFFF' })}
      ${line2 ? outlinedPosterText({ x: 68, y: line2Y, text: line2, fontSize, fill: accentColor }) : ''}
      ${statPillSvg}
      <rect x="0" y="708" width="1280" height="12" fill="${accentColor}"/>
    </svg>`;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(bgPath)
    .resize(1280, 720, { fit: 'cover', position: cropPosition, kernel: 'lanczos3' })
    .gamma(gammaBoost)
    .modulate({ brightness: brightnessBoost, saturation: 1.15 })
    .linear(1.1, -2)
    .sharpen({ sigma: 1.18 })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 94, mozjpeg: true })
    .toFile(outputPath);

  console.log(
    `[Thumbnail] 🖼️ Póster 16:9 v2.5 (${archetype} · ${paletteKey} · lum=${Math.round(meanLum)}) generado: ${outputPath}`
  );
  return outputPath;
}

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
  ];

  let bgPath = '';
  for (const c of candidates) {
    if (c && (await isGenuinePhotographicImage(c))) {
      bgPath = c;
      break;
    }
  }

  const [line1, line2] = splitHeadlineLines(script.thumbnailHeadline);
  const rawBadge = (script.thumbnailStatBadge || script.thumbnailSubBadge || 'HISTORIA REAL').toUpperCase().trim().slice(0, 22);
  const badgeText = escXml(rawBadge);
  const accentColor =
    script.mood === 'tension' ? '#FF3B30' : script.mood === 'mystery' ? '#38BDF8' : '#FFE600';

  const maxChars = Math.max(line1.length, line2.length, 6);
  const fontSize = maxChars <= 7 ? 136 : maxChars <= 11 ? 110 : 86;
  const line1Y = line2 ? 1260 : 1340;
  const line2Y = line1Y + Math.round(fontSize * 1.12);
  const badgeW = Math.min(680, Math.max(320, Math.round(rawBadge.length * 25 + 88)));

  const overlaySvg = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sTopScrim" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.82"/>
        <stop offset="28%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="sBotScrim" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.92"/>
        <stop offset="44%" stop-color="#020617" stop-opacity="0.45"/>
        <stop offset="68%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#sTopScrim)"/>
    <rect width="1080" height="1920" fill="url(#sBotScrim)"/>
    <rect x="${Math.round((1080 - badgeW) / 2)}" y="185" width="${badgeW}" height="70" rx="14" fill="#DC2626"/>
    <text x="540" y="232" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Liberation Sans, Impact, sans-serif" font-size="32" font-weight="900" letter-spacing="2.5">${badgeText}</text>
    ${outlinedPosterText({ x: 540, y: line1Y, text: line1, fontSize, fill: '#FFFFFF', anchor: 'middle' })}
    ${line2 ? outlinedPosterText({ x: 540, y: line2Y, text: line2, fontSize, fill: accentColor, anchor: 'middle' }) : ''}
  </svg>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const base = bgPath
    ? sharp(bgPath).resize(1080, 1920, { fit: 'cover', position: 'center', kernel: 'lanczos3' }).gamma(1.15).modulate({ brightness: 1.12, saturation: 1.12 })
    : sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 8, g: 16, b: 32, alpha: 1 } } });

  await base
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(outputPath);

  return outputPath;
}
