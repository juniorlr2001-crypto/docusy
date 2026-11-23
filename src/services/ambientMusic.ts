import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { CONFIG } from '../config.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface CinemaSfxPack {
  braaamPath: string;
  whooshPath: string;
  riserPath: string;
}

/**
 * Ensures a 100% copyright-free Hans-Zimmer-inspired cinematic thriller documentary score.
 * 1. If the user puts custom YouTube Audio Library MP3s in assets/music/ (not prefixed with synth_),
 *    those real studio tracks are selected first (rotated deterministically by mood).
 * 2. Otherwise FFmpeg synthesizes a rich Dark-Knight-inspired multi-layer tension ostinato:
 *    - Deep rhythmic pulsing cello/synth sub-ostinato (driving momentum, never a flat stagnant drone!)
 *    - Ominous minor brass/string pad swells
 *    - Subtle dark filtered storm/room atmosphere bed
 */
export async function ensureDocumentaryMusicBed(
  mood: 'tension' | 'mystery' | 'awe' | 'survival'
): Promise<string> {
  if (fs.existsSync(CONFIG.MUSIC_DIR)) {
    const customFiles = fs
      .readdirSync(CONFIG.MUSIC_DIR)
      .filter(f => /\.(mp3|wav|m4a)$/i.test(f) && !f.startsWith('synth_'))
      .sort();
    if (customFiles.length > 0) {
      const moodIdx = ['survival', 'tension', 'mystery', 'awe'].indexOf(mood);
      const picked = path.join(CONFIG.MUSIC_DIR, customFiles[Math.max(0, moodIdx) % customFiles.length]);
      console.log(`[AmbientMusic] 🎵 Usando banda sonora cinematográfica personalizada: ${path.basename(picked)}`);
      return picked;
    }
  }

  const outPath = path.join(CONFIG.MUSIC_DIR, `synth_v2_imax_${mood}.mp3`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 40_000) {
    return outPath;
  }

  // Dark minor-key frequencies (Hz): [subRoot, bassFifth, minorThirdPad, tensionUpper, pulseHz]
  const scoreMap: Record<string, [number, number, number, number, number]> = {
    tension: [55.0, 82.41, 130.81, 164.81, 2.2],   // A minor Dark Knight driving pulse
    survival: [65.41, 98.0, 155.56, 196.0, 1.85],  // C minor relentless oceanic tension
    mystery: [73.42, 110.0, 174.61, 220.0, 1.5],   // D minor brooding enigma ostinato
    awe: [61.74, 92.5, 146.83, 185.0, 1.35],       // B minor cosmic Interstellar swell
  };
  const [f1, f2, f3, f4, pulseHz] = scoreMap[mood] || scoreMap.tension;
  const dur = 90; // 90s cinematic loop with evolving tension arc

  // Rhythmic Zimmer-style dark pulse + warm harmonic brass/cello overtones + slow dramatic breathing arc
  const arc = `(0.62+0.38*sin(2*PI*t/30))`;
  const pulse = `(0.55+0.45*pow(0.5+0.5*sin(2*PI*${pulseHz}*t),3))`;
  const exprL = `${arc}*(0.28*${pulse}*sin(2*PI*${f1}*t) + 0.14*${pulse}*sin(2*PI*${f1 * 2}*t+0.3) + 0.14*sin(2*PI*${f2}*t)*(0.65+0.35*sin(2*PI*0.07*t)) + 0.08*sin(2*PI*${f3}*t)*(0.5+0.5*sin(2*PI*0.045*t+1.2)) + 0.045*sin(2*PI*${f4}*t)*(0.45+0.55*sin(2*PI*0.03*t+2.1)))`;
  const exprR = `${arc}*(0.28*${pulse}*sin(2*PI*${f1}*t+0.12) + 0.14*${pulse}*sin(2*PI*${f1 * 2 + 0.25}*t+0.7) + 0.14*sin(2*PI*${f2 + 0.35}*t)*(0.65+0.35*sin(2*PI*0.07*t+0.9)) + 0.08*sin(2*PI*${f3 - 0.3}*t)*(0.5+0.5*sin(2*PI*0.045*t+2.0)) + 0.045*sin(2*PI*${f4 + 0.25}*t)*(0.45+0.55*sin(2*PI*0.03*t+0.4)))`;

  console.log(`[AmbientMusic] 🎼 Sintetizando banda sonora IMAX oscura (pulso Hans Zimmer · ${mood})...`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(`aevalsrc='${exprL}|${exprR}':s=44100:d=${dur}`)
      .inputOptions(['-f', 'lavfi'])
      .input(`anoisesrc=color=brown:amplitude=0.055:s=44100:d=${dur}`)
      .inputOptions(['-f', 'lavfi'])
      .complexFilter([
        `[0:a]lowpass=f=680,highpass=f=34,aecho=0.8:0.86:210|370:0.38|0.26[score]`,
        `[1:a]lowpass=f=240,highpass=f=42,volume=0.35[air]`,
        `[score][air]amix=inputs=2:duration=first:dropout_transition=0,afade=t=in:st=0:d=3,afade=t=out:st=${dur - 3}:d=3,volume=0.92[outa]`,
      ])
      .outputOptions(['-y', '-map [outa]', '-c:a libmp3lame', '-b:a 192k'])
      .output(outPath)
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .run();
  });

  return outPath;
}

/**
 * Synthesizes 100% copyright-free Hollywood cinema SFX WAVs in assets/sfx/:
 * - sfx_braaam.wav: Deep Dark-Knight-style sub-drop brass impact for act/chapter openings & Short hook
 * - sfx_whoosh.wav: Dark cinema air-sweep for Tactical Map & Dossier reveals
 * - sfx_riser.wav:  Subtle tension riser leading into climaxes
 */
export async function ensureCinemaSfxPack(): Promise<CinemaSfxPack> {
  const braaamPath = path.join(CONFIG.SFX_DIR, 'sfx_braaam_v2.wav');
  const whooshPath = path.join(CONFIG.SFX_DIR, 'sfx_whoosh_v2.wav');
  const riserPath = path.join(CONFIG.SFX_DIR, 'sfx_riser_v2.wav');

  // 1. Deep Zimmer BRAAAM / Sub-drop (2.8s)
  if (!fs.existsSync(braaamPath) || fs.statSync(braaamPath).size < 20_000) {
    const dur = 2.8;
    // Exponential sub pitch drop + dark brassy harmonics + fast attack / long cavernous tail
    const env = `min(1,t/0.04)*exp(-t*1.45)`;
    const expr = `${env}*(0.58*sin(2*PI*(76*exp(-t*0.65)+34)*t) + 0.28*sin(2*PI*110*t) + 0.16*sin(2*PI*165*t) + 0.10*sin(2*PI*220*t))`;
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`aevalsrc='${expr}|${expr}':s=44100:d=${dur}`)
        .inputOptions(['-f', 'lavfi'])
        .audioFilters(['lowpass=f=480', 'aecho=0.8:0.82:140|290:0.42|0.28', 'afade=t=out:st=2.1:d=0.7', 'volume=0.85'])
        .outputOptions(['-y', '-c:a pcm_s16le', '-ar 44100', '-ac 2'])
        .output(braaamPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  // 2. Dark Cinema Tactical Whoosh (1.3s)
  if (!fs.existsSync(whooshPath) || fs.statSync(whooshPath).size < 10_000) {
    const dur = 1.3;
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`anoisesrc=color=pink:amplitude=0.42:s=44100:d=${dur}`)
        .inputOptions(['-f', 'lavfi'])
        .audioFilters([
          'bandpass=f=320:width_type=h:w=360',
          'afade=t=in:st=0:d=0.42',
          'afade=t=out:st=0.55:d=0.72',
          'aecho=0.8:0.75:90:0.35',
          'volume=0.75',
        ])
        .outputOptions(['-y', '-c:a pcm_s16le', '-ar 44100', '-ac 2'])
        .output(whooshPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  // 3. Tension Sub-Riser (2.2s)
  if (!fs.existsSync(riserPath) || fs.statSync(riserPath).size < 15_000) {
    const dur = 2.2;
    const expr = `pow(t/${dur},2.2)*(0.45*sin(2*PI*(42+58*t/${dur})*t) + 0.20*sin(2*PI*(84+116*t/${dur})*t))`;
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`aevalsrc='${expr}|${expr}':s=44100:d=${dur}`)
        .inputOptions(['-f', 'lavfi'])
        .audioFilters(['lowpass=f=420', 'afade=t=out:st=2.05:d=0.15', 'volume=0.7'])
        .outputOptions(['-y', '-c:a pcm_s16le', '-ar 44100', '-ac 2'])
        .output(riserPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  return { braaamPath, whooshPath, riserPath };
}
