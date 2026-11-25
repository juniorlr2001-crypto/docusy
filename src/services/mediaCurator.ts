import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { CONFIG } from '../config.js';
import { CuratedBeatAsset, DocumentaryScene, DocumentaryScript, DocumentaryTopic } from '../types.js';
import { getMediaDurationSec } from './narratorTts.js';

const DEFAULT_BLACKLIST_WORDS = new Set([
  'tourist', 'tourists', 'vacation', 'resort', 'bikini', 'swimsuit', 'pool', 'poolside',
  'wedding', 'bride', 'groom', 'romantic', 'couple', 'kiss', 'kissing', 'love', 'date',
  'selfie', 'influencer', 'tiktok', 'vlogger', 'makeup', 'beauty', 'fashion', 'model', 'runway',
  'shopping', 'mall', 'store', 'coffee', 'cafe', 'latte', 'restaurant', 'cooking', 'kitchen', 'chef',
  'party', 'nightclub', 'club', 'dj', 'cocktail', 'bar', 'beer', 'wine', 'champagne', 'birthday',
  'yoga', 'fitness', 'gym', 'workout', 'pilates', 'smiling', 'laughing', 'happy', 'cheerful',
  'office', 'laptop', 'meeting', 'corporate', 'business', 'businessman', 'businesswoman', 'startup',
  'microphone', 'press', 'interview', 'ukraine', 'istanbul', 'surfboard', 'surfer', 'surfing',
  'jetski', 'yacht', 'luxury', 'cruise', 'cat', 'dog', 'puppy', 'kitten', 'baby', 'toddler',
  'christmas', 'halloween', 'easter', 'cartoon', 'greenscreen', 'chroma', 'subscribe', 'logo',
  'surgery', 'dentist', 'manicure', 'haircut', 'spa', 'massage', 'skateboard', 'basketball', 'football',
  'bmw', 'mercedes', 'audi', 'tesla', 'car', 'cars', 'automobile', 'vehicle', 'dashboard', 'steering',
  'speedometer', 'driving', 'driver', 'highway', 'traffic', 'streetcar', 'smartphone', 'iphone', 'tablet',
  'gaming', 'gamer', 'esports', 'crypto', 'bitcoin', 'forex', 'trading', 'shopping', 'supermarket',
  'dragon', 'monster', 'dinosaur', 'fantasy', 'cyborg', 'robot', 'android', 'alien', 'sci-fi', 'scifi',
  'squirrel', 'chipmunk', 'hamster', 'rabbit', 'deer', 'horse', 'wildlife', 'pet', 'pets',
  'horror', 'zombie', 'ghost', 'screaming', 'scared', 'woman', 'girl', 'boy', 'child', 'children', 'family',
  'grinder', 'welding', 'workshop', 'laundry', 'washing', 'graffiti', 'hello', 'programming', 'coding', 'hacker',
]);

const MOOD_ATMOSPHERE_VIDEO_QUERIES: Record<string, string[]> = {
  survival: [
    'ocean waves',
    'storm clouds',
    'heavy rain',
    'misty mountains',
    'dark forest',
    'lightning storm',
    'sea twilight',
    'fog aerial',
  ],
  tension: [
    'storm clouds',
    'dark rain',
    'radar screen',
    'smoke shadows',
    'thunderstorm lightning',
    'control room',
    'satellite space',
    'clock ticking',
    'red light',
    'dark corridor',
  ],
  mystery: [
    'fog forest',
    'night sky',
    'lighthouse storm',
    'moon clouds',
    'abandoned building',
    'underwater light',
    'misty sea',
    'dark shadows',
  ],
  awe: [
    'earth space',
    'milky way',
    'underwater ocean',
    'glacier ice',
    'aurora borealis',
    'clouds sunset',
    'stars timelapse',
    'volcano night',
  ],
};

export class EpisodeMediaCurator {
  private usedVideoIds = new Set<string>();
  private usedArchivalUrls = new Set<string>();
  private cloudflareQuotaExhausted = false;
  private falUnavailable = false;
  private aiImagesGenerated = 0;
  private aiVideosGenerated = 0;
  private archivalPool: Array<{ url: string; title: string }> = [];
  private archivalLoaded = false;

  /**
   * Optional Hollywood Cinema Tier via fal.ai: generates ultra-sharp IMAX 70mm photorealistic still frames
   * using FLUX Dev / FLUX Pro when DOCU_FAL_KEY is configured.
   */
  private async tryFalHeroImage(params: {
    promptEn: string;
    styleGuideEn: string;
    aspect: '16:9' | '9:16';
    outPath: string;
  }): Promise<{ path: string; imageUrl: string; provider: string } | null> {
    if (!CONFIG.FAL_KEY || this.falUnavailable) return null;

    const targetW = params.aspect === '16:9' ? 1920 : 1080;
    const targetH = params.aspect === '16:9' ? 1080 : 1920;
    const imageSize = params.aspect === '16:9' ? 'landscape_16_9' : 'portrait_16_9';
    const fullPrompt = `${params.promptEn}. ${params.styleGuideEn}. Shot on 70mm feature-film cinema camera, authentic natural lighting matching the scene environment and era, volumetric atmospheric depth, ultra crisp focus, NO text, NO letters, NO watermarks.`;

    try {
      const model = CONFIG.FAL_IMAGE_MODEL || 'fal-ai/flux/dev';
      const res = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${CONFIG.FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          image_size: imageSize,
          num_inference_steps: 24,
          guidance_scale: 3.5,
          enable_safety_checker: true,
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (res.status === 401 || res.status === 402 || res.status === 403) {
        const txt = await res.text().catch(() => '');
        this.falUnavailable = true;
        console.warn(`[MediaCurator] 🚨 fal.ai desactivado (HTTP ${res.status}): ${txt.slice(0, 140)}`);
        return null;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        console.warn(`[MediaCurator] ⚠️ fal.ai image HTTP ${res.status}: ${txt.slice(0, 140)}`);
        return null;
      }

      const json: any = await res.json();
      const imageUrl: string | undefined = json?.images?.[0]?.url || json?.image?.url;
      if (!imageUrl) return null;

      const dl = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!dl.ok) return null;
      const rawBuf = Buffer.from(await dl.arrayBuffer());
      if (rawBuf.length < 10_000) return null;

      fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
      await sharp(rawBuf)
        .resize(targetW, targetH, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
        .jpeg({ quality: 94, mozjpeg: true })
        .toFile(params.outPath);

      console.log(`[MediaCurator] 🎬 fal.ai IMAX Hero: ${path.basename(params.outPath)} (${model})`);
      return { path: params.outPath, imageUrl, provider: `fal:${model}` };
    } catch (err: any) {
      console.warn(`[MediaCurator] ⚠️ fal.ai image error: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Optional Hollywood Motion Tier via fal.ai Queue API: animates a hero IMAX still frame into a
   * real 5-second moving cinema shot (Kling / Wan / LTX Image-to-Video) when DOCU_FAL_KEY is set.
   */
  private async tryFalImageToVideo(params: {
    imageUrl: string;
    motionPromptEn: string;
    aspect: '16:9' | '9:16';
    outPath: string;
  }): Promise<{ path: string; durationSec: number; provider: string } | null> {
    if (!CONFIG.FAL_KEY || this.falUnavailable) return null;
    if (this.aiVideosGenerated >= CONFIG.MAX_AI_VIDEO_CLIPS_PER_EPISODE) return null;
    if (fs.existsSync(params.outPath) && fs.statSync(params.outPath).size > 60_000) {
      try {
        const dur = await getMediaDurationSec(params.outPath);
        if (dur > 2) return { path: params.outPath, durationSec: dur, provider: 'cache-ai-video' };
      } catch {
        // regenerate
      }
    }

    const model = CONFIG.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v1.6/standard/image-to-video';
    try {
      const submitRes = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${CONFIG.FAL_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: `${params.motionPromptEn}, slow dramatic IMAX cinema dolly movement, natural atmospheric motion, realistic lighting, filmic 24fps`,
          image_url: params.imageUrl,
          duration: '5',
          aspect_ratio: params.aspect,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (submitRes.status === 401 || submitRes.status === 402 || submitRes.status === 403) {
        this.falUnavailable = true;
        console.warn(`[MediaCurator] 🚨 fal.ai video desactivado (HTTP ${submitRes.status}).`);
        return null;
      }
      if (!submitRes.ok) {
        const txt = await submitRes.text().catch(() => '');
        console.warn(`[MediaCurator] ⚠️ fal.ai video submit HTTP ${submitRes.status}: ${txt.slice(0, 140)}`);
        return null;
      }

      const queued: any = await submitRes.json();
      const statusUrl: string | undefined = queued?.status_url;
      const responseUrl: string | undefined = queued?.response_url;
      if (!statusUrl || !responseUrl) return null;

      console.log(`[MediaCurator] 🎥 Animando plano de cine IA (${this.aiVideosGenerated + 1}/${CONFIG.MAX_AI_VIDEO_CLIPS_PER_EPISODE}) con ${model}...`);
      const started = Date.now();
      while (Date.now() - started < 240_000) {
        await new Promise(r => setTimeout(r, 6000));
        const stRes = await fetch(statusUrl, {
          headers: { Authorization: `Key ${CONFIG.FAL_KEY}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (!stRes.ok) continue;
        const stJson: any = await stRes.json();
        if (stJson?.status === 'COMPLETED') {
          const finalRes = await fetch(responseUrl, {
            headers: { Authorization: `Key ${CONFIG.FAL_KEY}` },
            signal: AbortSignal.timeout(20_000),
          });
          if (!finalRes.ok) return null;
          const finalJson: any = await finalRes.json();
          const videoUrl: string | undefined = finalJson?.video?.url || finalJson?.data?.video?.url;
          if (!videoUrl) return null;

          const dl = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
          if (!dl.ok) return null;
          const buf = Buffer.from(await dl.arrayBuffer());
          if (buf.length < 60_000) return null;

          fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
          fs.writeFileSync(params.outPath, buf);
          this.aiVideosGenerated++;
          const dur = await getMediaDurationSec(params.outPath).catch(() => 5);
          console.log(`[MediaCurator] ✅ Plano IA animado listo: ${path.basename(params.outPath)} (${dur.toFixed(1)}s)`);
          return { path: params.outPath, durationSec: dur, provider: `fal-i2v:${model}` };
        }
        if (stJson?.status === 'FAILED') {
          console.warn('[MediaCurator] ⚠️ fal.ai video job FAILED.');
          return null;
        }
      }
      return null;
    } catch (err: any) {
      console.warn(`[MediaCurator] ⚠️ fal.ai video error: ${err?.message || err}`);
      return null;
    }
  }

  private scoreCandidate(slugOrTags: string, query: string): number {
    const cleanText = slugOrTags.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const textTokens = new Set(cleanText.split(/\s+/).filter(Boolean));
    const queryTokens = query
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3);

    // Reject blacklisted stock cliches unless explicitly requested by the beat query
    for (const bad of DEFAULT_BLACKLIST_WORDS) {
      if (textTokens.has(bad) && !queryTokens.includes(bad)) {
        return -1000;
      }
    }

    let score = 0;
    for (const q of queryTokens) {
      if (textTokens.has(q)) score += 10;
      else if (cleanText.includes(q)) score += 5;
    }

    // Small bonus for cinematic atmosphere descriptors
    for (const bonus of ['aerial', 'dark', 'storm', 'night', 'fog', 'mist', 'dramatic', 'slow', 'clouds', 'waves', 'ocean', 'space', 'cinematic']) {
      if (textTokens.has(bonus)) score += 2;
    }
    return score;
  }

  /**
   * Loads genuine verified public-domain / archival photos directly from the topic's Wikipedia article.
   * Zero API key needed; filters out icons, flags, SVGs, and low-res thumbnails.
   */
  async preloadArchivalMedia(topic: DocumentaryTopic): Promise<void> {
    if (this.archivalLoaded) return;
    this.archivalLoaded = true;

    const titlesToTry: Array<{ lang: 'es' | 'en'; title: string }> = [];
    if (topic.wikiTitleEs) titlesToTry.push({ lang: 'es', title: topic.wikiTitleEs });
    if (topic.wikiTitleEn) titlesToTry.push({ lang: 'en', title: topic.wikiTitleEn });

    const seen = new Set<string>();
    const headers = { 'User-Agent': 'DocuViralEngine/2.0 (documentary visual research)' };

    for (const entry of titlesToTry) {
      try {
        const cleanTitle = entry.title.trim().replace(/\s+/g, '_');
        const url = `https://${entry.lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(cleanTitle)}`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
        if (!res.ok) continue;
        const json: any = await res.json();
        const items: any[] = Array.isArray(json?.items) ? json.items : [];

        for (const item of items) {
          if (item?.type !== 'image') continue;
          const title = String(item?.title || '');
          if (!/\.(jpe?g|png)$/i.test(title)) continue;
          if (/(flag|logo|icon|map|locator|commons|wikisource|symbol|diagram|coat_of_arms|signature)/i.test(title)) continue;

          const srcset: any[] = Array.isArray(item?.srcset) ? item.srcset : [];
          const bestSrc = srcset[srcset.length - 1]?.src || item?.original?.source;
          if (!bestSrc) continue;
          const fullUrl = bestSrc.startsWith('//') ? `https:${bestSrc}` : String(bestSrc);
          if (seen.has(fullUrl)) continue;
          seen.add(fullUrl);
          this.archivalPool.push({ url: fullUrl, title });
        }
      } catch {
        // non-fatal
      }
    }

    if (this.archivalPool.length > 0) {
      console.log(`[MediaCurator] 🏛️ ${this.archivalPool.length} imágenes de archivo verificadas encontradas en Wikimedia.`);
    }
  }

  /**
   * Fetches a high-definition real moving video clip from Pexels Videos API with strict
   * orientation, resolution, deduplication, and anti-cliche relevance scoring.
   */
  private async tryPexelsVideo(
    query: string,
    aspect: '16:9' | '9:16',
    outPath: string
  ): Promise<{ path: string; durationSec: number; provider: string } | null> {
    if (!CONFIG.PEXELS_API_KEY) return null;
    const orientation = aspect === '16:9' ? 'landscape' : 'portrait';

    try {
      const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=15&size=medium`;
      const res = await fetch(url, {
        headers: { Authorization: CONFIG.PEXELS_API_KEY },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        if (res.status === 429) console.warn('[MediaCurator] ⚠️ Pexels Videos rate limit (429).');
        return null;
      }

      const data: any = await res.json();
      const videos: any[] = Array.isArray(data?.videos) ? data.videos : [];

      const ranked: Array<{ video: any; file: any; score: number }> = [];
      for (const v of videos) {
        const key = `pexels:${v.id}`;
        if (this.usedVideoIds.has(key)) continue;
        if (Number(v.duration || 0) < 4) continue;

        // Enforce strict orientation
        const vw = Number(v.width || 0);
        const vh = Number(v.height || 0);
        if (aspect === '16:9' && vw <= vh) continue;
        if (aspect === '9:16' && vh <= vw) continue;

        const slug = String(v.url || '').split('/video/')[1] || '';
        const score = this.scoreCandidate(slug, query);
        if (score < 0) continue; // blacklisted!

        const files: any[] = Array.isArray(v.video_files) ? v.video_files : [];
        const validMp4s = files
          .filter(f => String(f.file_type || '').includes('mp4') && f.link)
          .filter(f => (aspect === '16:9' ? Number(f.width) > Number(f.height) : Number(f.height) > Number(f.width)))
          .filter(f => Math.max(Number(f.width || 0), Number(f.height || 0)) >= 1280);

        if (validMp4s.length === 0) continue;

        // Prefer 1920x1080 (or 1080x1920) over giant 4K files for fast download + sharp 1080p quality
        validMp4s.sort((a, b) => {
          const distA = Math.abs(Math.max(a.width, a.height) - 1920);
          const distB = Math.abs(Math.max(b.width, b.height) - 1920);
          return distA - distB;
        });

        ranked.push({ video: v, file: validMp4s[0], score });
      }

      if (ranked.length === 0) return null;
      ranked.sort((a, b) => b.score - a.score);
      const chosen = ranked[0];

      const dlRes = await fetch(chosen.file.link, { signal: AbortSignal.timeout(35_000) });
      if (!dlRes.ok) return null;
      const buf = Buffer.from(await dlRes.arrayBuffer());
      if (buf.length < 40_000) return null;

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      this.usedVideoIds.add(`pexels:${chosen.video.id}`);

      let dur = Number(chosen.video.duration || 8);
      try {
        dur = await getMediaDurationSec(outPath);
      } catch {
        // use reported duration
      }

      return { path: outPath, durationSec: dur, provider: `pexels-video:${chosen.video.id}` };
    } catch {
      return null;
    }
  }

  /**
   * Secondary HD Video B-Roll source: Pixabay Videos API (100% free tier when DOCU_PIXABAY_API_KEY is set).
   */
  private async tryPixabayVideo(
    query: string,
    aspect: '16:9' | '9:16',
    outPath: string
  ): Promise<{ path: string; durationSec: number; provider: string } | null> {
    if (!CONFIG.PIXABAY_API_KEY) return null;
    try {
      const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(CONFIG.PIXABAY_API_KEY)}&q=${encodeURIComponent(query)}&per_page=25&safesearch=true`;
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) return null;

      const data: any = await res.json();
      const hits: any[] = Array.isArray(data?.hits) ? data.hits : [];
      const ranked: Array<{ hit: any; link: string; score: number }> = [];

      for (const h of hits) {
        const key = `pixabay:${h.id}`;
        if (this.usedVideoIds.has(key)) continue;
        if (Number(h.duration || 0) < 4) continue;

        let score = this.scoreCandidate(String(h.tags || ''), query);
        if (score < 0) continue;

        // Prefer crisp 1920x1080 (large) over 1280x720 (medium)
        const vChoice = h.videos?.large?.url
          ? h.videos.large
          : h.videos?.medium?.url
            ? h.videos.medium
            : h.videos?.small;
        if (!vChoice?.url) continue;
        const vw = Number(vChoice.width || 0);
        const vh = Number(vChoice.height || 0);

        if (aspect === '16:9') {
          if (vw <= vh || vw < 1280) continue;
        } else {
          // For 9:16 Shorts: strongly prefer native portrait, else allow crisp >=1920w landscape to center-crop cleanly
          if (vh > vw) {
            score += 20;
          } else if (vw < 1920) {
            continue;
          }
        }

        ranked.push({ hit: h, link: vChoice.url, score });
      }

      if (ranked.length === 0) return null;
      ranked.sort((a, b) => b.score - a.score);
      const chosen = ranked[0];

      const dlRes = await fetch(chosen.link, { signal: AbortSignal.timeout(35_000) });
      if (!dlRes.ok) return null;
      const buf = Buffer.from(await dlRes.arrayBuffer());
      if (buf.length < 40_000) return null;

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      this.usedVideoIds.add(`pixabay:${chosen.hit.id}`);

      let dur = Number(chosen.hit.duration || 8);
      try {
        dur = await getMediaDurationSec(outPath);
      } catch {
        // fallback to api duration
      }

      return { path: outPath, durationSec: dur, provider: `pixabay-video:${chosen.hit.id}` };
    } catch {
      return null;
    }
  }

  /**
   * Fetches a curated HD moving video clip using the beat's ordered queries + mood atmosphere fallback.
   */
  async fetchCuratedVideoClip(params: {
    queries: string[];
    mood: string;
    aspect: '16:9' | '9:16';
    outPath: string;
  }): Promise<{ path: string; durationSec: number; provider: string } | null> {
    if (fs.existsSync(params.outPath) && fs.statSync(params.outPath).size > 40_000) {
      try {
        const dur = await getMediaDurationSec(params.outPath);
        if (dur > 2) return { path: params.outPath, durationSec: dur, provider: 'cache-video' };
      } catch {
        // re-fetch if corrupted
      }
    }

    const stopWords = new Set(['the', 'and', 'with', 'from', 'into', 'over', 'under', 'near', 'dark', 'dramatic', 'cinematic', 'moody', 'vertical', 'aerial']);
    const expanded: string[] = [];
    for (const rawQ of params.queries) {
      const q = rawQ.trim();
      if (!q) continue;
      expanded.push(q);
      const words = q.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean);
      if (words.length >= 3) {
        const core = words.filter(w => !stopWords.has(w) && w.length >= 3);
        if (core.length >= 2) expanded.push(core.slice(0, 2).join(' '));
        else expanded.push(words.slice(0, 2).join(' '));
      }
    }
    const moodFallbacks = MOOD_ATMOSPHERE_VIDEO_QUERIES[params.mood] || MOOD_ATMOSPHERE_VIDEO_QUERIES.mystery;
    const allQueries = Array.from(new Set([...expanded, ...moodFallbacks].map(q => q.trim()).filter(Boolean)));

    for (const q of allQueries) {
      const pex = await this.tryPexelsVideo(q, params.aspect, params.outPath);
      if (pex) return pex;
      const pix = await this.tryPixabayVideo(q, params.aspect, params.outPath);
      if (pix) return pix;
    }
    return null;
  }

  /**
   * Generates a hero IMAX cinematic image:
   * 1. If DOCU_FAL_KEY is set -> fal.ai FLUX Dev/Pro (Hollywood IMAX tier).
   * 2. Otherwise -> Neuron-budgeted Cloudflare FLUX.1 Schnell (~110 neurons/img, circuit-breaker on 429).
   */
  async tryGenerateHeroAiImage(params: {
    promptEn: string;
    styleGuideEn: string;
    aspect: '16:9' | '9:16';
    outPath: string;
    ignoreBudget?: boolean; // true for thumbnail hero
  }): Promise<{ path: string; imageUrl?: string; provider: string } | null> {
    if (fs.existsSync(params.outPath) && fs.statSync(params.outPath).size > 15_000) {
      return { path: params.outPath, provider: 'cache-ai' };
    }

    // Tier 1: fal.ai IMAX Hero Image (when user configures DOCU_FAL_KEY)
    if (CONFIG.FAL_KEY && !this.falUnavailable && (params.ignoreBudget || this.aiImagesGenerated < CONFIG.MAX_AI_IMAGES_PER_EPISODE)) {
      const fal = await this.tryFalHeroImage(params);
      if (fal) {
        this.aiImagesGenerated++;
        return fal;
      }
    }

    if (!params.ignoreBudget && this.cloudflareQuotaExhausted) return null;
    if (!CONFIG.CLOUDFLARE_ACCOUNT_ID || !CONFIG.CLOUDFLARE_API_TOKEN) return null;
    if (!params.ignoreBudget && this.aiImagesGenerated >= CONFIG.MAX_AI_IMAGES_PER_EPISODE) {
      return null;
    }

    const targetW = params.aspect === '16:9' ? 1920 : 1080;
    const targetH = params.aspect === '16:9' ? 1080 : 1920;
    const aspectCue = params.aspect === '16:9'
      ? 'wide 16:9 horizontal cinema framing, main focal subject positioned on the right side of the frame'
      : 'vertical 9:16 portrait framing';
    const lightingCue = params.ignoreBudget
      ? 'authentic 70mm IMAX documentary poster lighting, crisp rim light on right-side subject, dark atmospheric negative space on the left for typography, natural realistic skin texture, high contrast, NO cartoon look'
      : `${params.styleGuideEn}, 35mm documentary photography, volumetric cinematic lighting`;
    const fullPrompt = `${params.promptEn}. ${lightingCue}, ${aspectCue}, ultra sharp 8k detail, NO text, NO letters, NO watermark, NO logos.`;

    const maxAttempts = params.ignoreBudget ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, attempt * 3000));
        }
        const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CONFIG.CLOUDFLARE_ACCOUNT_ID)}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CONFIG.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt: fullPrompt, steps: params.ignoreBudget ? 8 : 6 }),
          signal: AbortSignal.timeout(45_000),
        });

        if (res.status === 429 || res.status === 401 || res.status === 403) {
          const errTxt = await res.text().catch(() => '');
          if (attempt < maxAttempts) {
            console.warn(`[MediaCurator] ⏳ Reintentando miniatura IA Cloudflare (${attempt}/${maxAttempts})...`);
            continue;
          }
          this.cloudflareQuotaExhausted = true;
          console.warn(
            `[MediaCurator] 🚨 Cloudflare AI desactivado para el resto del episodio (HTTP ${res.status}): ${errTxt.slice(0, 160)}. Se usará video HD real en movimiento en su lugar (CERO fotos stock aleatorias).`
          );
          return null;
        }

        if (!res.ok) {
          const errTxt = await res.text().catch(() => '');
          console.warn(`[MediaCurator] ⚠️ Cloudflare FLUX HTTP ${res.status}: ${errTxt.slice(0, 140)}`);
          if (attempt < maxAttempts) continue;
          return null;
        }

        let rawBuf: Buffer | null = null;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.startsWith('image/')) {
          rawBuf = Buffer.from(await res.arrayBuffer());
        } else if (contentType.includes('application/json')) {
          const json: any = await res.json();
          const b64 = json?.result?.image;
          if (typeof b64 === 'string' && b64.length > 1000) {
            rawBuf = Buffer.from(b64, 'base64');
          }
        }

        if (!rawBuf || rawBuf.length < 8000) {
          if (attempt < maxAttempts) continue;
          return null;
        }

        fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
        await sharp(rawBuf)
          .resize(targetW, targetH, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
          .modulate({ saturation: 1.04 })
          .jpeg({ quality: 93, mozjpeg: true })
          .toFile(params.outPath);

        this.aiImagesGenerated++;
        console.log(
          `[MediaCurator] 🎨 IA Hero (${this.aiImagesGenerated}/${CONFIG.MAX_AI_IMAGES_PER_EPISODE}): ${path.basename(params.outPath)}`
        );
        return { path: params.outPath, provider: 'cloudflare-flux-1-schnell' };
      } catch (err: any) {
        console.warn(`[MediaCurator] ⚠️ Cloudflare FLUX error: ${err?.message || err}`);
        if (attempt >= maxAttempts) return null;
      }
    }
    return null;
  }

  /**
   * Downloads and frames a genuine archival Wikipedia/Wikimedia image as documentary evidence.
   */
  async tryFetchArchivalImage(params: {
    aspect: '16:9' | '9:16';
    outPath: string;
  }): Promise<{ path: string; provider: string } | null> {
    if (fs.existsSync(params.outPath) && fs.statSync(params.outPath).size > 15_000) {
      return { path: params.outPath, provider: 'cache-archival' };
    }
    const next = this.archivalPool.find(a => !this.usedArchivalUrls.has(a.url));
    if (!next) return null;
    this.usedArchivalUrls.add(next.url);

    const targetW = params.aspect === '16:9' ? 1920 : 1080;
    const targetH = params.aspect === '16:9' ? 1080 : 1920;

    try {
      const res = await fetch(next.url, {
        headers: { 'User-Agent': 'DocuViralEngine/2.0 (documentary archival research)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const raw = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(raw).metadata();
      if (!meta.width || !meta.height || Math.max(meta.width, meta.height) < 600) return null;

      // Documentary archival framing: blurred dark backdrop + crisp framed historical photo in center
      const blurredBg = await sharp(raw)
        .resize(targetW, targetH, { fit: 'cover' })
        .blur(26)
        .modulate({ brightness: 0.35, saturation: 0.35 })
        .toBuffer();

      const maxInnerW = Math.round(targetW * 0.76);
      const maxInnerH = Math.round(targetH * 0.74);
      const innerPhoto = await sharp(raw)
        .resize(maxInnerW, maxInnerH, { fit: 'inside', withoutEnlargement: false })
        .modulate({ saturation: 0.78 })
        .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 226, g: 232, b: 240, alpha: 0.85 } })
        .png()
        .toBuffer();

      const badgeSvg = `<svg width="${targetW}" height="${targetH}" xmlns="http://www.w3.org/2000/svg">
        <rect x="72" y="96" width="380" height="50" rx="8" fill="#020617" fill-opacity="0.82" stroke="#FACC15" stroke-width="1.8"/>
        <text x="96" y="128" fill="#FACC15" font-family="Consolas, Segoe UI, monospace" font-size="20" font-weight="700" letter-spacing="3">ARCHIVO HISTÓRICO REAL</text>
      </svg>`;

      fs.mkdirSync(path.dirname(params.outPath), { recursive: true });
      await sharp(blurredBg)
        .composite([
          { input: innerPhoto, gravity: 'center' },
          { input: Buffer.from(badgeSvg), top: 0, left: 0 },
        ])
        .jpeg({ quality: 92, mozjpeg: true })
        .toFile(params.outPath);

      console.log(`[MediaCurator] 🏛️ Archivo real: ${path.basename(params.outPath)} (${next.title.slice(0, 48)})`);
      return { path: params.outPath, provider: 'wikimedia-archival' };
    } catch {
      return null;
    }
  }

  /**
   * Emergency atmospheric canvas (ONLY used if 100% offline / all video & AI APIs absent).
   */
  private async generateDarkProceduralBackdrop(outPath: string, aspect: '16:9' | '9:16'): Promise<string> {
    const w = aspect === '16:9' ? 1920 : 1080;
    const h = aspect === '16:9' ? 1080 : 1920;
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="42%" r="72%">
          <stop offset="0%" stop-color="#15263d"/>
          <stop offset="55%" stop-color="#091324"/>
          <stop offset="100%" stop-color="#020611"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
    </svg>`;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(outPath);
    return outPath;
  }

  /**
   * Curates the optimal visual media asset for a single documentary beat according to its visualType:
   * - animated_map -> rendered directly by motionGraphics.ts (no API calls!)
   * - stat_dossier -> real moving dark HD video background + animated dossier HUD
   * - archival_evidence -> real Wikimedia historical photo -> fallback to HD video
   * - ai_cinema -> neuron-budgeted FLUX.1 Schnell -> fallback to real HD video (NEVER random Pexels still photos!)
   * - video_broll -> real HD Pexels/Pixabay video clip -> fallback to AI -> fallback to atmospheric canvas
   */
  async curateDocumentaryBeat(params: {
    scene: DocumentaryScene;
    script: DocumentaryScript;
    workDir: string;
  }): Promise<CuratedBeatAsset> {
    const { scene, script, workDir } = params;
    const pad = String(scene.sceneNumber).padStart(2, '0');
    const vidOut = path.join(workDir, 'videos_16x9', `beat_${pad}.mp4`);
    const imgOut = path.join(workDir, 'scenes_16x9', `beat_${pad}.jpg`);
    const queries = scene.videoSearchQueries?.length
      ? scene.videoSearchQueries
      : [scene.pexelsFallbackQuery].filter(Boolean);

    // 1. Animated Geographic Map (100% programmatic, $0, zero quota!)
    if (scene.visualType === 'animated_map' && scene.mapSpec?.from) {
      return {
        sceneNumber: scene.sceneNumber,
        mediaKind: 'animated_map',
        provider: 'motion-graphics-map',
        mapSpec: scene.mapSpec,
      };
    }

    // 2. Animated Stat / Dossier Card over live moving HD B-roll video
    if (scene.visualType === 'stat_dossier' && scene.statOverlay?.value) {
      const bgVid = await this.fetchCuratedVideoClip({
        queries,
        mood: script.mood,
        aspect: '16:9',
        outPath: vidOut,
      });
      return {
        sceneNumber: scene.sceneNumber,
        mediaKind: 'stat_dossier',
        backgroundVideoPath: bgVid?.path,
        durationSec: bgVid?.durationSec,
        provider: bgVid ? `motion-graphics-dossier+${bgVid.provider}` : 'motion-graphics-dossier',
        statOverlay: scene.statOverlay,
      };
    }

    // 3. Genuine Archival Historical Evidence photo (Wikimedia Commons)
    if (scene.visualType === 'archival_evidence') {
      const arch = await this.tryFetchArchivalImage({ aspect: '16:9', outPath: imgOut });
      if (arch) {
        return {
          sceneNumber: scene.sceneNumber,
          mediaKind: 'image',
          filePath: arch.path,
          provider: arch.provider,
        };
      }
      // Fall cleanly to real HD video B-roll
      const vid = await this.fetchCuratedVideoClip({ queries, mood: script.mood, aspect: '16:9', outPath: vidOut });
      if (vid) {
        return {
          sceneNumber: scene.sceneNumber,
          mediaKind: 'video',
          filePath: vid.path,
          durationSec: vid.durationSec,
          provider: vid.provider,
        };
      }
    }

    // 4. Hero AI Cinematic Reconstruction (fal.ai IMAX + Image-to-Video OR Cloudflare FLUX.1 Schnell -> real HD Video fallback!)
    if (scene.visualType === 'ai_cinema') {
      // Check if an animated AI cinema clip was already cached for this beat
      const aiVidOut = path.join(workDir, 'videos_16x9', `beat_${pad}_i2v.mp4`);
      if (fs.existsSync(aiVidOut) && fs.statSync(aiVidOut).size > 60_000) {
        const dur = await getMediaDurationSec(aiVidOut).catch(() => 5);
        return {
          sceneNumber: scene.sceneNumber,
          mediaKind: 'video',
          filePath: aiVidOut,
          durationSec: dur,
          provider: 'cache-ai-video',
        };
      }

      const ai = await this.tryGenerateHeroAiImage({
        promptEn: scene.visualPromptEn,
        styleGuideEn: script.visualStyleGuideEn,
        aspect: '16:9',
        outPath: imgOut,
      });
      if (ai) {
        // When DOCU_FAL_KEY is set and we have an imageUrl + I2V budget, animate this hero frame into real cinema motion!
        if (ai.imageUrl && CONFIG.FAL_KEY && this.aiVideosGenerated < CONFIG.MAX_AI_VIDEO_CLIPS_PER_EPISODE) {
          const i2v = await this.tryFalImageToVideo({
            imageUrl: ai.imageUrl,
            motionPromptEn: scene.visualPromptEn,
            aspect: '16:9',
            outPath: aiVidOut,
          });
          if (i2v) {
            return {
              sceneNumber: scene.sceneNumber,
              mediaKind: 'video',
              filePath: i2v.path,
              durationSec: i2v.durationSec,
              provider: i2v.provider,
            };
          }
        }
        return {
          sceneNumber: scene.sceneNumber,
          mediaKind: 'image',
          filePath: ai.path,
          provider: ai.provider,
        };
      }
      // NEVER fall back to random Pexels still photos: promote cleanly to real HD moving video!
      const vid = await this.fetchCuratedVideoClip({ queries, mood: script.mood, aspect: '16:9', outPath: vidOut });
      if (vid) {
        return {
          sceneNumber: scene.sceneNumber,
          mediaKind: 'video',
          filePath: vid.path,
          durationSec: vid.durationSec,
          provider: vid.provider,
        };
      }
    }

    // 5. Primary Moving HD Video B-Roll
    const video = await this.fetchCuratedVideoClip({
      queries,
      mood: script.mood,
      aspect: '16:9',
      outPath: vidOut,
    });
    if (video) {
      return {
        sceneNumber: scene.sceneNumber,
        mediaKind: 'video',
        filePath: video.path,
        durationSec: video.durationSec,
        provider: video.provider,
      };
    }

    // Last-resort AI image or atmospheric backdrop (still NEVER random unvetted stock photos)
    const aiLast = await this.tryGenerateHeroAiImage({
      promptEn: scene.visualPromptEn,
      styleGuideEn: script.visualStyleGuideEn,
      aspect: '16:9',
      outPath: imgOut,
    });
    if (aiLast) {
      return {
        sceneNumber: scene.sceneNumber,
        mediaKind: 'image',
        filePath: aiLast.path,
        provider: aiLast.provider,
      };
    }

    const fallbackImg = await this.generateDarkProceduralBackdrop(imgOut, '16:9');
    return {
      sceneNumber: scene.sceneNumber,
      mediaKind: 'image',
      filePath: fallbackImg,
      provider: 'procedural-backdrop',
    };
  }

  /**
   * Curates 13-15 rapid-fire vertical 9:16 assets (~2.6-3.0s per cut!) for the Bridge Short:
   * - Mixes vertical AI hero hooks, vertical animated map, archival evidence, fresh vertical 9:16 HD video clips,
   *   and crisp 1080p HD video beats from the episode so viewers get a visual change every ~2.7 seconds.
   */
  async curateBridgeShortAssets(params: {
    script: DocumentaryScript;
    workDir: string;
    existingBeatAssets?: CuratedBeatAsset[];
  }): Promise<CuratedBeatAsset[]> {
    const { script, workDir, existingBeatAssets = [] } = params;
    const vidQueries = script.bridgeShort.videoSearchQueries?.length
      ? script.bridgeShort.videoSearchQueries
      : script.bridgeShort.pexelsFallbackQueries || [];
    const prompts = script.bridgeShort.visualPromptsEn || [];
    const totalSlots = Math.max(12, Math.min(15, Math.max(vidQueries.length, 13)));

    const reusableVideos = existingBeatAssets.filter(
      a => a.mediaKind === 'video' && a.filePath && fs.existsSync(a.filePath)
    );
    const reusableImages = existingBeatAssets.filter(
      a => a.mediaKind === 'image' && a.filePath && fs.existsSync(a.filePath) && !a.provider.includes('procedural')
    );

    const assets: CuratedBeatAsset[] = [];
    for (let i = 0; i < totalSlots; i++) {
      const slotNum = i + 1;
      const vidOut = path.join(workDir, 'videos_9x16', `short_vid_${slotNum}.mp4`);
      const imgOut = path.join(workDir, 'scenes_9x16', `short_scene_${slotNum}.jpg`);

      // Place vertical animated map at slot 3 (~5.5s in) if mapSpec exists!
      if (i === 2 && (script.bridgeShort.mapSpec?.from || script.primaryMapSpec?.from)) {
        assets.push({
          sceneNumber: slotNum,
          mediaKind: 'animated_map',
          provider: 'motion-graphics-map',
          mapSpec: script.bridgeShort.mapSpec || script.primaryMapSpec,
        });
        continue;
      }

      // Slot 1 (0.0s opening hook) or Slot 7 (mid-point reveal): try vertical AI hero or archival image
      if ((i === 0 && prompts[0]) || (i === 6 && prompts[1])) {
        const promptToUse = i === 0 ? prompts[0] : prompts[1];
        const aiHook = await this.tryGenerateHeroAiImage({
          promptEn: promptToUse,
          styleGuideEn: script.visualStyleGuideEn,
          aspect: '9:16',
          outPath: imgOut,
        });
        if (aiHook) {
          assets.push({
            sceneNumber: slotNum,
            mediaKind: 'image',
            filePath: aiHook.path,
            provider: aiHook.provider,
          });
          continue;
        }
      }

      // For odd rapid-cut B-roll slots after slot 5, interleave already-downloaded HD moving video beats for speed + variety
      if (i >= 5 && i % 2 === 1 && reusableVideos.length > 0) {
        const picked = reusableVideos[(i * 3) % reusableVideos.length];
        assets.push({
          sceneNumber: slotNum,
          mediaKind: 'video',
          filePath: picked.filePath,
          durationSec: picked.durationSec,
          provider: `reused-hd:${picked.provider}`,
        });
        continue;
      }

      const q = vidQueries[i % Math.max(1, vidQueries.length)] || 'dark stormy ocean waves';
      const vid = await this.fetchCuratedVideoClip({
        queries: [q],
        mood: script.mood,
        aspect: '9:16',
        outPath: vidOut,
      });

      if (vid) {
        assets.push({
          sceneNumber: slotNum,
          mediaKind: 'video',
          filePath: vid.path,
          durationSec: vid.durationSec,
          provider: vid.provider,
        });
      } else if (reusableVideos.length > 0) {
        const picked = reusableVideos[i % reusableVideos.length];
        assets.push({
          sceneNumber: slotNum,
          mediaKind: 'video',
          filePath: picked.filePath,
          durationSec: picked.durationSec,
          provider: `reused-hd:${picked.provider}`,
        });
      } else if (reusableImages.length > 0) {
        const picked = reusableImages[i % reusableImages.length];
        assets.push({
          sceneNumber: slotNum,
          mediaKind: 'image',
          filePath: picked.filePath,
          provider: `reused-img:${picked.provider}`,
        });
      } else {
        const fallbackImg = await this.generateDarkProceduralBackdrop(imgOut, '9:16');
        assets.push({
          sceneNumber: slotNum,
          mediaKind: 'image',
          filePath: fallbackImg,
          provider: 'procedural-backdrop',
        });
      }
    }

    return assets;
  }
}
