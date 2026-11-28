import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { CONFIG } from '../config.js';
import { DocuMood, MusicVariant } from '../types.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface CinemaSfxPack {
  braaamPath: string;
  whooshPath: string;
  riserPath: string;
}

/**
 * Ensures a 100% copyright-free cinematic documentary score rotated across 4 distinct orchestral/synth textures
 * (`zimmer_pulse`, `abyssal_cello`, `clockwork_thriller`, `interstellar_organ`) so consecutive videos
 * never sound identical ("anti-factory" audio rotation at $0 cost).
 */
export async function ensureDocumentaryMusicBed(
  mood: DocuMood,
  variant: MusicVariant = 'zimmer_pulse'
): Promise<string> {
  if (fs.existsSync(CONFIG.MUSIC_DIR)) {
    const customFiles = fs
      .readdirSync(CONFIG.MUSIC_DIR)
      .filter(f => /\.(mp3|wav|m4a)$/i.test(f) && !f.startsWith('synth_'))
      .sort();
    if (customFiles.length > 0) {
      const varIdx = ['zimmer_pulse', 'abyssal_cello', 'clockwork_thriller', 'interstellar_organ'].indexOf(variant);
      const moodIdx = ['survival', 'tension', 'mystery', 'awe'].indexOf(mood);
      const picked = path.join(CONFIG.MUSIC_DIR, customFiles[Math.max(0, moodIdx + varIdx) % customFiles.length]);
      console.log(`[AmbientMusic] 🎵 Usando banda sonora personalizada: ${path.basename(picked)}`);
      return picked;
    }
  }

  const outPath = path.join(CONFIG.MUSIC_DIR, `synth_v25_${mood}_${variant}.mp3`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 40_000) {
    return outPath;
  }

  const baseFreqs: Record<DocuMood, [number, number, number, number]> = {
    tension: [55.0, 82.41, 130.81, 164.81],   // A minor
    survival: [65.41, 98.0, 155.56, 196.0],   // C minor
    mystery: [73.42, 110.0, 174.61, 220.0],   // D minor
    awe: [61.74, 92.5, 146.83, 185.0],       // B minor
  };
  const [f1, f2, f3, f4] = baseFreqs[mood] || baseFreqs.tension;
  const dur = 92;

  let exprL = '';
  let exprR = '';
  let filterScore = 'lowpass=f=680,highpass=f=34,aecho=0.8:0.86:210|370:0.38|0.26';

  if (variant === 'clockwork_thriller') {
    // Ticking Nolan/Dunkirk polyrhythmic tension ostinato
    const tick = `pow(0.5+0.5*sin(2*PI*2.65*t),6)`;
    const subArc = `(0.60+0.40*sin(2*PI*t/24))`;
    exprL = `${subArc}*(0.26*sin(2*PI*${f1}*t)*(0.65+0.35*sin(2*PI*1.325*t)) + 0.16*${tick}*sin(2*PI*${f3}*t) + 0.12*sin(2*PI*${f2}*t)*(0.5+0.5*sin(2*PI*0.09*t)) + 0.06*${tick}*sin(2*PI*${f4 * 1.5}*t))`;
    exprR = `${subArc}*(0.26*sin(2*PI*${f1}*t+0.15)*(0.65+0.35*sin(2*PI*1.325*t+0.4)) + 0.16*${tick}*sin(2*PI*${f3 * 1.002}*t+0.8) + 0.12*sin(2*PI*${f2 + 0.3}*t)*(0.5+0.5*sin(2*PI*0.09*t+1.1)) + 0.06*${tick}*sin(2*PI*${f4 * 1.5}*t+0.5))`;
    filterScore = 'lowpass=f=820,highpass=f=36,aecho=0.8:0.82:188|376:0.34|0.22';
  } else if (variant === 'abyssal_cello') {
    // Deep bowed dark cello & subharmonic ocean/ice swells (slow, atmospheric, haunting)
    const bow = `(0.58+0.42*sin(2*PI*0.18*t))`;
    const pulse = `(0.70+0.30*pow(0.5+0.5*sin(2*PI*1.15*t),2))`;
    exprL = `${bow}*(0.30*${pulse}*sin(2*PI*${f1}*t) + 0.17*sin(2*PI*${f2}*t+0.2*sin(2*PI*3.2*t)) + 0.11*sin(2*PI*${f3}*t)*(0.5+0.5*sin(2*PI*0.05*t+0.8)) + 0.05*sin(2*PI*${f4}*t))`;
    exprR = `${bow}*(0.30*${pulse}*sin(2*PI*${f1}*t+0.18) + 0.17*sin(2*PI*${f2 + 0.25}*t+0.2*sin(2*PI*3.1*t)) + 0.11*sin(2*PI*${f3 - 0.25}*t)*(0.5+0.5*sin(2*PI*0.05*t+1.7)) + 0.05*sin(2*PI*${f4 + 0.2}*t))`;
    filterScore = 'lowpass=f=560,highpass=f=32,aecho=0.82:0.88:280|510:0.42|0.30';
  } else if (variant === 'interstellar_organ') {
    // Warm cathedral/cosmic pipe-organ fifths & shimmering arpeggio pulse
    const arp = `(0.48+0.52*pow(0.5+0.5*sin(2*PI*1.9*t),4))`;
    const swell = `(0.60+0.40*sin(2*PI*t/32))`;
    exprL = `${swell}*(0.24*sin(2*PI*${f1}*t) + 0.18*sin(2*PI*${f2}*t) + 0.12*${arp}*sin(2*PI*${f3}*t) + 0.09*${arp}*sin(2*PI*${f4}*t+0.6) + 0.04*sin(2*PI*${f3 * 2}*t)*(0.5+0.5*sin(2*PI*0.08*t)))`;
    exprR = `${swell}*(0.24*sin(2*PI*${f1}*t+0.1) + 0.18*sin(2*PI*${f2 + 0.2}*t) + 0.12*${arp}*sin(2*PI*${f3 - 0.2}*t+0.4) + 0.09*${arp}*sin(2*PI*${f4 + 0.3}*t+1.1) + 0.04*sin(2*PI*${f3 * 2 + 0.4}*t)*(0.5+0.5*sin(2*PI*0.08*t+1.4)))`;
    filterScore = 'lowpass=f=920,highpass=f=35,aecho=0.82:0.88:260|490:0.40|0.28';
  } else {
    // Default zimmer_pulse
    const arc = `(0.62+0.38*sin(2*PI*t/30))`;
    const pulse = `(0.55+0.45*pow(0.5+0.5*sin(2*PI*2.05*t),3))`;
    exprL = `${arc}*(0.28*${pulse}*sin(2*PI*${f1}*t) + 0.14*${pulse}*sin(2*PI*${f1 * 2}*t+0.3) + 0.14*sin(2*PI*${f2}*t)*(0.65+0.35*sin(2*PI*0.07*t)) + 0.08*sin(2*PI*${f3}*t)*(0.5+0.5*sin(2*PI*0.045*t+1.2)) + 0.045*sin(2*PI*${f4}*t)*(0.45+0.55*sin(2*PI*0.03*t+2.1)))`;
    exprR = `${arc}*(0.28*${pulse}*sin(2*PI*${f1}*t+0.12) + 0.14*${pulse}*sin(2*PI*${f1 * 2 + 0.25}*t+0.7) + 0.14*sin(2*PI*${f2 + 0.35}*t)*(0.65+0.35*sin(2*PI*0.07*t+0.9)) + 0.08*sin(2*PI*${f3 - 0.3}*t)*(0.5+0.5*sin(2*PI*0.045*t+2.0)) + 0.045*sin(2*PI*${f4 + 0.25}*t)*(0.45+0.55*sin(2*PI*0.03*t+0.4)))`;
  }

  console.log(`[AmbientMusic] 🎼 Sintetizando banda sonora IMAX (${mood} · variante=${variant})...`);
  fs.mkdirSync(CONFIG.MUSIC_DIR, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(`aevalsrc='${exprL}|${exprR}':s=44100:d=${dur}`)
      .inputOptions(['-f', 'lavfi'])
      .input(`anoisesrc=color=brown:amplitude=0.05:s=44100:d=${dur}`)
      .inputOptions(['-f', 'lavfi'])
      .complexFilter([
        `[0:a]${filterScore}[score]`,
        `[1:a]lowpass=f=230,highpass=f=42,volume=0.32[air]`,
        `[score][air]amix=inputs=2:duration=first:dropout_transition=0,afade=t=in:st=0:d=2.5,afade=t=out:st=${dur - 2.5}:d=2.5,volume=0.92[outa]`,
      ])
      .outputOptions(['-y', '-map [outa]', '-c:a libmp3lame', '-b:a 192k'])
      .output(outPath)
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .run();
  });

  return outPath;
}

export async function ensureCinemaSfxPack(): Promise<CinemaSfxPack> {
  fs.mkdirSync(CONFIG.SFX_DIR, { recursive: true });
  const braaamPath = path.join(CONFIG.SFX_DIR, 'sfx_braaam_v2.wav');
  const whooshPath = path.join(CONFIG.SFX_DIR, 'sfx_whoosh_v2.wav');
  const riserPath = path.join(CONFIG.SFX_DIR, 'sfx_riser_v2.wav');

  if (!fs.existsSync(braaamPath) || fs.statSync(braaamPath).size < 20_000) {
    const dur = 2.6;
    const env = `min(1,t/0.04)*exp(-t*1.5)`;
    const expr = `${env}*(0.58*sin(2*PI*(76*exp(-t*0.65)+34)*t) + 0.28*sin(2*PI*110*t) + 0.16*sin(2*PI*165*t) + 0.10*sin(2*PI*220*t))`;
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`aevalsrc='${expr}|${expr}':s=44100:d=${dur}`)
        .inputOptions(['-f', 'lavfi'])
        .audioFilters(['lowpass=f=480', 'aecho=0.8:0.82:140|290:0.42|0.28', 'afade=t=out:st=1.9:d=0.7', 'volume=0.85'])
        .outputOptions(['-y', '-c:a pcm_s16le', '-ar 44100', '-ac 2'])
        .output(braaamPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

  if (!fs.existsSync(whooshPath) || fs.statSync(whooshPath).size < 10_000) {
    const dur = 1.1;
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`anoisesrc=color=pink:amplitude=0.42:s=44100:d=${dur}`)
        .inputOptions(['-f', 'lavfi'])
        .audioFilters([
          'bandpass=f=340:width_type=h:w=380',
          'afade=t=in:st=0:d=0.34',
          'afade=t=out:st=0.45:d=0.62',
          'aecho=0.8:0.75:85:0.34',
          'volume=0.76',
        ])
        .outputOptions(['-y', '-c:a pcm_s16le', '-ar 44100', '-ac 2'])
        .output(whooshPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
  }

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
