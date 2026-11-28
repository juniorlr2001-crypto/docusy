import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import {
  AccentPalette,
  CreativeDnaPlan,
  MusicVariant,
  NarrativeArchetype,
  ShortCaptionTheme,
  ThumbnailArchetype,
  TopicCategory,
} from '../types.js';

const MEMORY_FILE = path.join(CONFIG.DATA_DIR, 'performance_memory.json');

const CATEGORIES: TopicCategory[] = [
  'supervivencia',
  'ciencia_extrema',
  'errores_historicos',
  'misterios',
];

const NARRATIVE_ARCHETYPES: Record<NarrativeArchetype, string> = {
  countdown_forensic:
    'CUENTA REGRESIVA FORENSE: Arranca en el instante exacto del impacto/desastre y reconstruye minuto a minuto qué falló y cómo se decidió todo en segundos.',
  survival_immersion:
    'INMERSIÓN EN SEGUNDA PERSONA + CASO REAL: Pon al espectador dentro del lugar extremo ("Imagina estar a...", "Tus pulmones...") entrelazado con los protagonistas reales.',
  mystery_investigation:
    'EXPEDIENTE DE PISTAS IMPOSIBLES: Presenta 3 hallazgos reales que contradecían toda lógica y revela al final la explicación científica verificada.',
  domino_effect:
    'EFECTO DOMINÓ OCULTO: Muestra cómo un detalle diminuto e ignorado desató una cadena imparable de consecuencias colosales.',
  scale_paradox:
    'PARADOJA DE ESCALA HUMANA (ESTILO VERITASIUM): Usa comparaciones físicas cotidianas impactantes para que cualquier público sienta la magnitud extrema del fenómeno.',
};

const THUMBNAIL_ARCHETYPES: ThumbnailArchetype[] = [
  'editorial_left',
  'editorial_right',
  'cinema_bottom',
  'forensic_dossier',
];

const ACCENT_PALETTES: AccentPalette[] = [
  'electric_gold',
  'crimson_alert',
  'biolum_cyan',
  'solar_amber',
  'ice_laser',
];

const NARRATOR_VOICES: Array<'Fenrir' | 'Charon' | 'Orus'> = ['Fenrir', 'Charon', 'Orus'];

const MUSIC_VARIANTS: MusicVariant[] = [
  'zimmer_pulse',
  'abyssal_cello',
  'clockwork_thriller',
  'interstellar_organ',
];

const SHORT_THEMES: ShortCaptionTheme[] = ['gold_impact', 'cyan_pulse', 'crimson_alert'];

export interface LiveVideoMetric {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSec: number;
  isShort: boolean;
  views: number;
  likes: number;
  comments: number;
  likeRate: number;
  compositeScore: number;
}

export interface EpisodeLedgerEntry {
  slug: string;
  topicId: string;
  category: TopicCategory;
  narrativeArchetype: NarrativeArchetype;
  thumbnailArchetype: ThumbnailArchetype;
  accentPalette: AccentPalette;
  narratorVoice: string;
  musicVariant: MusicVariant;
  shortCaptionTheme: ShortCaptionTheme;
  youtubeTitle: string;
  shortTitle: string;
  thumbnailHeadline: string;
  thumbnailStatBadge?: string;
  shortWordCount: number;
  shortDurationSec: number;
  documentaryVideoId?: string;
  shortVideoId?: string;
  createdAt: string;
  // Populated automatically on future runs from live YouTube API:
  docuViews?: number;
  docuLikes?: number;
  shortViews?: number;
  shortLikes?: number;
  rewardScore?: number;
}

export interface PerformanceMemoryState {
  updatedAt: string;
  channelSubscribers: number;
  liveVideos: LiveVideoMetric[];
  episodes: EpisodeLedgerEntry[];
  recentStockVideoIds: string[];
  recentStatBadges: string[];
}

function defaultMemory(): PerformanceMemoryState {
  return {
    updatedAt: new Date(0).toISOString(),
    channelSubscribers: 0,
    liveVideos: [],
    episodes: [],
    recentStockVideoIds: [],
    recentStatBadges: [],
  };
}

export function loadPerformanceMemory(): PerformanceMemoryState {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      return {
        updatedAt: String(parsed.updatedAt || new Date(0).toISOString()),
        channelSubscribers: Number(parsed.channelSubscribers || 0),
        liveVideos: Array.isArray(parsed.liveVideos) ? parsed.liveVideos : [],
        episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
        recentStockVideoIds: Array.isArray(parsed.recentStockVideoIds) ? parsed.recentStockVideoIds.slice(-260) : [],
        recentStatBadges: Array.isArray(parsed.recentStatBadges) ? parsed.recentStatBadges.slice(-14) : [],
      };
    }
  } catch {
    // ignore corrupt state
  }
  return defaultMemory();
}

export function savePerformanceMemory(state: PerformanceMemoryState): void {
  fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
  state.recentStockVideoIds = Array.from(new Set(state.recentStockVideoIds)).slice(-260);
  state.recentStatBadges = state.recentStatBadges.filter(Boolean).slice(-14);
  state.episodes = state.episodes.slice(-80);
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function parseIsoDurationSec(iso: string): number {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
}

async function fetchYouTubeToken(): Promise<string | null> {
  if (!CONFIG.YOUTUBE_CLIENT_ID || !CONFIG.YOUTUBE_CLIENT_SECRET || !CONFIG.YOUTUBE_REFRESH_TOKEN) {
    return null;
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CONFIG.YOUTUBE_CLIENT_ID,
        client_secret: CONFIG.YOUTUBE_CLIENT_SECRET,
        refresh_token: CONFIG.YOUTUBE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * $0 Closed-Loop Telemetry Sync:
 * Reads real live YouTube video views, likes, comments & durations (~3 quota units out of 10,000 free/day)
 * and updates reward scores in `data/performance_memory.json` so every run learns from real audience behavior.
 */
export async function syncLiveChannelTelemetry(): Promise<PerformanceMemoryState> {
  const memory = loadPerformanceMemory();
  const token = await fetchYouTubeToken();
  if (!token) return memory;

  try {
    const chRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&mine=true',
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!chRes.ok) return memory;
    const chData: any = await chRes.json();
    const ch = chData?.items?.[0];
    if (!ch) return memory;

    memory.channelSubscribers = Number(ch?.statistics?.subscriberCount || memory.channelSubscribers || 0);
    const uploadsId = ch?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) return memory;

    const plRes = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsId)}&maxResults=45`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!plRes.ok) return memory;
    const plData: any = await plRes.json();
    const videoIds: string[] = (plData?.items || [])
      .map((it: any) => String(it?.contentDetails?.videoId || ''))
      .filter(Boolean);

    if (videoIds.length === 0) return memory;

    const vRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) }
    );
    if (!vRes.ok) return memory;
    const vData: any = await vRes.json();
    const now = Date.now();

    const liveVideos: LiveVideoMetric[] = [];
    for (const v of vData?.items || []) {
      const durSec = parseIsoDurationSec(v?.contentDetails?.duration || '');
      const title = String(v?.snippet?.title || '').trim();
      const isShort = durSec <= 95 || /#shorts/i.test(title);
      const views = parseInt(v?.statistics?.viewCount || '0', 10) || 0;
      const likes = parseInt(v?.statistics?.likeCount || '0', 10) || 0;
      const comments = parseInt(v?.statistics?.commentCount || '0', 10) || 0;
      const publishedAt = String(v?.snippet?.publishedAt || '');
      const ageHours = Math.max(1, (now - new Date(publishedAt).getTime()) / 3_600_000);
      const likeRate = views > 0 ? likes / views : 0;
      const commentRate = views > 0 ? comments / views : 0;

      // Engagement-weighted velocity score (rewards both breakout reach and high viewer satisfaction)
      const engagementBoost = 1 + Math.min(2.8, likeRate * 36 + commentRate * 85);
      const freshnessBoost = ageHours >= 2 && ageHours <= 20 ? 1.3 : 1.0;
      const compositeScore = Number((views * engagementBoost * freshnessBoost).toFixed(1));

      liveVideos.push({
        videoId: String(v.id),
        title,
        publishedAt,
        durationSec: durSec,
        isShort,
        views,
        likes,
        comments,
        likeRate: Number(likeRate.toFixed(4)),
        compositeScore,
      });
    }

    memory.liveVideos = liveVideos;

    // Backfill reward scores onto tracked episodes
    const byId = new Map(liveVideos.map(v => [v.videoId, v]));
    for (const ep of memory.episodes) {
      const docu = ep.documentaryVideoId ? byId.get(ep.documentaryVideoId) : undefined;
      const sh = ep.shortVideoId ? byId.get(ep.shortVideoId) : undefined;
      if (docu) {
        ep.docuViews = docu.views;
        ep.docuLikes = docu.likes;
      }
      if (sh) {
        ep.shortViews = sh.views;
        ep.shortLikes = sh.likes;
      }
      if (docu || sh) {
        // Long-form views are weighted 8x vs Short views so the bandit optimizes BOTH 16:9 clicks & Short loops
        ep.rewardScore = Number(((docu?.compositeScore || 0) * 8 + (sh?.compositeScore || 0)).toFixed(1));
      }
    }

    savePerformanceMemory(memory);
    console.log(
      `[SelfLearning] 🧠 Telemetría sincronizada (${liveVideos.length} videos en vivo · ${memory.channelSubscribers} subs).`
    );
  } catch (err: any) {
    console.warn(`[SelfLearning] ⚠️ No se pudo sincronizar telemetría en vivo: ${err?.message || err}`);
  }

  return memory;
}

/**
 * Multi-Armed Bandit + Strict Anti-Factory Rotation Selector:
 * - Never repeats any of the `cooldownRecent` items used in the immediately preceding episodes.
 * - Combines empirical average reward + UCB1 exploration bonus so untested styles get explored
 *   and proven high-retention styles get favored over time.
 */
function pickAdaptiveVariant<T extends string>(
  allVariants: T[],
  recentUsed: T[],
  episodes: EpisodeLedgerEntry[],
  extractor: (ep: EpisodeLedgerEntry) => T | undefined,
  cooldownCount: number
): T {
  const forbidden = new Set(recentUsed.slice(-cooldownCount));
  const eligible = allVariants.filter(v => !forbidden.has(v));
  const pool = eligible.length > 0 ? eligible : allVariants;

  const scoredEps = episodes.filter(e => typeof e.rewardScore === 'number' && (e.rewardScore || 0) > 0);
  if (scoredEps.length < 3) {
    // Deterministic least-recently-used rotation during cold start
    for (const candidate of pool) {
      if (!recentUsed.includes(candidate)) return candidate;
    }
    return pool[episodes.length % pool.length];
  }

  const globalMean =
    scoredEps.reduce((acc, e) => acc + (e.rewardScore || 0), 0) / Math.max(1, scoredEps.length) || 1;
  const totalN = scoredEps.length;

  let best = pool[0];
  let bestUcb = -Infinity;

  for (const candidate of pool) {
    const matches = scoredEps.filter(e => extractor(e) === candidate);
    if (matches.length === 0) {
      // High exploration bonus for untried creative variants
      const ucb = 1.65;
      if (ucb > bestUcb) {
        bestUcb = ucb;
        best = candidate;
      }
      continue;
    }
    const avgNorm =
      matches.reduce((acc, e) => acc + (e.rewardScore || 0), 0) / matches.length / globalMean;
    const exploration = 0.42 * Math.sqrt(Math.log(totalN + 1) / matches.length);
    const ucb = avgNorm + exploration;
    if (ucb > bestUcb) {
      bestUcb = ucb;
      best = candidate;
    }
  }

  return best;
}

/**
 * Learns the optimal Short word count target from live duration performance on YouTube.
 */
function computeOptimalShortWordBounds(liveVideos: LiveVideoMetric[]): { minWords: number; maxWords: number } {
  const matureShorts = liveVideos.filter(
    v => v.isShort && v.durationSec >= 18 && v.durationSec <= 85 && v.views >= 50
  );
  if (matureShorts.length < 4) {
    return { minWords: 62, maxWords: 75 }; // ~24-29s proven loop sweet spot
  }

  const buckets = [
    { minSec: 18, maxSec: 33, minWords: 60, maxWords: 74, scores: [] as number[] },
    { minSec: 34, maxSec: 44, minWords: 74, maxWords: 88, scores: [] as number[] },
    { minSec: 45, maxSec: 90, minWords: 86, maxWords: 98, scores: [] as number[] },
  ];

  for (const s of matureShorts) {
    const b = buckets.find(bk => s.durationSec >= bk.minSec && s.durationSec <= bk.maxSec);
    if (b) b.scores.push(s.compositeScore);
  }

  // Prefer crisp 24-31s loop unless a longer bucket beats it by >20%
  let bestBucket = buckets[0];
  let bestAvg = buckets[0].scores.length
    ? (buckets[0].scores.reduce((a, c) => a + c, 0) / buckets[0].scores.length) * 1.12
    : 1200;

  for (const b of buckets.slice(1)) {
    if (b.scores.length >= 2) {
      const avg = b.scores.reduce((a, c) => a + c, 0) / b.scores.length;
      if (avg > bestAvg * 1.2) {
        bestAvg = avg;
        bestBucket = b;
      }
    }
  }

  return { minWords: bestBucket.minWords, maxWords: bestBucket.maxWords };
}

/**
 * Generates the Self-Learning + Anti-Factory Creative DNA Plan for the next episode.
 */
export function buildSelfLearningCreativePlan(
  memory: PerformanceMemoryState,
  lastHistoryCategory?: TopicCategory
): CreativeDnaPlan {
  const eps = memory.episodes;

  const recentCats = [
    ...eps.map(e => e.category),
    ...(lastHistoryCategory ? [lastHistoryCategory] : []),
  ];
  const recommendedCategory = pickAdaptiveVariant(
    CATEGORIES,
    recentCats,
    eps,
    e => e.category,
    1
  );

  const narrativeArchetype = pickAdaptiveVariant(
    Object.keys(NARRATIVE_ARCHETYPES) as NarrativeArchetype[],
    eps.map(e => e.narrativeArchetype),
    eps,
    e => e.narrativeArchetype,
    2
  );

  const thumbnailArchetype = pickAdaptiveVariant(
    THUMBNAIL_ARCHETYPES,
    eps.map(e => e.thumbnailArchetype),
    eps,
    e => e.thumbnailArchetype,
    2
  );

  const accentPalette = pickAdaptiveVariant(
    ACCENT_PALETTES,
    eps.map(e => e.accentPalette),
    eps,
    e => e.accentPalette,
    2
  );

  const narratorVoice = pickAdaptiveVariant(
    NARRATOR_VOICES,
    eps.map(e => e.narratorVoice as 'Fenrir' | 'Charon' | 'Orus'),
    eps,
    e => e.narratorVoice as 'Fenrir' | 'Charon' | 'Orus',
    1
  );

  const musicVariant = pickAdaptiveVariant(
    MUSIC_VARIANTS,
    eps.map(e => e.musicVariant),
    eps,
    e => e.musicVariant,
    2
  );

  const shortCaptionTheme = pickAdaptiveVariant(
    SHORT_THEMES,
    eps.map(e => e.shortCaptionTheme),
    eps,
    e => e.shortCaptionTheme,
    1
  );

  const { minWords, maxWords } = computeOptimalShortWordBounds(memory.liveVideos);

  // Extract real winning vs stalling titles from live YouTube telemetry
  const now = Date.now();
  const matureVideos = memory.liveVideos.filter(
    v => now - new Date(v.publishedAt).getTime() > 3.5 * 3_600_000
  );
  const matureShorts = [...matureVideos.filter(v => v.isShort)].sort(
    (a, b) => b.compositeScore - a.compositeScore
  );
  const matureLongs = [...matureVideos.filter(v => !v.isShort)].sort(
    (a, b) => b.compositeScore - a.compositeScore
  );

  const topShorts = matureShorts.slice(0, 3);
  const weakShorts = matureShorts.slice(-2).filter(v => v.views < 600);
  const topLongs = matureLongs.slice(0, 3).filter(v => v.views > 15);
  const weakLongs = matureLongs.slice(-2).filter(v => v.views <= 15);

  const lines: string[] = [];
  if (topShorts.length > 0 || topLongs.length > 0) {
    lines.push('DATOS REALES APRENDIDOS DE NUESTRO CANAL DE YOUTUBE (OPTIMIZACIÓN AUTOMÁTICA):');
    if (topShorts.length > 0) {
      lines.push(
        `- Shorts con MAYOR retención y alcance real: ${topShorts
          .map(s => `"${s.title.replace(/\s*#shorts/i, '')}" (${s.views} vistas, ${(s.likeRate * 100).toFixed(1)}% likes, ${s.durationSec}s)`)
          .join(' | ')}.`
      );
    }
    if (topLongs.length > 0) {
      lines.push(
        `- Documentales 16:9 con MÁS clics reales: ${topLongs
          .map(l => `"${l.title}" (${l.views} vistas)`)
          .join(' | ')}.`
      );
    }
    if (weakShorts.length > 0 || weakLongs.length > 0) {
      const weakSample = [...weakLongs, ...weakShorts]
        .slice(0, 3)
        .map(w => `"${w.title.replace(/\s*#shorts/i, '')}" (${w.views} vistas)`)
        .join(' | ');
      lines.push(
        `- Títulos que FRENARON el alcance en público frío (EVITAR su tono académico/lento o falta de urgencia humana): ${weakSample}.`
      );
    }
    lines.push(
      '- LECCIÓN ACTIVA: Todo título y primer segundo DEBE conectar con una emoción o peligro humano universal comprensible al instante por cualquier persona, con cifras concretas y <= 58 caracteres en el título 16:9 para no truncarse en celular.'
    );
  }

  const forbiddenStatBadges = Array.from(
    new Set([
      ...memory.recentStatBadges.slice(-10),
      ...eps.slice(-8).map(e => e.thumbnailStatBadge || '').filter(Boolean),
    ])
  );

  const forbiddenOpeningPhrases = eps
    .slice(-6)
    .map(e => e.youtubeTitle.split(/\s+/).slice(0, 3).join(' '))
    .filter(Boolean);

  console.log(
    `[SelfLearning] 🎲 ADN Creativo Anti-Fábrica -> Formato=${narrativeArchetype} | Miniatura=${thumbnailArchetype} (${accentPalette}) | Voz=${narratorVoice} | Música=${musicVariant} | Short=${minWords}-${maxWords} palabras`
  );

  return {
    recommendedCategory,
    narrativeArchetype,
    narrativeInstructionEs: NARRATIVE_ARCHETYPES[narrativeArchetype],
    thumbnailArchetype,
    accentPalette,
    narratorVoice,
    musicVariant,
    shortCaptionTheme,
    targetShortMinWords: minWords,
    targetShortMaxWords: maxWords,
    forbiddenStatBadges,
    forbiddenOpeningPhrases,
    learningBriefEs: lines.join('\n'),
  };
}

export function recordCompletedEpisodeInMemory(params: {
  memory: PerformanceMemoryState;
  entry: EpisodeLedgerEntry;
  usedStockVideoIds: string[];
}): void {
  const { memory, entry, usedStockVideoIds } = params;
  const idx = memory.episodes.findIndex(e => e.slug === entry.slug);
  if (idx >= 0) {
    memory.episodes[idx] = { ...memory.episodes[idx], ...entry };
  } else {
    memory.episodes.push(entry);
  }
  if (entry.thumbnailStatBadge) {
    memory.recentStatBadges.push(entry.thumbnailStatBadge.toUpperCase().trim());
  }
  memory.recentStockVideoIds.push(...usedStockVideoIds);
  savePerformanceMemory(memory);
}
