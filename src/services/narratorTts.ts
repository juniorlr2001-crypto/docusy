import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { EdgeTTS } from 'node-edge-tts';
import { CONFIG } from '../config.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

function wrapPcm16ToWav(pcmBuffer: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

export function getMediaDurationSec(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(err);
      const dur = Number(meta?.format?.duration || 0);
      if (!Number.isFinite(dur) || dur <= 0) {
        return reject(new Error(`Duración inválida en ${filePath}`));
      }
      resolve(dur);
    });
  });
}

function sanitizeSpokenEs(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\*\#\_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let lastGeminiTtsCallMs = 0;

/**
 * Generates broadcast-grade human documentary narration for a chapter or Short.
 * Primary: Gemini 2.5 Flash Native Audio TTS (Charon / Fenrir deep narrator voices).
 * Fallback: Microsoft Edge Neural TTS (es-MX-JorgeNeural / es-AR-TomasNeural).
 */
export async function generateNarrationAudio(options: {
  text: string;
  outputBasePath: string; // without extension, e.g. .../chapter_01
  mood?: 'tension' | 'mystery' | 'awe' | 'survival';
  style?: 'documentary' | 'short';
  voiceName?: string;
}): Promise<{ audioPath: string; durationSec: number; provider: string }> {
  const cleanText = sanitizeSpokenEs(options.text);
  const wavPath = `${options.outputBasePath}.wav`;
  const mp3Path = `${options.outputBasePath}.mp3`;

  // Resume from cache if already generated cleanly
  for (const cached of [wavPath, mp3Path]) {
    if (fs.existsSync(cached) && fs.statSync(cached).size > 4000) {
      try {
        const dur = await getMediaDurationSec(cached);
        if (dur > 2) {
          console.log(`[NarratorTTS] ♻️ Reutilizando audio en caché: ${path.basename(cached)} (${dur.toFixed(1)}s)`);
          return { audioPath: cached, durationSec: dur, provider: 'cache' };
        }
      } catch {
        // regenerate if corrupted
      }
    }
  }

  fs.mkdirSync(path.dirname(options.outputBasePath), { recursive: true });

  // Strategy 1: Gemini 2.5 Flash Native Audio TTS (human cinema documentary narrator)
  if (CONFIG.GEMINI_API_KEY) {
    const selectedVoice = options.voiceName || (options.mood === 'mystery' ? 'Charon' : 'Fenrir');
    const styleDirective =
      options.style === 'short'
        ? 'Lee en español latinoamericano neutro como un narrador de documentales virales de suspenso: voz grave, intensa, ritmo ágil y dramático, con pausas precisas para atrapar desde la primera palabra. Lee ÚNICAMENTE el texto exacto:'
        : 'Lee en español latinoamericano neutro como un narrador profesional de documentales de National Geographic y Netflix: voz grave, cálida, autoritativa y cinematográfica, con pausas dramáticas naturales y ritmo envolvente (ni lento ni apresurado). Lee ÚNICAMENTE el texto exacto:';

    // gemini-2.5-flash-preview-tts obeys style directives without speaking them (the exact NatGeo/Netflix documentary voice).
    // Newer direct TTS models (gemini-3.8-flash-tts / gemini-3.1-flash-tts-preview) speak contents verbatim, so NEVER prepend styleDirective to them!
    const ttsModels: Array<{ id: string; supportsDirective: boolean }> = [
      { id: 'gemini-2.5-flash-preview-tts', supportsDirective: true },
      { id: 'gemini-3.8-flash-tts', supportsDirective: false },
      { id: 'gemini-3.1-flash-tts-preview', supportsDirective: false },
    ];

    for (const modelCfg of ttsModels) {
      const ttsModel = modelCfg.id;
      const ttsInputText = modelCfg.supportsDirective ? `${styleDirective}\n\n${cleanText}` : cleanText;

      for (let attempt = 1; attempt <= 2; attempt++) {
        // Polite spacing between Gemini TTS requests to stay comfortably inside free RPM limits
        const elapsed = Date.now() - lastGeminiTtsCallMs;
        if (lastGeminiTtsCallMs > 0 && elapsed < 5000) {
          await new Promise(r => setTimeout(r, 5000 - elapsed));
        }
        lastGeminiTtsCallMs = Date.now();

        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${ttsModel}:generateContent?key=${encodeURIComponent(CONFIG.GEMINI_API_KEY)}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: ttsInputText }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: selectedVoice },
                  },
                },
              },
            }),
            signal: AbortSignal.timeout(90_000),
          });

          if (res.status === 429 && attempt === 1) {
            console.warn(`[NarratorTTS] ⏳ ${ttsModel} 429 (rate limit), esperando 18s para reintentar...`);
            await new Promise(r => setTimeout(r, 18_000));
            continue;
          }

          if (res.ok) {
            const data: any = await res.json();
            const inline = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
            if (inline?.data) {
              const rawBuf = Buffer.from(inline.data, 'base64');
              const mime = String(inline.mimeType || 'audio/L16;rate=24000');
              const rateMatch = mime.match(/rate=(\d+)/i);
              const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
              const wavBuf = /wav/i.test(mime) ? rawBuf : wrapPcm16ToWav(rawBuf, sampleRate, 1, 16);
              if (wavBuf.length > 4000) {
                fs.writeFileSync(wavPath, wavBuf);
                const dur = await getMediaDurationSec(wavPath);
                console.log(
                  `[NarratorTTS] 🎙️ ${ttsModel} (${selectedVoice}) -> ${path.basename(wavPath)} (${dur.toFixed(1)}s)`
                );
                return { audioPath: wavPath, durationSec: dur, provider: `${ttsModel}:${selectedVoice}` };
              }
            }
          } else {
            const errTxt = await res.text().catch(() => '');
            console.warn(`[NarratorTTS] ⚠️ ${ttsModel} HTTP ${res.status}: ${errTxt.slice(0, 180)}`);
            if (res.status === 400 || res.status === 404 || res.status === 429) break; // move to next TTS model cleanly
          }
        } catch (err: any) {
          console.warn(`[NarratorTTS] ⚠️ ${ttsModel} error: ${err?.message || err}`);
        }
      }
    }
  }

  // Strategy 2: Microsoft Edge Neural TTS (always free, zero quota caps, natural es-MX / es-AR)
  const fallbackVoices = ['es-MX-JorgeNeural', 'es-AR-TomasNeural', 'es-ES-AlvaroNeural'];
  let lastErr = '';
  for (const voice of fallbackVoices) {
    try {
      const tts = new EdgeTTS({
        voice,
        lang: voice.slice(0, 5),
        rate: options.style === 'short' ? '+6%' : '+2%',
        pitch: 'default',
      });
      await tts.ttsPromise(cleanText, mp3Path);
      if (fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 2000) {
        const dur = await getMediaDurationSec(mp3Path);
        console.log(`[NarratorTTS] 🎙️ Edge Neural TTS (${voice}) -> ${path.basename(mp3Path)} (${dur.toFixed(1)}s)`);
        return { audioPath: mp3Path, durationSec: dur, provider: `edge-tts:${voice}` };
      }
    } catch (err: any) {
      lastErr = err?.message || String(err);
      console.warn(`[NarratorTTS] ⚠️ Edge TTS (${voice}) falló: ${lastErr}`);
    }
  }

  throw new Error(`No se pudo generar narración TTS: ${lastErr}`);
}
