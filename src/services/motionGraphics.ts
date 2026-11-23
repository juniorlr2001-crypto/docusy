import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import sharp from 'sharp';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { GeoPoint, MapSpec, StatOverlay } from '../types.js';

export type DocuMood = 'tension' | 'mystery' | 'awe' | 'survival';

const MOOD_ACCENTS: Record<DocuMood, { primary: string; glow: string; badgeBg: string }> = {
  survival: { primary: '#FACC15', glow: '#F59E0B', badgeBg: '#DC2626' },
  tension: { primary: '#EF4444', glow: '#F97316', badgeBg: '#B91C1C' },
  mystery: { primary: '#38BDF8', glow: '#0EA5E9', badgeBg: '#0369A1' },
  awe: { primary: '#F59E0B', glow: '#38BDF8', badgeBg: '#1D4ED8' },
};

export function escXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

/**
 * Dual-pass outlined SVG text (stroke layer behind fill layer) so crisp borders work 100%
 * identically across all librsvg / Sharp versions without relying on paint-order support.
 */
function outlinedSvgText(opts: {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  strokeColor?: string;
  strokeWidth?: number;
  anchor?: 'start' | 'middle' | 'end';
  fontFamily?: string;
  letterSpacing?: number;
}): string {
  const safe = escXml(opts.text);
  const anchor = opts.anchor || 'middle';
  const font = opts.fontFamily || 'Arial Black, Impact, Segoe UI, sans-serif';
  const sw = opts.strokeWidth ?? Math.max(4, Math.round(opts.fontSize * 0.14));
  const sc = opts.strokeColor || '#020617';
  const ls = opts.letterSpacing ?? 0;
  return [
    `<text x="${opts.x}" y="${opts.y}" text-anchor="${anchor}" fill="none" stroke="${sc}" stroke-width="${sw}" stroke-linejoin="round" font-family="${font}" font-size="${opts.fontSize}" font-weight="900" letter-spacing="${ls}">${safe}</text>`,
    `<text x="${opts.x}" y="${opts.y}" text-anchor="${anchor}" fill="${opts.fill}" font-family="${font}" font-size="${opts.fontSize}" font-weight="900" letter-spacing="${ls}">${safe}</text>`,
  ].join('');
}

/**
 * Clean, lightweight embedded world continent coastline polygons ([lon, lat] degrees)
 * for accurate dark tactical documentary maps anywhere on Earth — zero external map tile APIs.
 */
const WORLD_POLYGONS: Array<Array<[number, number]>> = [
  // North & Central America
  [
    [-168, 66], [-162, 70], [-141, 70], [-125, 70], [-110, 68], [-94, 69], [-82, 64],
    [-78, 53], [-66, 60], [-55, 52], [-60, 46], [-67, 45], [-70, 41], [-75, 35],
    [-81, 31], [-80, 25], [-83, 29], [-89, 30], [-97, 26], [-97, 19], [-91, 18],
    [-87, 21], [-88, 16], [-83, 15], [-83, 10], [-78, 8], [-81, 7], [-85, 10],
    [-92, 15], [-98, 16], [-105, 20], [-110, 24], [-114, 31], [-117, 32], [-122, 37],
    [-124, 43], [-125, 49], [-131, 54], [-139, 59], [-150, 61], [-162, 55], [-166, 60],
  ],
  // Greenland
  [
    [-72, 77], [-50, 82], [-22, 81], [-18, 70], [-36, 65], [-44, 60], [-52, 64], [-58, 72],
  ],
  // Cuba & Hispaniola
  [[-85, 22], [-79, 23], [-74, 20], [-77, 20], [-82, 22]],
  [[-74, 19], [-68, 19], [-69, 18], [-74, 18]],
  // South America
  [
    [-78, 9], [-72, 12], [-62, 10], [-51, 2], [-41, -3], [-35, -6], [-38, -14],
    [-41, -22], [-48, -26], [-53, -34], [-58, -38], [-65, -43], [-68, -52], [-67, -55],
    [-73, -53], [-75, -45], [-72, -35], [-71, -20], [-81, -5], [-79, 2],
  ],
  // Europe (mainland)
  [
    [-9, 37], [-9, 43], [-2, 43], [-5, 48], [2, 51], [8, 54], [10, 57], [14, 54],
    [21, 55], [28, 60], [21, 65], [14, 68], [25, 71], [32, 69], [42, 67], [60, 69],
    [60, 50], [47, 46], [39, 45], [30, 46], [28, 41], [23, 37], [19, 40], [16, 45],
    [13, 45], [16, 40], [12, 42], [9, 44], [3, 43], [-1, 37], [-6, 36],
  ],
  // Great Britain & Ireland
  [[-6, 50], [-5, 55], [-6, 58], [-2, 58], [1, 53], [1, 51]],
  [[-10, 52], [-9, 55], [-6, 55], [-6, 52]],
  // Iceland
  [[-24, 65], [-19, 66], [-13, 65], [-16, 63], [-22, 64]],
  // Africa
  [
    [-17, 15], [-13, 28], [-6, 36], [10, 37], [11, 33], [25, 32], [32, 31],
    [35, 24], [43, 12], [51, 12], [47, 4], [41, -2], [40, -15], [35, -24],
    [28, -33], [18, -34], [14, -22], [12, -6], [9, 4], [2, 6], [-8, 5], [-16, 11],
  ],
  // Madagascar
  [[44, -25], [47, -25], [50, -13], [48, -13], [44, -19]],
  // Asia
  [
    [28, 41], [36, 41], [42, 41], [48, 39], [54, 42], [60, 50], [60, 69],
    [73, 73], [104, 77], [136, 72], [170, 69], [178, 65], [163, 60], [156, 51],
    [142, 54], [135, 44], [129, 35], [126, 39], [122, 37], [121, 31], [119, 24],
    [110, 20], [108, 12], [103, 1], [100, 7], [97, 16], [90, 22], [80, 14],
    [77, 8], [72, 20], [66, 25], [56, 26], [59, 22], [53, 16], [44, 13],
    [35, 29], [36, 36], [27, 37],
  ],
  // Japan
  [[130, 32], [136, 34], [141, 36], [145, 43], [141, 45], [139, 39], [133, 35]],
  // Philippines
  [[120, 18], [123, 15], [126, 7], [122, 7], [120, 14]],
  // Borneo & Sumatra & Java
  [[109, 2], [116, 6], [118, 1], [115, -3], [110, -3]],
  [[95, 5], [100, 2], [105, -5], [103, -6], [97, 1]],
  [[105, -6], [114, -8], [114, -9], [105, -7]],
  // New Guinea
  [[132, -2], [141, -3], [150, -10], [143, -9], [135, -5]],
  // Australia
  [
    [114, -22], [122, -17], [131, -12], [136, -12], [142, -11], [149, -20],
    [153, -28], [150, -37], [141, -38], [135, -34], [124, -34], [115, -34], [113, -26],
  ],
  // New Zealand
  [[173, -35], [178, -38], [174, -41], [172, -39]],
  [[167, -46], [173, -41], [171, -44], [166, -46]],
  // Antarctica
  [
    [-180, -72], [-120, -73], [-65, -65], [-55, -63], [-30, -73], [0, -70],
    [45, -68], [90, -66], [140, -67], [180, -72], [180, -85], [-180, -85],
  ],
];

function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}`;
}

function parseNumericTarget(label?: string): { num: number; suffix: string } | null {
  if (!label) return null;
  const match = label.match(/([\d.,]+)\s*(.*)$/);
  if (!match) return null;
  const cleaned = match[1].replace(/,/g, '');
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return { num, suffix: match[2].trim() };
}

function formatAnimatedDistance(target: { num: number; suffix: string }, t: number): string {
  const val = Math.round(target.num * Math.max(0, Math.min(1, t)));
  const formatted = val.toLocaleString('en-US');
  return target.suffix ? `${formatted} ${target.suffix}` : formatted;
}

/**
 * Generates an animated 24fps (or 30fps) dark tactical documentary map MP4 with
 * genuine continent coastlines, Pacific anti-meridian wrap handling, pulsing radar pins,
 * progressive curved glowing route beam, and animated live distance counter.
 */
export async function renderAnimatedMapClip(params: {
  mapSpec: MapSpec;
  mood: DocuMood;
  outPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  fadeInChapter?: boolean;
  fadeOutChapter?: boolean;
  cinemaLetterbox?: boolean;
}): Promise<string> {
  const { mapSpec, mood, outPath, durationSec, width, height, fps } = params;
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20_000) {
    return outPath;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const accent = MOOD_ACCENTS[mood] || MOOD_ACCENTS.mystery;
  const fromPt: GeoPoint = mapSpec.from;
  const toPt: GeoPoint | undefined = mapSpec.to;

  // Detect Pacific anti-meridian crossing (e.g. Mexico -94° -> Marshall Islands +168°)
  const usePacificWrap = Boolean(toPt && Math.abs(toPt.lon - fromPt.lon) > 180);
  const shiftLon = (lon: number) => (usePacificWrap && lon < 0 ? lon + 360 : lon);

  const p1Lon = shiftLon(fromPt.lon);
  const p1Lat = fromPt.lat;
  const p2Lon = toPt ? shiftLon(toPt.lon) : p1Lon;
  const p2Lat = toPt ? toPt.lat : p1Lat;

  // Compute smart bounding box maintaining aspect ratio
  const aspect = width / height;
  const rawLonSpan = toPt ? Math.max(28, Math.abs(p2Lon - p1Lon) * 1.55) : 46;
  const rawLatSpan = toPt ? Math.max(18, Math.abs(p2Lat - p1Lat) * 1.95) : 28;
  const centerLon = toPt ? (p1Lon + p2Lon) / 2 : p1Lon;
  const centerLat = toPt ? (p1Lat + p2Lat) / 2 : p1Lat;

  let lonSpan = rawLonSpan;
  let latSpan = rawLatSpan;
  if (lonSpan / latSpan > aspect) {
    latSpan = lonSpan / aspect;
  } else {
    lonSpan = latSpan * aspect;
  }
  // Keep readable planetary scale
  lonSpan = Math.min(220, Math.max(32, lonSpan));
  latSpan = lonSpan / aspect;

  // Pre-build continent copies so anti-meridian wrap never tears coastlines
  const shiftedPolygons: Array<Array<[number, number]>> = [];
  const offsets = usePacificWrap ? [0, 360] : [-360, 0, 360];
  for (const poly of WORLD_POLYGONS) {
    for (const off of offsets) {
      shiftedPolygons.push(poly.map(([lo, la]) => [lo + off, la]));
    }
  }

  // Render at 12fps and output cleanly at target fps (24/30) -> smooth, ~3-4s total build time!
  const renderFps = 12;
  const totalRenderFrames = Math.max(renderFps * 2, Math.round(durationSec * renderFps));
  const distTarget = parseNumericTarget(mapSpec.distanceLabel);
  const safeTitle = escXml((mapSpec.title || 'UBICACIÓN GEOGRÁFICA').toUpperCase().slice(0, 44));
  const safeDate = escXml((mapSpec.dateLabel || '').toUpperCase().slice(0, 34));
  const isVertical = height > width;

  // Spawn FFmpeg stdin image2pipe consumer
  const timescale = fps * 1000;
  const vfParts: string[] = [`fps=${fps}`, 'setsar=1'];
  if (params.fadeInChapter) vfParts.push('fade=t=in:st=0:d=0.45');
  if (params.fadeOutChapter) vfParts.push(`fade=t=out:st=${Math.max(0, durationSec - 0.45).toFixed(2)}:d=0.45`);
  vfParts.push('format=yuv420p');

  const ffProc = spawn(ffmpegInstaller.path, [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-framerate', String(renderFps),
    '-i', 'pipe:0',
    '-vf', vfParts.join(','),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-r', String(fps),
    '-video_track_timescale', String(timescale),
    '-t', durationSec.toFixed(3),
    '-an',
    outPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffStderr = '';
  ffProc.stderr.on('data', chunk => {
    ffStderr += chunk.toString();
  });

  const ffExit = new Promise<void>((resolve, reject) => {
    ffProc.on('error', reject);
    ffProc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg map render falló (code ${code}): ${ffStderr.slice(-300)}`));
    });
  });

  const renderFrameSvg = (frameIdx: number): string => {
    const prog = frameIdx / Math.max(1, totalRenderFrames - 1);
    // Smooth slow camera push-in (1.0 -> 1.09)
    const zoom = 1.0 + 0.09 * prog;
    const curLonSpan = lonSpan / zoom;
    const curLatSpan = latSpan / zoom;
    const minLon = centerLon - curLonSpan / 2;
    const maxLat = centerLat + curLatSpan / 2;

    const proj = (lo: number, la: number): [number, number] => {
      const x = ((lo - minLon) / curLonSpan) * width;
      const y = ((maxLat - la) / curLatSpan) * height;
      return [x, y];
    };

    // Tactical lat/lon grid lines every 15 degrees
    const gridLines: string[] = [];
    const lonStart = Math.floor(minLon / 15) * 15;
    for (let lo = lonStart; lo <= minLon + curLonSpan + 15; lo += 15) {
      const [gx] = proj(lo, centerLat);
      if (gx >= -5 && gx <= width + 5) {
        gridLines.push(`<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${height}" stroke="#1e3a5f" stroke-opacity="0.34" stroke-width="1"/>`);
      }
    }
    const latMin = centerLat - curLatSpan / 2;
    const latStart = Math.floor(latMin / 15) * 15;
    for (let la = latStart; la <= maxLat + 15; la += 15) {
      const [, gy] = proj(centerLon, la);
      if (gy >= -5 && gy <= height + 5) {
        gridLines.push(`<line x1="0" y1="${gy.toFixed(1)}" x2="${width}" y2="${gy.toFixed(1)}" stroke="#1e3a5f" stroke-opacity="0.34" stroke-width="1"/>`);
      }
    }

    // Continent polygons
    const landPaths = shiftedPolygons
      .map(poly => {
        let inside = false;
        const pts = poly.map(([lo, la]) => {
          const [x, y] = proj(lo, la);
          if (x > -200 && x < width + 200 && y > -200 && y < height + 200) inside = true;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        if (!inside) return '';
        return `<polygon points="${pts.join(' ')}" fill="#0f2338" stroke="#38bdf8" stroke-opacity="0.58" stroke-width="1.8" stroke-linejoin="round"/>`;
      })
      .filter(Boolean)
      .join('');

    const [x1, y1] = proj(p1Lon, p1Lat);
    const [x2, y2] = proj(p2Lon, p2Lat);

    // Animated route beam (quadratic Bezier with subtle great-circle arc)
    let routeSvg = '';
    const routeT = Math.max(0, Math.min(1, (prog - 0.14) / 0.58));
    if (toPt && routeT > 0) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distPx = Math.hypot(dx, dy) || 1;
      // Curve slightly upward for cinematic geodesic arc
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2 - Math.min(height * 0.16, distPx * 0.16);

      // Sample points along Bezier up to routeT
      const steps = 40;
      const drawnPts: string[] = [];
      let headX = x1;
      let headY = y1;
      for (let s = 0; s <= steps; s++) {
        const u = (s / steps) * routeT;
        const inv = 1 - u;
        const px = inv * inv * x1 + 2 * inv * u * cx + u * u * x2;
        const py = inv * inv * y1 + 2 * inv * u * cy + u * u * y2;
        drawnPts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
        headX = px;
        headY = py;
      }

      // Faint full preview track + bright glowing animated route + moving head
      routeSvg = [
        `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${accent.primary}" stroke-opacity="0.18" stroke-width="3" stroke-dasharray="10 10"/>`,
        `<polyline points="${drawnPts.join(' ')}" fill="none" stroke="${accent.glow}" stroke-opacity="0.35" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`,
        `<polyline points="${drawnPts.join(' ')}" fill="none" stroke="${accent.primary}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="14 8"/>`,
        `<circle cx="${headX.toFixed(1)}" cy="${headY.toFixed(1)}" r="8" fill="#FFFFFF" stroke="${accent.primary}" stroke-width="4"/>`,
      ].join('');
    }

    // Origin pulsing radar pin
    const pulse1 = ((frameIdx % 18) / 18);
    const pin1Radius = 10 + pulse1 * 34;
    const pin1Opacity = (1 - pulse1) * 0.85;

    const labelW1 = Math.min(360, Math.max(210, fromPt.name.length * 14 + 48));
    const lbl1X = Math.max(30, Math.min(width - labelW1 - 30, x1 - labelW1 / 2));
    const lbl1Y = y1 > height * 0.65 ? y1 - 92 : y1 + 26;

    const originPinSvg = [
      `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="${pin1Radius.toFixed(1)}" fill="none" stroke="#38BDF8" stroke-opacity="${pin1Opacity.toFixed(2)}" stroke-width="2.5"/>`,
      `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="9" fill="#38BDF8" stroke="#FFFFFF" stroke-width="3"/>`,
      `<rect x="${lbl1X.toFixed(1)}" y="${lbl1Y.toFixed(1)}" width="${labelW1}" height="62" rx="10" fill="#020617" fill-opacity="0.88" stroke="#38BDF8" stroke-width="1.8"/>`,
      `<text x="${(lbl1X + 16).toFixed(1)}" y="${(lbl1Y + 28).toFixed(1)}" fill="#FFFFFF" font-family="Arial Black, Segoe UI, sans-serif" font-size="19" font-weight="900">${escXml(fromPt.name.toUpperCase().slice(0, 24))}</text>`,
      `<text x="${(lbl1X + 16).toFixed(1)}" y="${(lbl1Y + 50).toFixed(1)}" fill="#7DD3FC" font-family="Consolas, Segoe UI, monospace" font-size="14" font-weight="700">${escXml(formatCoord(fromPt.lat, fromPt.lon))}</text>`,
    ].join('');

    // Destination pin lights up once route reaches >= 70%
    let destPinSvg = '';
    if (toPt && routeT >= 0.88) {
      const destFade = Math.min(1, (prog - 0.65) / 0.14);
      const pulse2 = (((frameIdx + 9) % 18) / 18);
      const pin2Radius = 12 + pulse2 * 40;
      const pin2Opacity = (1 - pulse2) * 0.9 * destFade;

      const labelW2 = Math.min(380, Math.max(220, toPt.name.length * 14 + 48));
      const lbl2X = Math.max(30, Math.min(width - labelW2 - 30, x2 - labelW2 / 2));
      const lbl2Y = y2 > height * 0.65 ? y2 - 92 : y2 + 26;

      destPinSvg = `<g opacity="${destFade.toFixed(2)}">
        <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="${pin2Radius.toFixed(1)}" fill="none" stroke="${accent.primary}" stroke-opacity="${pin2Opacity.toFixed(2)}" stroke-width="3"/>
        <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="10" fill="${accent.primary}" stroke="#FFFFFF" stroke-width="3"/>
        <rect x="${lbl2X.toFixed(1)}" y="${lbl2Y.toFixed(1)}" width="${labelW2}" height="62" rx="10" fill="#020617" fill-opacity="0.90" stroke="${accent.primary}" stroke-width="2"/>
        <text x="${(lbl2X + 16).toFixed(1)}" y="${(lbl2Y + 28).toFixed(1)}" fill="#FFFFFF" font-family="Arial Black, Segoe UI, sans-serif" font-size="19" font-weight="900">${escXml(toPt.name.toUpperCase().slice(0, 26))}</text>
        <text x="${(lbl2X + 16).toFixed(1)}" y="${(lbl2Y + 50).toFixed(1)}" fill="${accent.primary}" font-family="Consolas, Segoe UI, monospace" font-size="14" font-weight="700">${escXml(formatCoord(toPt.lat, toPt.lon))}</text>
      </g>`;
    }

    // Live distance readout box (bottom right in 16:9; compact pill right below Short hook in 9:16 so zero collision!)
    let distHudSvg = '';
    if (mapSpec.distanceLabel) {
      const liveText = distTarget ? formatAnimatedDistance(distTarget, routeT) : mapSpec.distanceLabel;
      if (isVertical) {
        const dw = 460;
        const dh = 76;
        const dx = Math.round((width - dw) / 2);
        const dy = 264;
        distHudSvg = `
          <rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="14" fill="#020617" fill-opacity="0.88" stroke="${accent.primary}" stroke-width="2.2"/>
          <text x="${width / 2}" y="${dy + 52}" text-anchor="middle" fill="${accent.primary}" font-family="Arial Black, Impact, Segoe UI, sans-serif" font-size="38" font-weight="900" letter-spacing="2">${escXml(liveText.toUpperCase())}</text>
        `;
      } else {
        const dw = 390;
        const dh = 104;
        const dx = width - dw - 60;
        const dy = height - dh - 94;
        distHudSvg = `
          <rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" rx="14" fill="#020617" fill-opacity="0.88" stroke="${accent.primary}" stroke-width="2"/>
          <text x="${dx + 24}" y="${dy + 34}" fill="#94A3B8" font-family="Consolas, Segoe UI, monospace" font-size="16" font-weight="700" letter-spacing="3">DISTANCIA REGISTRADA</text>
          <text x="${dx + 24}" y="${dy + 84}" fill="${accent.primary}" font-family="Arial Black, Impact, Segoe UI, sans-serif" font-size="46" font-weight="900">${escXml(liveText.toUpperCase())}</text>
        `;
      }
    }

    const padX = 72;
    const headerY = 94;
    const headerW = 760;
    const headerSvg = isVertical
      ? ''
      : `<!-- Top-left tactical dossier header -->
      <rect x="${padX}" y="${headerY}" width="${headerW}" height="${safeDate ? 96 : 74}" rx="12" fill="#020617" fill-opacity="0.84" stroke="#38BDF8" stroke-opacity="0.4" stroke-width="1.5"/>
      <rect x="${padX}" y="${headerY}" width="8" height="${safeDate ? 96 : 74}" rx="4" fill="${accent.primary}"/>
      <text x="${padX + 26}" y="${headerY + 30}" fill="${accent.primary}" font-family="Consolas, Segoe UI, monospace" font-size="16" font-weight="700" letter-spacing="3">ARCHIVO GEOGRÁFICO // TELEMETRÍA</text>
      <text x="${padX + 26}" y="${headerY + 62}" fill="#FFFFFF" font-family="Arial Black, Segoe UI, sans-serif" font-size="26" font-weight="900">${safeTitle}</text>
      ${safeDate ? `<text x="${padX + 26}" y="${headerY + 86}" fill="#94A3B8" font-family="Consolas, Segoe UI, monospace" font-size="15" font-weight="700">${safeDate}</text>` : ''}`;

    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="oceanGrad" cx="50%" cy="50%" r="72%">
          <stop offset="0%" stop-color="#0a1f38"/>
          <stop offset="62%" stop-color="#051122"/>
          <stop offset="100%" stop-color="#02060e"/>
        </radialGradient>
        <radialGradient id="mapVig" cx="50%" cy="50%" r="68%">
          <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.68"/>
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#oceanGrad)"/>
      ${gridLines.join('')}
      ${landPaths}
      <rect width="${width}" height="${height}" fill="url(#mapVig)"/>
      ${routeSvg}
      ${originPinSvg}
      ${destPinSvg}
      ${headerSvg}
      ${distHudSvg}

      <!-- Subtle tactical corner brackets -->
      <path d="M 28 ${isVertical ? 58 : 112} L 28 ${isVertical ? 28 : 82} L 58 ${isVertical ? 28 : 82} M ${width - 58} ${isVertical ? 28 : 82} L ${width - 28} ${isVertical ? 28 : 82} L ${width - 28} ${isVertical ? 58 : 112} M 28 ${height - (isVertical ? 58 : 112)} L 28 ${height - (isVertical ? 28 : 82)} L 58 ${height - (isVertical ? 28 : 82)} M ${width - 58} ${height - (isVertical ? 28 : 82)} L ${width - 28} ${height - (isVertical ? 28 : 82)} L ${width - 28} ${height - (isVertical ? 58 : 112)}" fill="none" stroke="#38BDF8" stroke-opacity="0.35" stroke-width="2.5"/>
      ${params.cinemaLetterbox && !isVertical ? `<rect x="0" y="0" width="${width}" height="72" fill="#000000"/><rect x="0" y="${height - 72}" width="${width}" height="72" fill="#000000"/>` : ''}
    </svg>`;
  };

  // Render PNG frames in ordered parallel batches of 6 and pipe sequentially into FFmpeg
  const batchSize = 6;
  for (let start = 0; start < totalRenderFrames; start += batchSize) {
    const indices: number[] = [];
    for (let k = start; k < Math.min(totalRenderFrames, start + batchSize); k++) {
      indices.push(k);
    }
    const buffers = await Promise.all(
      indices.map(idx => sharp(Buffer.from(renderFrameSvg(idx))).png({ compressionLevel: 3 }).toBuffer())
    );
    for (const buf of buffers) {
      const ok = ffProc.stdin.write(buf);
      if (!ok) {
        await new Promise<void>(res => ffProc.stdin.once('drain', () => res()));
      }
    }
  }
  ffProc.stdin.end();
  await ffExit;
  return outPath;
}

/**
 * Builds a sleek transparent PNG overlay for a Documentary Stat / Dossier Impact Card.
 * Designed to composite cleanly with smooth alpha fade-in/out over darkened moving video B-roll.
 */
export async function buildStatDossierOverlayPng(params: {
  stat: StatOverlay;
  mood: DocuMood;
  width: number;
  height: number;
  outPath: string;
}): Promise<string> {
  const { stat, mood, width, height, outPath } = params;
  const accent = MOOD_ACCENTS[mood] || MOOD_ACCENTS.survival;
  const isVertical = height > width;

  const eyebrow = escXml((stat.eyebrow || 'DATO DOCUMENTADO').toUpperCase().slice(0, 38));
  const valueText = (stat.value || '').toUpperCase().slice(0, 22);
  const labelLines = wrapLines((stat.label || '').toUpperCase(), isVertical ? 22 : 34, 2);
  const detailLines = stat.detail ? wrapLines(stat.detail, isVertical ? 32 : 54, 2) : [];

  const cardW = isVertical ? width - 120 : 1220;
  const cardH = isVertical ? 540 : 470;
  const cardX = Math.round((width - cardW) / 2);
  const cardY = Math.round((height - cardH) / 2);

  const valFontSize = valueText.length <= 7 ? (isVertical ? 128 : 156) : valueText.length <= 12 ? (isVertical ? 96 : 122) : (isVertical ? 76 : 94);
  const valY = cardY + (isVertical ? 235 : 225);

  const labelSvg = labelLines
    .map((line, i) =>
      `<text x="${width / 2}" y="${valY + 74 + i * 48}" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Segoe UI, sans-serif" font-size="${isVertical ? 34 : 38}" font-weight="900" letter-spacing="2">${escXml(line)}</text>`
    )
    .join('');

  const detailStartY = valY + 74 + labelLines.length * 48 + 26;
  const detailSvg = detailLines
    .map((line, i) =>
      `<text x="${width / 2}" y="${detailStartY + i * 34}" text-anchor="middle" fill="#CBD5E1" font-family="Segoe UI, Arial, sans-serif" font-size="${isVertical ? 25 : 26}" font-weight="600">${escXml(line)}</text>`
    )
    .join('');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="dimBg" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.58"/>
        <stop offset="100%" stop-color="#020617" stop-opacity="0.86"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#dimBg)"/>

    <!-- Glassmorphic dossier card -->
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="20" fill="#020617" fill-opacity="0.78" stroke="${accent.primary}" stroke-opacity="0.55" stroke-width="2.5"/>

    <!-- Top glowing accent bar -->
    <rect x="${width / 2 - 140}" y="${cardY + 34}" width="280" height="5" rx="2.5" fill="${accent.primary}"/>
    <text x="${width / 2}" y="${cardY + 78}" text-anchor="middle" fill="${accent.primary}" font-family="Consolas, Segoe UI, monospace" font-size="22" font-weight="700" letter-spacing="5">${eyebrow}</text>

    <!-- Massive impact figure -->
    ${outlinedSvgText({
      x: width / 2,
      y: valY,
      text: valueText,
      fontSize: valFontSize,
      fill: accent.primary,
      strokeColor: '#000000',
      strokeWidth: 10,
      letterSpacing: 3,
    })}

    <!-- Subtle horizontal divider -->
    <line x1="${cardX + 120}" y1="${valY + 28}" x2="${cardX + cardW - 120}" y2="${valY + 28}" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1.5"/>

    ${labelSvg}
    ${detailSvg}

    <!-- Minimalist dossier corner accents -->
    <path d="M ${cardX + 18} ${cardY + 46} L ${cardX + 18} ${cardY + 18} L ${cardX + 46} ${cardY + 18} M ${cardX + cardW - 46} ${cardY + 18} L ${cardX + cardW - 18} ${cardY + 18} L ${cardX + cardW - 18} ${cardY + 46} M ${cardX + 18} ${cardY + cardH - 46} L ${cardX + 18} ${cardY + cardH - 18} L ${cardX + 46} ${cardY + cardH - 18} M ${cardX + cardW - 46} ${cardY + cardH - 18} L ${cardX + cardW - 18} ${cardY + cardH - 18} L ${cardX + cardW - 18} ${cardY + cardH - 46}" fill="none" stroke="#FFFFFF" stroke-opacity="0.45" stroke-width="2.5"/>
  </svg>`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  return outPath;
}

/**
 * Sleek cinematic 1920x1080 Chapter Opener lower-third overlay (composited for ~4.6s only, NOT 25s).
 */
export async function buildChapterOpenerOverlayPng(params: {
  outPath: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterMeta?: string;
  mood: DocuMood;
  width?: number;
  height?: number;
}): Promise<string> {
  const width = params.width || 1920;
  const height = params.height || 1080;
  const accent = MOOD_ACCENTS[params.mood] || MOOD_ACCENTS.survival;
  const safeTitle = escXml(params.chapterTitle.toUpperCase().slice(0, 44));
  const safeMeta = params.chapterMeta ? escXml(params.chapterMeta.toUpperCase().slice(0, 48)) : '';
  const chNumStr = String(params.chapterNumber).padStart(2, '0');

  const barY = height - 255;
  const barH = safeMeta ? 172 : 144;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="chGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.92"/>
        <stop offset="72%" stop-color="#020617" stop-opacity="0.66"/>
        <stop offset="100%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${barY}" width="${Math.round(width * 0.72)}" height="${barH}" fill="url(#chGrad)"/>
    <rect x="82" y="${barY + 24}" width="10" height="${barH - 48}" rx="5" fill="${accent.primary}"/>
    <text x="116" y="${barY + 60}" fill="${accent.primary}" font-family="Consolas, Arial Black, Segoe UI, sans-serif" font-size="26" font-weight="900" letter-spacing="5">CAPÍTULO ${chNumStr}</text>
    <text x="116" y="${barY + 118}" fill="#FFFFFF" font-family="Arial Black, Impact, Segoe UI, sans-serif" font-size="50" font-weight="900" letter-spacing="1">${safeTitle}</text>
    ${safeMeta ? `<text x="116" y="${barY + 154}" fill="#94A3B8" font-family="Consolas, Segoe UI, monospace" font-size="22" font-weight="700" letter-spacing="2">${safeMeta}</text>` : ''}
  </svg>`;

  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(params.outPath);
  return params.outPath;
}

/**
 * Clean top-left documentary Location / Date Stamp pill (appears briefly for ~4 seconds).
 */
export async function buildLocationStampOverlayPng(params: {
  outPath: string;
  stampText: string;
  mood: DocuMood;
  width?: number;
  height?: number;
}): Promise<string> {
  const width = params.width || 1920;
  const height = params.height || 1080;
  const accent = MOOD_ACCENTS[params.mood] || MOOD_ACCENTS.survival;
  const clean = params.stampText.trim().toUpperCase().slice(0, 48);
  const pillW = Math.min(820, Math.max(280, clean.length * 16 + 76));

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="72" y="96" width="${pillW}" height="56" rx="10" fill="#020617" fill-opacity="0.82" stroke="${accent.primary}" stroke-opacity="0.60" stroke-width="1.8"/>
    <circle cx="102" cy="124" r="7" fill="${accent.primary}"/>
    <text x="124" y="132" fill="#F8FAFC" font-family="Consolas, Segoe UI, monospace" font-size="22" font-weight="700" letter-spacing="2">${escXml(clean)}</text>
  </svg>`;

  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(params.outPath);
  return params.outPath;
}

/**
 * Tasteful bottom-third documentary Key Phrase emphasis overlay (smooth floating outlined text, no clunky box).
 */
export async function buildKeyQuoteOverlayPng(params: {
  outPath: string;
  quoteText: string;
  mood: DocuMood;
  width?: number;
  height?: number;
}): Promise<string> {
  const width = params.width || 1920;
  const height = params.height || 1080;
  const accent = MOOD_ACCENTS[params.mood] || MOOD_ACCENTS.survival;
  const lines = wrapLines(params.quoteText.trim(), 44, 2);

  const baseY = height - 156 - (lines.length - 1) * 56;
  const textSvg = lines
    .map((line, i) =>
      outlinedSvgText({
        x: width / 2,
        y: baseY + i * 58,
        text: line,
        fontSize: 44,
        fill: i === lines.length - 1 ? accent.primary : '#FFFFFF',
        strokeColor: '#020617',
        strokeWidth: 8,
        letterSpacing: 1,
      })
    )
    .join('');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="qScrim" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.82"/>
        <stop offset="28%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#qScrim)"/>
    <rect x="${width / 2 - 48}" y="${baseY - 62}" width="96" height="4" rx="2" fill="${accent.primary}"/>
    ${textSvg}
  </svg>`;

  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(params.outPath);
  return params.outPath;
}

/**
 * High-retention 1080x1920 vertical Short kinetic caption overlay:
 * - Floating bold outlined captions (3-5 punchy words, NO opaque box hiding the video!)
 * - Clean top safe-zone hook badge
 * - Smooth glowing progress bar along the safe bottom margin
 * - Final CTA banner pointing to the full documentary
 */
export async function buildShortKineticOverlayPng(params: {
  outPath: string;
  hookTitle: string;
  captionChunk: string;
  channelName: string;
  progress: number; // 0..1
  showCta: boolean;
  mood: DocuMood;
}): Promise<string> {
  const width = 1080;
  const height = 1920;
  const accent = MOOD_ACCENTS[params.mood] || MOOD_ACCENTS.survival;

  const safeHook = escXml(params.hookTitle.toUpperCase().slice(0, 34));
  const captionLines = wrapLines(params.captionChunk.toUpperCase(), 16, 3);
  const safeChan = escXml(params.channelName.toUpperCase());

  const startY = 1230 - (captionLines.length - 1) * 44;
  const captionSvg = captionLines
    .map((line, i) =>
      outlinedSvgText({
        x: width / 2,
        y: startY + i * 86,
        text: line,
        fontSize: 70,
        fill: i === captionLines.length - 1 ? '#FACC15' : '#FFFFFF',
        strokeColor: '#020617',
        strokeWidth: 14,
        letterSpacing: 1,
      })
    )
    .join('');

  const ctaSvg = params.showCta
    ? `<rect x="96" y="1475" width="888" height="96" rx="20" fill="${accent.primary}"/>
       <text x="540" y="1536" text-anchor="middle" fill="#020617" font-family="Arial Black, Segoe UI, sans-serif" font-size="34" font-weight="900">DOCUMENTAL COMPLETO EN EL CANAL</text>`
    : '';

  const barW = 860;
  const barFillW = Math.max(18, Math.round(barW * Math.max(0, Math.min(1, params.progress))));

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sTop" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.78"/>
        <stop offset="22%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="sBot" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.86"/>
        <stop offset="44%" stop-color="#020617" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#sTop)"/>
    <rect width="${width}" height="${height}" fill="url(#sBot)"/>

    <!-- Clean top safe-zone hook pill -->
    <rect x="88" y="158" width="904" height="76" rx="38" fill="#020617" fill-opacity="0.80" stroke="${accent.primary}" stroke-width="3"/>
    <text x="540" y="208" text-anchor="middle" fill="${accent.primary}" font-family="Arial Black, Segoe UI, sans-serif" font-size="31" font-weight="900" letter-spacing="1.5">${safeHook}</text>

    <!-- Floating viral outlined kinetic captions (zero opaque box blocking footage) -->
    ${captionSvg}

    ${ctaSvg}

    <!-- Progress bar + channel signature -->
    <rect x="110" y="1628" width="${barW}" height="8" rx="4" fill="#FFFFFF" fill-opacity="0.22"/>
    <rect x="110" y="1628" width="${barFillW}" height="8" rx="4" fill="${accent.primary}"/>
    <text x="540" y="1676" text-anchor="middle" fill="#CBD5E1" fill-opacity="0.82" font-family="Consolas, Segoe UI, sans-serif" font-size="24" font-weight="700" letter-spacing="4">${safeChan}</text>
  </svg>`;

  fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(params.outPath);
  return params.outPath;
}
