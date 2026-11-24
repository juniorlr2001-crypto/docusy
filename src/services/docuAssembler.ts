import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { CONFIG } from '../config.js';
import { CameraMotion, CinemaColorLook, CuratedBeatAsset, DocumentaryScript } from '../types.js';
import { getMediaDurationSec } from './narratorTts.js';
import { CinemaSfxPack } from './ambientMusic.js';
import {
  DocuMood,
  buildChapterOpenerOverlayPng,
  buildKeyQuoteOverlayPng,
  buildLocationStampOverlayPng,
  buildShortKineticOverlayPng,
  buildStatDossierOverlayPng,
  renderAnimatedMapClip,
} from './motionGraphics.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

function formatSrtTime(sec: number): string {
  const safe = Math.max(0, sec);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

export function formatYoutubeTimestamp(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function buildChapterSrtCues(
  narrationEs: string,
  startSec: number,
  durationSec: number,
  startIndex: number
): { srtBlocks: string[]; nextIndex: number } {
  const words = narrationEs.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { srtBlocks: [], nextIndex: startIndex };

  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    const endsSentence = /[.!?…]$/.test(w);
    if ((cur.length >= 9 && endsSentence) || cur.length >= 13) {
      chunks.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length > 0) chunks.push(cur.join(' '));

  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0) || 1;
  let cursor = startSec;
  let idx = startIndex;
  const srtBlocks: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const share = (chunks[i].length / totalChars) * durationSec;
    const cStart = cursor;
    const cEnd = i === chunks.length - 1 ? startSec + durationSec : cursor + share;
    cursor = cEnd;
    srtBlocks.push(`${idx++}\n${formatSrtTime(cStart)} --> ${formatSrtTime(cEnd)}\n${chunks[i]}\n`);
  }

  return { srtBlocks, nextIndex: idx };
}

/**
 * Story-adaptive feature-film color grading (6 distinct Hollywood palettes so every documentary
 * has its own authentic visual identity) + subtle 35mm film grain + vignette.
 */
function buildCinemaGradeChain(mood: DocuMood, colorLook?: CinemaColorLook, blurSigma = 0): string {
  const lookGrades: Record<CinemaColorLook, string> = {
    ocean_noir:
      'eq=contrast=1.15:saturation=0.84:brightness=-0.03,colorbalance=rs=-0.06:gs=-0.01:bs=0.08:rh=0.05:gh=0.02:bh=-0.03',
    jungle_emerald:
      'eq=contrast=1.13:saturation=0.96:brightness=-0.02,colorbalance=rs=-0.04:gs=0.05:bs=-0.02:rh=0.07:gh=0.04:bh=-0.04',
    arctic_steel:
      'eq=contrast=1.17:saturation=0.72:brightness=-0.01,colorbalance=rs=-0.05:gs=0.01:bs=0.09:rh=0.01:gh=0.02:bh=0.05',
    coldwar_tungsten:
      'eq=contrast=1.16:saturation=0.80:brightness=-0.04,colorbalance=rs=-0.02:gs=0.02:bs=-0.04:rh=0.09:gh=0.04:bh=-0.07',
    cosmos_gold:
      'eq=contrast=1.14:saturation=1.04:brightness=-0.02,colorbalance=rs=-0.03:gs=0.00:bs=0.06:rh=0.08:gh=0.04:bh=-0.03',
    vintage_sepia:
      'eq=contrast=1.12:saturation=0.74:brightness=-0.03,colorbalance=rs=0.04:gs=0.01:bs=-0.06:rh=0.08:gh=0.05:bh=-0.06',
  };
  const fallbackByMood: Record<DocuMood, CinemaColorLook> = {
    survival: 'ocean_noir',
    tension: 'coldwar_tungsten',
    mystery: 'vintage_sepia',
    awe: 'cosmos_gold',
  };
  const chosenLook = colorLook || fallbackByMood[mood] || 'ocean_noir';
  const parts = [lookGrades[chosenLook]];
  if (blurSigma > 0) {
    parts.push(`gblur=sigma=${blurSigma}`);
  }
  parts.push('noise=alls=4:allf=t+u', 'vignette=PI/4.4');
  return parts.join(',');
}

function buildLetterboxSuffix(width: number, height: number): string {
  if (!CONFIG.CINEMA_LETTERBOX || width <= height) return '';
  const barH = Math.round(height * 0.0667); // 72px on 1080p -> sleek 2.05:1 IMAX/Netflix Scope
  return `,drawbox=x=0:y=0:w=iw:h=${barH}:color=black@1:t=fill,drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:color=black@1:t=fill`;
}

function buildChapterFadeSuffix(durationSec: number, fadeIn: boolean, fadeOut: boolean): string {
  const parts: string[] = [];
  if (fadeIn) parts.push('fade=t=in:st=0:d=0.45');
  if (fadeOut) parts.push(`fade=t=out:st=${Math.max(0, durationSec - 0.45).toFixed(2)}:d=0.45`);
  return parts.length > 0 ? `,${parts.join(',')}` : '';
}

interface TimedOverlaySpec {
  pngPath: string;
  startSec: number;
  endSec: number;
}

/**
 * Renders a real HD moving video B-roll beat (1920x1080 @ 24fps or 1080x1920 @ 30fps)
 * with unified Dark Knight color grading, optional subtle cinematic slow-mo, IMAX letterbox,
 * hard cuts inside chapters, and optional smoothly faded transparent HUD overlay.
 */
function renderVideoBrollBeat(options: {
  videoPath: string;
  srcDurationSec?: number;
  outPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  mood: DocuMood;
  colorLook?: CinemaColorLook;
  blurSigma?: number;
  overlay?: TimedOverlaySpec;
  fadeInChapter?: boolean;
  fadeOutChapter?: boolean;
}): Promise<string> {
  const { videoPath, outPath, durationSec, width, height, fps, mood, colorLook, overlay } = options;
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20_000) {
    return Promise.resolve(outPath);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const srcDur = options.srcDurationSec || 10;
  const needLoop = srcDur < durationSec * 0.72;
  const useSlowMo = !needLoop && srcDur < durationSec * 1.05;
  const slowMoFactor = useSlowMo ? Math.min(1.42, (durationSec + 0.35) / Math.max(2, srcDur)) : 1.0;
  const seekStart = !needLoop && !useSlowMo && srcDur > durationSec + 2.5 ? 1.0 : 0;

  const slowMoPrefix = slowMoFactor > 1.02 ? `setpts=${slowMoFactor.toFixed(3)}*PTS,` : '';
  const grade = buildCinemaGradeChain(mood, colorLook, options.blurSigma || 0);
  const letterbox = buildLetterboxSuffix(width, height);
  const chFade = buildChapterFadeSuffix(durationSec, Boolean(options.fadeInChapter), Boolean(options.fadeOutChapter));

  const baseChain = `${slowMoPrefix}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1,${grade}${letterbox}`;
  const timescale = fps * 1000;

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg().input(videoPath);
    const inOpts: string[] = [];
    if (needLoop) inOpts.push('-stream_loop -1');
    if (seekStart > 0) inOpts.push(`-ss ${seekStart.toFixed(2)}`);
    if (inOpts.length > 0) cmd.inputOptions(inOpts);

    if (overlay && fs.existsSync(overlay.pngPath)) {
      const ovIn = Math.max(0.05, overlay.startSec);
      const ovOut = Math.max(ovIn + 0.5, Math.min(durationSec - 0.42, overlay.endSec - 0.38));
      cmd.input(overlay.pngPath).inputOptions(['-loop 1', `-t ${durationSec.toFixed(3)}`]);
      cmd.complexFilter(
        `[0:v]${baseChain}[bg];[1:v]fps=${fps},format=rgba,fade=t=in:st=${ovIn.toFixed(2)}:d=0.38:alpha=1,fade=t=out:st=${ovOut.toFixed(2)}:d=0.38:alpha=1[ov];[bg][ov]overlay=0:0:shortest=1${chFade},format=yuv420p[outv]`,
        'outv'
      );
    } else {
      cmd.videoFilters(`${baseChain}${chFade},format=yuv420p`);
    }

    cmd
      .outputOptions([
        '-y',
        '-c:v libx264',
        '-preset veryfast',
        '-crf 20',
        `-r ${fps}`,
        `-video_track_timescale ${timescale}`,
        `-t ${durationSec.toFixed(3)}`,
        '-an',
      ])
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', err => reject(err))
      .run();
  });
}

/**
 * Renders a hero AI Cinema or Archival Evidence still frame with smooth Ken Burns push/pan
 * (short 6-9s beats only — NEVER 25s!), Dark Knight IMAX grading, and timed HUD overlays.
 */
function renderStillCinemaBeat(options: {
  imagePath: string;
  outPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  motion: CameraMotion;
  mood: DocuMood;
  colorLook?: CinemaColorLook;
  overlay?: TimedOverlaySpec;
  fadeInChapter?: boolean;
  fadeOutChapter?: boolean;
}): Promise<string> {
  const { imagePath, outPath, durationSec, width, height, fps, motion, mood, colorLook, overlay } = options;
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20_000) {
    return Promise.resolve(outPath);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const frames = Math.max(fps, Math.round(durationSec * fps));
  const upW = Math.round(width * 1.18);
  const upH = Math.round(height * 1.18);

  let zoomExpr = `min(1.14,1.0+0.14*on/${frames})`;
  let xExpr = 'iw/2-(iw/zoom/2)';
  let yExpr = 'ih/2-(ih/zoom/2)';

  if (motion === 'zoom_out') {
    zoomExpr = `max(1.0,1.14-0.14*on/${frames})`;
  } else if (motion === 'pan_right') {
    zoomExpr = '1.12';
    xExpr = `(iw-iw/zoom)*on/${frames}`;
  } else if (motion === 'pan_left') {
    zoomExpr = '1.12';
    xExpr = `(iw-iw/zoom)*(1-on/${frames})`;
  }

  const grade = buildCinemaGradeChain(mood, colorLook, 0);
  const letterbox = buildLetterboxSuffix(width, height);
  const chFade = buildChapterFadeSuffix(durationSec, Boolean(options.fadeInChapter), Boolean(options.fadeOutChapter));
  const timescale = fps * 1000;

  const bgChain = [
    `scale=${upW}:${upH}:force_original_aspect_ratio=increase`,
    `crop=${upW}:${upH}`,
    `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps}`,
    'setsar=1',
    grade,
  ].join(',') + letterbox;

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg().input(imagePath);

    if (overlay && fs.existsSync(overlay.pngPath)) {
      const ovIn = Math.max(0.05, overlay.startSec);
      const ovOut = Math.max(ovIn + 0.5, Math.min(durationSec - 0.42, overlay.endSec - 0.38));
      cmd.input(overlay.pngPath).inputOptions(['-loop 1', `-t ${durationSec.toFixed(3)}`]);
      cmd.complexFilter(
        `[0:v]${bgChain}[bg];[1:v]fps=${fps},format=rgba,fade=t=in:st=${ovIn.toFixed(2)}:d=0.38:alpha=1,fade=t=out:st=${ovOut.toFixed(2)}:d=0.38:alpha=1[ov];[bg][ov]overlay=0:0:shortest=1${chFade},format=yuv420p[outv]`,
        'outv'
      );
    } else {
      cmd.videoFilters(`${bgChain}${chFade},format=yuv420p`);
    }

    cmd
      .outputOptions([
        '-y',
        '-c:v libx264',
        '-preset veryfast',
        '-crf 20',
        `-r ${fps}`,
        `-video_track_timescale ${timescale}`,
        `-t ${durationSec.toFixed(3)}`,
        '-an',
      ])
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', err => reject(err))
      .run();
  });
}

function concatFilesWithDemuxer(fileList: string[], listPath: string, outPath: string, isAudio: boolean): Promise<string> {
  const lines = fileList.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listPath, lines.join('\n') + '\n', 'utf-8');

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg().input(listPath).inputOptions(['-f concat', '-safe 0']);
    if (isAudio) {
      cmd.outputOptions(['-y', '-c:a pcm_s16le', '-ar 44100', '-ac 2']);
    } else {
      cmd.outputOptions(['-y', '-c copy']);
    }
    cmd
      .output(outPath)
      .on('end', () => resolve(outPath))
      .on('error', err => reject(err))
      .run();
  });
}

/**
 * Hollywood cinema audio mix:
 * - Studio voice chain (highpass + gentle compand + clarity boost)
 * - Automatic real-time sidechain ducking on the Hans Zimmer tension score (music swells in pauses, ducks under speech!)
 * - Chapter-opening Zimmer BRAAAM hits + subtle tactical whooshes on Animated Maps & Dossiers
 * - Protected by alimiter so audio is loud, punchy, and 0% clipping
 */
function mixDocumentaryCinemaAudio(params: {
  stitchedVideoPath: string;
  stitchedVoicePath: string;
  musicPath: string;
  sfx: CinemaSfxPack;
  chapterStartSecs: number[];
  whooshSecs: number[];
  totalVoiceDur: number;
  outputVideoPath: string;
}): Promise<void> {
  const { stitchedVideoPath, stitchedVoicePath, musicPath, sfx, totalVoiceDur, outputVideoPath } = params;
  const fadeOutStart = Math.max(0, totalVoiceDur - 1.4).toFixed(2);

  // Cap SFX trigger events cleanly so filtergraph remains snappy
  const braaamEvents = params.chapterStartSecs.slice(0, 8);
  const whooshEvents = params.whooshSecs.slice(0, 10);

  const filterParts: string[] = [];
  filterParts.push(
    `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,highpass=f=70,compand=attacks=0.02:decays=0.22:points=-90/-90|-60/-18|-12/-12|0/0,volume=1.38,asplit=2[voice_main][voice_sc]`
  );
  filterParts.push(
    `[2:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.30,afade=t=in:st=0:d=2.2,afade=t=out:st=${fadeOutStart}:d=1.4[music_pre]`
  );
  filterParts.push(
    `[music_pre][voice_sc]sidechaincompress=threshold=0.022:ratio=5.5:attack=90:release=620:makeup=1[music_ducked]`
  );

  // Build delayed BRAAAM + whoosh SFX bus
  const sfxBusLabels: string[] = [];

  if (braaamEvents.length > 0 && fs.existsSync(sfx.braaamPath)) {
    const splitNames = braaamEvents.map((_, i) => `[br_in_${i}]`).join('');
    filterParts.push(
      `[3:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.52,asplit=${braaamEvents.length}${splitNames}`
    );
    braaamEvents.forEach((sec, i) => {
      const ms = Math.max(10, Math.round(sec * 1000));
      filterParts.push(`[br_in_${i}]adelay=${ms}|${ms}[br_${i}]`);
      sfxBusLabels.push(`[br_${i}]`);
    });
  }

  if (whooshEvents.length > 0 && fs.existsSync(sfx.whooshPath)) {
    const splitNames = whooshEvents.map((_, i) => `[wh_in_${i}]`).join('');
    filterParts.push(
      `[4:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.34,asplit=${whooshEvents.length}${splitNames}`
    );
    whooshEvents.forEach((sec, i) => {
      const ms = Math.max(10, Math.round(sec * 1000));
      filterParts.push(`[wh_in_${i}]adelay=${ms}|${ms}[wh_${i}]`);
      sfxBusLabels.push(`[wh_${i}]`);
    });
  }

  if (sfxBusLabels.length > 0) {
    const nSfx = sfxBusLabels.length;
    if (nSfx === 1) {
      filterParts.push(`${sfxBusLabels[0]}anull[sfx_bus]`);
    } else {
      // Compensate FFmpeg 4.x amix 1/N attenuation so SFX stay crisp & impactful
      filterParts.push(
        `${sfxBusLabels.join('')}amix=inputs=${nSfx}:duration=longest:dropout_transition=0,volume=${nSfx.toFixed(2)}[sfx_bus]`
      );
    }
    filterParts.push(
      `[music_ducked][sfx_bus]amix=inputs=2:duration=first:dropout_transition=0,volume=1.95[bed_full]`
    );
    filterParts.push(
      `[voice_main][bed_full]amix=inputs=2:duration=first:dropout_transition=0,volume=1.92,alimiter=limit=0.95[outa]`
    );
  } else {
    filterParts.push(
      `[voice_main][music_ducked]amix=inputs=2:duration=first:dropout_transition=0,volume=1.92,alimiter=limit=0.95[outa]`
    );
  }

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg()
      .input(stitchedVideoPath)
      .input(stitchedVoicePath)
      .input(musicPath)
      .inputOptions(['-stream_loop -1'])
      .input(sfx.braaamPath)
      .input(sfx.whooshPath);

    cmd
      .complexFilter(filterParts)
      .outputOptions([
        '-y',
        '-map 0:v',
        '-map [outa]',
        '-c:v copy',
        '-c:a aac',
        '-b:a 192k',
        '-movflags +faststart',
        '-shortest',
      ])
      .output(outputVideoPath)
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .run();
  });
}

export interface AssembledDocumentaryOutput {
  documentaryPath: string;
  captionsPath: string;
  durationSec: number;
  chapterTimestamps: Array<{ timestamp: string; title: string; startSec: number }>;
}

/**
 * Motor Visual v2 ("The Dark Knight IMAX Edition"):
 * Assembles Full HD 1920x1080 @ 24fps documentary mixing:
 * - Real HD moving video B-roll & AI Image-to-Video cinema clips
 * - Hero IMAX AI cinema frames & authentic Wikimedia archival evidence
 * - Programmatic Animated Tactical Maps & Stat Dossiers over moving footage
 * - Timed smooth-alpha Chapter Openers (4.6s), Location Stamps (4.2s) & Key Quotes
 * - Crisp hard cuts inside acts, dip-to-black + Zimmer BRAAAM between chapters, sidechain audio ducking!
 */
export async function assembleDocumentaryVideo(params: {
  script: DocumentaryScript;
  chapterAudios: Array<{ chapterNumber: number; audioPath: string; durationSec: number }>;
  beatAssets: Map<number, CuratedBeatAsset>;
  musicPath: string;
  sfx: CinemaSfxPack;
  workDir: string;
  outputVideoPath: string;
  outputSrtPath: string;
}): Promise<AssembledDocumentaryOutput> {
  const { script, chapterAudios, beatAssets, musicPath, sfx, workDir, outputVideoPath, outputSrtPath } = params;
  const clipsDir = path.join(workDir, 'clips_1080p');
  fs.mkdirSync(clipsDir, { recursive: true });

  const WIDTH = 1920;
  const HEIGHT = 1080;
  const FPS = 24;

  const beatClipPaths: string[] = [];
  const beatRenderJobs: Array<() => Promise<void>> = [];
  const audioPaths: string[] = [];
  const srtBlocks: string[] = [];
  const chapterTimestamps: Array<{ timestamp: string; title: string; startSec: number }> = [];
  const whooshSecs: number[] = [];

  let cursorSec = 0;
  let srtIndex = 1;

  for (let chIdx = 0; chIdx < script.chapters.length; chIdx++) {
    const chapter = script.chapters[chIdx];
    const audioInfo = chapterAudios.find(a => a.chapterNumber === chapter.chapterNumber);
    if (!audioInfo) throw new Error(`Falta audio del capítulo ${chapter.chapterNumber}`);

    chapterTimestamps.push({
      timestamp: formatYoutubeTimestamp(cursorSec),
      title: chapter.chapterTitle,
      startSec: cursorSec,
    });

    const { srtBlocks: chSrt, nextIndex } = buildChapterSrtCues(
      chapter.narrationEs,
      cursorSec,
      audioInfo.durationSec,
      srtIndex
    );
    srtBlocks.push(...chSrt);
    srtIndex = nextIndex;
    audioPaths.push(audioInfo.audioPath);

    const perBeatSec = audioInfo.durationSec / Math.max(1, chapter.scenes.length);
    let beatCursor = cursorSec;

    for (let i = 0; i < chapter.scenes.length; i++) {
      const sc = chapter.scenes[i];
      const asset = beatAssets.get(sc.sceneNumber);
      if (!asset) throw new Error(`Falta asset curado para plano ${sc.sceneNumber}`);

      const isChapterFirst = i === 0;
      const isChapterLast = i === chapter.scenes.length - 1;
      const fadeInChapter = isChapterFirst;
      const fadeOutChapter = isChapterLast;

      const pad = String(sc.sceneNumber).padStart(2, '0');
      const clipPath = path.join(clipsDir, `beat_${pad}.mp4`);

      if ((asset.mediaKind === 'animated_map' && asset.mapSpec) || (asset.mediaKind === 'stat_dossier' && asset.statOverlay)) {
        whooshSecs.push(beatCursor);
      }

      beatClipPaths.push(clipPath);
      beatRenderJobs.push(async () => {
        // Build optional timed HUD overlay (chapter opener on beat 0, else locationStamp or keyQuote)
        let timedOverlay: TimedOverlaySpec | undefined;
        if (isChapterFirst) {
          const metaLine = [chapter.chapterLocation, chapter.chapterDate].filter(Boolean).join(' · ');
          const ovPath = path.join(clipsDir, `ov_ch${chapter.chapterNumber}.png`);
          await buildChapterOpenerOverlayPng({
            outPath: ovPath,
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.chapterTitle,
            chapterMeta: metaLine || undefined,
            mood: script.mood,
            width: WIDTH,
            height: HEIGHT,
          });
          timedOverlay = {
            pngPath: ovPath,
            startSec: 0.35,
            endSec: Math.min(perBeatSec - 0.3, 4.8),
          };
        } else if (sc.locationStamp && asset.mediaKind !== 'animated_map' && asset.mediaKind !== 'stat_dossier') {
          const ovPath = path.join(clipsDir, `ov_loc_${pad}.png`);
          await buildLocationStampOverlayPng({
            outPath: ovPath,
            stampText: sc.locationStamp,
            mood: script.mood,
            width: WIDTH,
            height: HEIGHT,
          });
          timedOverlay = {
            pngPath: ovPath,
            startSec: 0.4,
            endSec: Math.min(perBeatSec - 0.3, 4.4),
          };
        } else if (sc.keyQuoteEs && asset.mediaKind !== 'animated_map' && asset.mediaKind !== 'stat_dossier') {
          const ovPath = path.join(clipsDir, `ov_quote_${pad}.png`);
          await buildKeyQuoteOverlayPng({
            outPath: ovPath,
            quoteText: sc.keyQuoteEs,
            mood: script.mood,
            width: WIDTH,
            height: HEIGHT,
          });
          timedOverlay = {
            pngPath: ovPath,
            startSec: 0.5,
            endSec: Math.max(2.2, perBeatSec - 0.5),
          };
        }

        console.log(
          `[DocuAssembler] 🎬 Plano ${sc.sceneNumber} (${asset.mediaKind} · ${perBeatSec.toFixed(1)}s · ${asset.provider})...`
        );

        if (asset.mediaKind === 'animated_map' && asset.mapSpec) {
          await renderAnimatedMapClip({
            mapSpec: asset.mapSpec,
            mood: script.mood,
            outPath: clipPath,
            durationSec: perBeatSec,
            width: WIDTH,
            height: HEIGHT,
            fps: FPS,
            fadeInChapter,
            fadeOutChapter,
            cinemaLetterbox: CONFIG.CINEMA_LETTERBOX,
          });
        } else if (asset.mediaKind === 'stat_dossier' && asset.statOverlay) {
          const dossierPng = path.join(clipsDir, `ov_dossier_${pad}.png`);
          await buildStatDossierOverlayPng({
            stat: asset.statOverlay,
            mood: script.mood,
            width: WIDTH,
            height: HEIGHT,
            outPath: dossierPng,
          });
          const dossierOverlay: TimedOverlaySpec = {
            pngPath: dossierPng,
            startSec: 0.25,
            endSec: Math.max(2.0, perBeatSec - 0.25),
          };

          if (asset.backgroundVideoPath && fs.existsSync(asset.backgroundVideoPath)) {
            await renderVideoBrollBeat({
              videoPath: asset.backgroundVideoPath,
              srcDurationSec: asset.durationSec,
              outPath: clipPath,
              durationSec: perBeatSec,
              width: WIDTH,
              height: HEIGHT,
              fps: FPS,
              mood: script.mood,
              colorLook: script.colorLook,
              blurSigma: 7,
              overlay: dossierOverlay,
              fadeInChapter,
              fadeOutChapter,
            });
          } else {
            const darkBg = path.join(clipsDir, `bg_dossier_${pad}.jpg`);
            if (!fs.existsSync(darkBg)) {
              const bgSvg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="d" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#10253f"/><stop offset="100%" stop-color="#020611"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#d)"/></svg>`;
              await sharp(Buffer.from(bgSvg)).jpeg({ quality: 90 }).toFile(darkBg);
            }
            await renderStillCinemaBeat({
              imagePath: darkBg,
              outPath: clipPath,
              durationSec: perBeatSec,
              width: WIDTH,
              height: HEIGHT,
              fps: FPS,
              motion: 'zoom_in',
              mood: script.mood,
              colorLook: script.colorLook,
              overlay: dossierOverlay,
              fadeInChapter,
              fadeOutChapter,
            });
          }
        } else if (asset.mediaKind === 'video' && asset.filePath && fs.existsSync(asset.filePath)) {
          await renderVideoBrollBeat({
            videoPath: asset.filePath,
            srcDurationSec: asset.durationSec,
            outPath: clipPath,
            durationSec: perBeatSec,
            width: WIDTH,
            height: HEIGHT,
            fps: FPS,
            mood: script.mood,
            colorLook: script.colorLook,
            overlay: timedOverlay,
            fadeInChapter,
            fadeOutChapter,
          });
        } else if (asset.filePath && fs.existsSync(asset.filePath)) {
          await renderStillCinemaBeat({
            imagePath: asset.filePath,
            outPath: clipPath,
            durationSec: perBeatSec,
            width: WIDTH,
            height: HEIGHT,
            fps: FPS,
            motion: sc.cameraMotion,
            mood: script.mood,
            colorLook: script.colorLook,
            overlay: timedOverlay,
            fadeInChapter,
            fadeOutChapter,
          });
        } else {
          throw new Error(`No hay archivo de video o imagen válido para el plano ${sc.sceneNumber}`);
        }
      });

      beatCursor += perBeatSec;
    }

    cursorSec += audioInfo.durationSec;
  }

  // Render 1080p clips in parallel batches of 3 (~3x faster CPU throughput, preserving exact 1..N concat order)
  const CONCURRENCY = 3;
  for (let i = 0; i < beatRenderJobs.length; i += CONCURRENCY) {
    await Promise.all(beatRenderJobs.slice(i, i + CONCURRENCY).map(job => job()));
  }

  fs.writeFileSync(outputSrtPath, srtBlocks.join('\n'), 'utf-8');

  const stitchedVideo = path.join(workDir, 'docu_video_1080p_only.mp4');
  const stitchedVoice = path.join(workDir, 'docu_voice_full.wav');

  console.log(`[DocuAssembler] 🧩 Ensamblando ${beatClipPaths.length} planos Full HD 1080p + ${audioPaths.length} actos de narración...`);
  await concatFilesWithDemuxer(beatClipPaths, path.join(workDir, 'video_list_v2.txt'), stitchedVideo, false);
  await concatFilesWithDemuxer(audioPaths, path.join(workDir, 'audio_list_v2.txt'), stitchedVoice, true);

  const totalVoiceDur = await getMediaDurationSec(stitchedVoice);
  console.log(
    `[DocuAssembler] 🔊 Mezclando máster cinematográfico IMAX (${totalVoiceDur.toFixed(1)}s · ducking + ${chapterTimestamps.length} impactos BRAAAM + ${whooshSecs.length} whooshes)...`
  );
  await mixDocumentaryCinemaAudio({
    stitchedVideoPath: stitchedVideo,
    stitchedVoicePath: stitchedVoice,
    musicPath,
    sfx,
    chapterStartSecs: chapterTimestamps.map(c => c.startSec),
    whooshSecs,
    totalVoiceDur,
    outputVideoPath,
  });

  const finalDur = await getMediaDurationSec(outputVideoPath);
  console.log(`[DocuAssembler] ✅ Documental 1080p IMAX listo: ${outputVideoPath} (${(finalDur / 60).toFixed(2)} min)`);

  return {
    documentaryPath: outputVideoPath,
    captionsPath: outputSrtPath,
    durationSec: finalDur,
    chapterTimestamps,
  };
}

/**
 * Splits Short narration into snappy 3-5 word viral rhythmic caption chunks (~1.8-2.4s each).
 */
function buildViralShortCaptionChunks(narrationEs: string, fallbackHook: string): string[] {
  const words = narrationEs.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [fallbackHook];

  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    const endsPunct = /[.!?…,:;]$/.test(w);
    if (cur.length >= 5 || (cur.length >= 3 && endsPunct)) {
      chunks.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length > 0) chunks.push(cur.join(' '));
  return chunks;
}

/**
 * Motor Visual v2 Bridge Short (1080x1920 @ 30fps Full HD):
 * - Track A: Continuous smooth 7-8 shot moving vertical montage (real 9:16 HD video + animated map + AI hook), ZERO black dips!
 * - Track B: Punchy floating 3-5 word outlined kinetic captions + live bottom progress bar composited seamlessly
 *   without EVER interrupting or resetting the background footage!
 * - Audio: Voiceover + sidechain-ducked Zimmer tension score + opening BRAAAM impact at t=0.0s!
 */
export async function assembleBridgeShortVideo(params: {
  script: DocumentaryScript;
  shortAudioPath: string;
  shortDurationSec: number;
  shortAssets: CuratedBeatAsset[];
  shortThumbnailPath?: string;
  musicPath: string;
  sfx: CinemaSfxPack;
  channelName: string;
  workDir: string;
  outputShortPath: string;
}): Promise<{ shortPath: string; durationSec: number }> {
  const {
    script,
    shortAudioPath,
    shortDurationSec,
    shortAssets,
    shortThumbnailPath,
    musicPath,
    sfx,
    channelName,
    workDir,
    outputShortPath,
  } = params;
  const shortDir = path.join(workDir, 'short_1080p');
  fs.mkdirSync(shortDir, { recursive: true });

  const W = 1080;
  const H = 1920;
  const FPS = 30;
  const timescale = FPS * 1000;

  // 1. Render continuous background montage (zero text yet -> seamless continuous motion!)
  const bgClipPaths: string[] = [];
  const perBgSec = (shortDurationSec + 0.4) / Math.max(1, shortAssets.length);
  const motions: CameraMotion[] = ['zoom_in', 'zoom_out', 'pan_right', 'pan_left'];

  for (let i = 0; i < shortAssets.length; i++) {
    const asset = shortAssets[i];
    const bgOut = path.join(shortDir, `short_bg_${i}.mp4`);

    if (asset.mediaKind === 'animated_map' && asset.mapSpec) {
      await renderAnimatedMapClip({
        mapSpec: asset.mapSpec,
        mood: script.mood,
        outPath: bgOut,
        durationSec: perBgSec,
        width: W,
        height: H,
        fps: FPS,
      });
    } else if (asset.mediaKind === 'video' && asset.filePath && fs.existsSync(asset.filePath)) {
      await renderVideoBrollBeat({
        videoPath: asset.filePath,
        srcDurationSec: asset.durationSec,
        outPath: bgOut,
        durationSec: perBgSec,
        width: W,
        height: H,
        fps: FPS,
        mood: script.mood,
        colorLook: script.colorLook,
      });
    } else if (asset.filePath && fs.existsSync(asset.filePath)) {
      await renderStillCinemaBeat({
        imagePath: asset.filePath,
        outPath: bgOut,
        durationSec: perBgSec,
        width: W,
        height: H,
        fps: FPS,
        motion: motions[i % motions.length],
        mood: script.mood,
        colorLook: script.colorLook,
      });
    }
    if (fs.existsSync(bgOut)) bgClipPaths.push(bgOut);
  }

  const continuousBg = path.join(shortDir, 'short_continuous_bg.mp4');
  await concatFilesWithDemuxer(bgClipPaths, path.join(shortDir, 'short_bg_list.txt'), continuousBg, false);

  // 2. Overlay punchy 3-5 word kinetic captions across exact continuous timeline slices (background never resets!)
  const captionChunks = buildViralShortCaptionChunks(script.bridgeShort.narrationEs, script.bridgeShort.hookTitle);
  const totalChars = captionChunks.reduce((sum, c) => sum + c.length, 0) || 1;

  const captionedSegments: string[] = [];
  let cursor = 0;

  for (let i = 0; i < captionChunks.length; i++) {
    const share = (captionChunks[i].length / totalChars) * shortDurationSec;
    const segDur = i === captionChunks.length - 1
      ? Math.max(0.8, shortDurationSec - cursor)
      : Math.max(0.9, share);

    const ovPng = path.join(shortDir, `short_ov_${i}.png`);
    await buildShortKineticOverlayPng({
      outPath: ovPng,
      hookTitle: script.bridgeShort.hookTitle,
      captionChunk: captionChunks[i],
      channelName,
      progress: (cursor + segDur) / Math.max(1, shortDurationSec),
      showCta: i >= captionChunks.length - 2,
      mood: script.mood,
    });

    const segOut = path.join(shortDir, `short_cap_${i}.mp4`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(continuousBg)
        .inputOptions([`-ss ${cursor.toFixed(3)}`])
        .input(ovPng)
        .inputOptions(['-loop 1', `-t ${segDur.toFixed(3)}`])
        .complexFilter(
          `[0:v]fps=${FPS},setsar=1[bg];[1:v]fps=${FPS},format=rgba[ov];[bg][ov]overlay=0:0:shortest=1,format=yuv420p[outv]`,
          'outv'
        )
        .outputOptions([
          '-y',
          '-c:v libx264',
          '-preset veryfast',
          '-crf 20',
          `-r ${FPS}`,
          `-video_track_timescale ${timescale}`,
          `-t ${segDur.toFixed(3)}`,
          '-an',
        ])
        .output(segOut)
        .on('end', () => resolve())
        .on('error', err => reject(err))
        .run();
    });

    captionedSegments.push(segOut);
    cursor += segDur;
  }

  const stitchedShort = path.join(shortDir, 'short_video_1080p_only.mp4');
  await concatFilesWithDemuxer(captionedSegments, path.join(shortDir, 'short_cap_list.txt'), stitchedShort, false);

  // 3. Mix Short audio: voice + sidechain-ducked Zimmer tension score + opening BRAAAM impact!
  await mixDocumentaryCinemaAudio({
    stitchedVideoPath: stitchedShort,
    stitchedVoicePath: shortAudioPath,
    musicPath,
    sfx,
    chapterStartSecs: [0.02],
    whooshSecs: [shortDurationSec * 0.35],
    totalVoiceDur: shortDurationSec,
    outputVideoPath: outputShortPath,
  });

  const finalDur = await getMediaDurationSec(outputShortPath);
  console.log(`[DocuAssembler] ✅ Short puente 1080x1920 listo: ${outputShortPath} (${finalDur.toFixed(1)}s)`);
  return { shortPath: outputShortPath, durationSec: finalDur };
}
