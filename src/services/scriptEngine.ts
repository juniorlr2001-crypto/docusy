import { CONFIG } from '../config.js';
import {
  BeatVisualType,
  CameraMotion,
  CinemaColorLook,
  CreativeDnaPlan,
  DocumentaryScript,
  DocumentaryTopic,
  MapSpec,
  StatOverlay,
} from '../types.js';

const MOTIONS: CameraMotion[] = ['zoom_in', 'pan_right', 'zoom_out', 'pan_left'];
const VALID_VISUAL_TYPES: BeatVisualType[] = [
  'video_broll',
  'ai_cinema',
  'animated_map',
  'stat_dossier',
  'archival_evidence',
];
const VALID_COLOR_LOOKS: CinemaColorLook[] = [
  'ocean_noir',
  'jungle_emerald',
  'arctic_steel',
  'coldwar_tungsten',
  'cosmos_gold',
  'vintage_sepia',
];

const DANGLING_SPANISH_WORDS = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'EN', 'CON', 'POR', 'PARA', 'SIN', 'BAJO', 'SOBRE', 'ENTRE', 'HACIA', 'HASTA', 'UN', 'UNA', 'Y', 'O', 'QUE',
]);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function extractJsonObject(raw: string): any {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('La respuesta de Gemini no contiene un bloque JSON válido.');
  }
  const slice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    const sanitized = slice
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    return JSON.parse(sanitized);
  }
}

function sanitizeMapSpec(raw: any): MapSpec | undefined {
  if (!raw || typeof raw !== 'object' || !raw.from) return undefined;
  const fLat = Number(raw.from.lat);
  const fLon = Number(raw.from.lon);
  if (!Number.isFinite(fLat) || !Number.isFinite(fLon)) return undefined;
  if (Math.abs(fLat) > 85 || Math.abs(fLon) > 180) return undefined;

  const map: MapSpec = {
    title: String(raw.title || 'UBICACIÓN GEOGRÁFICA').trim().slice(0, 48),
    from: {
      name: String(raw.from.name || 'Origen').trim().slice(0, 32),
      lat: fLat,
      lon: fLon,
    },
    distanceLabel: raw.distanceLabel ? String(raw.distanceLabel).trim().slice(0, 24) : undefined,
    dateLabel: raw.dateLabel ? String(raw.dateLabel).trim().slice(0, 34) : undefined,
  };

  if (raw.to) {
    const tLat = Number(raw.to.lat);
    const tLon = Number(raw.to.lon);
    if (Number.isFinite(tLat) && Number.isFinite(tLon) && Math.abs(tLat) <= 85 && Math.abs(tLon) <= 180) {
      map.to = {
        name: String(raw.to.name || 'Destino').trim().slice(0, 32),
        lat: tLat,
        lon: tLon,
      };
    }
  }
  return map;
}

function sanitizeStatOverlay(raw: any): StatOverlay | undefined {
  if (!raw || typeof raw !== 'object' || !raw.value) return undefined;
  const value = String(raw.value).trim().slice(0, 24);
  if (!value) return undefined;
  return {
    eyebrow: raw.eyebrow ? String(raw.eyebrow).trim().slice(0, 38) : 'DATO VERIFICADO',
    value,
    label: String(raw.label || '').trim().slice(0, 64),
    detail: raw.detail ? String(raw.detail).trim().slice(0, 96) : undefined,
  };
}

function sanitizeThumbnailHeadline(rawHeadline: string, fallback = 'CASO IMPOSIBLE'): string {
  const cleaned = String(rawHeadline || '')
    .toUpperCase()
    .replace(/[¿?¡!"'.,:;()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;

  const words = cleaned.split(' ').slice(0, 4);
  while (words.length > 1 && DANGLING_SPANISH_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  const joined = words.join(' ').slice(0, 20).trim();
  const finalWords = joined.split(' ');
  while (finalWords.length > 1 && DANGLING_SPANISH_WORDS.has(finalWords[finalWords.length - 1])) {
    finalWords.pop();
  }
  const res = finalWords.join(' ').trim();
  return res.length >= 4 ? res : fallback;
}

function sanitizeMobileTitle(rawTitle: string, fallback: string): string {
  let title = String(rawTitle || fallback).replace(/\s+/g, ' ').trim();
  // If title has an essay colon and exceeds 60 chars, keep the stronger half if self-contained or trim cleanly
  if (title.length > 64 && title.includes(':')) {
    const [left, right] = title.split(':').map(s => s.trim());
    if (left.length >= 28 && left.length <= 62) {
      title = left;
    } else if (right && right.length >= 28 && right.length <= 62) {
      title = right;
    }
  }
  return title.slice(0, 72).trim();
}

/**
 * Enforces strict Short word budget (default ~60-78 words = ~24-30s) so Gemini NEVER produces
 * bloated 60-80s Shorts that kill loop completion rate.
 */
function enforceShortLoopWordBudget(rawText: string, maxWords: number): string {
  const clean = rawText
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\*\*|\*/g, '')
    .replace(
      /(?:Si quieres conocer|Para conocer|Mira|Descubre|Encuentra|Ve a ver)\s+(?:la historia completa|el documental completo|el video completo|toda la verdad)[^.!?]*[.!?]?$/i,
      ''
    )
    .replace(/(?:Suscríbete|Síguenos)[^.!?]*[.!?]?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = clean.split(' ').filter(Boolean);
  if (words.length <= maxWords + 6) {
    return clean;
  }

  // Cut cleanly at the last sentence or clause boundary within [maxWords - 14 .. maxWords + 4]
  const sentences = clean.split(/(?<=[.!?…])\s+/).filter(Boolean);
  const kept: string[] = [];
  let count = 0;
  for (const s of sentences) {
    const sWords = s.split(/\s+/).filter(Boolean).length;
    if (count + sWords > maxWords + 5 && count >= 48) {
      break;
    }
    kept.push(s);
    count += sWords;
  }
  if (kept.length > 0) {
    return kept.join(' ').trim();
  }
  return words.slice(0, maxWords).join(' ').replace(/[,;:]$/, '') + '...';
}

async function callGeminiJson(prompt: string): Promise<any> {
  if (!CONFIG.GEMINI_API_KEY) {
    throw new Error('Falta DOCU_GEMINI_API_KEY (o GEMINI_API_KEY) en .env para redactar el guion documental.');
  }

  const models = [
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
  ];
  let lastError = '';

  for (let round = 1; round <= 3; round++) {
    if (round > 1) {
      const waitSec = round * 10;
      console.log(`[ScriptEngine] ⏳ Reintentando ronda ${round}/3 tras ${waitSec}s de espera...`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(CONFIG.GEMINI_API_KEY)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.76,
              maxOutputTokens: 32768,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = `${model} HTTP ${res.status}: ${errText.slice(0, 260)}`;
          console.warn(`[ScriptEngine] ⚠️ ${lastError}`);
          if (res.status === 429 || res.status === 503) {
            await new Promise(r => setTimeout(r, 6000));
          }
          continue;
        }

        const data: any = await res.json();
        const text = data?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p?.text || '')
          .join('')
          .trim();

        if (!text) {
          lastError = `${model} devolvió respuesta vacía.`;
          continue;
        }

        const parsed = extractJsonObject(text);
        console.log(`[ScriptEngine] ✅ Guion + storyboard IMAX v2.5 generado con ${model} (${text.length} chars).`);
        return parsed;
      } catch (err: any) {
        lastError = `${model}: ${err?.message || err}`;
        console.warn(`[ScriptEngine] ⚠️ ${lastError}`);
      }
    }
  }

  throw new Error(`No se pudo generar el guion con Gemini: ${lastError}`);
}

export async function generateDocumentaryScript(
  topic: DocumentaryTopic,
  options: { quickMode?: boolean; creativePlan?: CreativeDnaPlan } = {}
): Promise<DocumentaryScript> {
  const isQuick = Boolean(options.quickMode);
  const plan = options.creativePlan;
  const chapterCount = isQuick ? 2 : 6;
  const beatsPerChapter = isQuick ? 6 : 12;
  const wordsPerChapter = isQuick ? '75 a 95' : '215 a 245';
  const totalTargetWords = isQuick
    ? '160 a 190 palabras (~1 min)'
    : '1,320 a 1,460 palabras (8.5 a 9.5 minutos de alta densidad sin relleno)';

  const shortMinW = plan?.targetShortMinWords || 62;
  const shortMaxW = plan?.targetShortMaxWords || 75;

  const factsBlock = topic.verifiedFacts
    ? topic.verifiedFacts.slice(0, 4200)
    : 'Usa únicamente hechos históricos y científicos ampliamente verificados y reconocidos. No inventes cifras falsas ni nombres ficticios.';

  const narrativeBlock = plan
    ? `\nESTRUCTURA NARRATIVA ROTATIVA DE ESTE EPISODIO (ANTI-EFECTO FÁBRICA):\n- Arquetipo asignado: ${plan.narrativeInstructionEs}\n- PROHIBIDO empezar títulos igual que episodios recientes: ${plan.forbiddenOpeningPhrases.join(' | ') || 'ninguno'}.\n- PROHIBIDO repetir cualquiera de estos badges de esquina ya usados: ${plan.forbiddenStatBadges.join(', ') || 'ninguno'}.`
    : '';

  const learningBlock = plan?.learningBriefEs ? `\n${plan.learningBriefEs}\n` : '';

  const thumbCompositionCue =
    plan?.thumbnailArchetype === 'editorial_right'
      ? 'el sujeto focal hiperrealista iluminado DEBE estar ubicado limpiamente en el LADO IZQUIERDO del encuadre (tercio izquierdo), dejando el LADO DERECHO con atmósfera oscura limpia para el texto'
      : plan?.thumbnailArchetype === 'cinema_bottom'
        ? 'el sujeto focal hiperrealista iluminado DEBE ocupar el CENTRO SUPERIOR del encuadre con gran escala cinematográfica, dejando el TERCIO INFERIOR más oscuro para el titular'
        : 'el sujeto focal hiperrealista y bien iluminado DEBE estar ubicado limpiamente en el LADO DERECHO del encuadre (tercio derecho), dejando el LADO IZQUIERDO oscuro y limpio para el texto';

  const prompt = `Eres director creativo y guionista jefe de documentales virales cinematográficos (estilo Lemmino / Fern / Veritasium / National Geographic IMAX) en español latinoamericano neutro, diseñados para ENGANCHAR A TODO TIPO DE PÚBLICO (incluso gente que no sabe nada de historia o ciencia) desde el segundo 0.0.

TEMA VERIFICADO:
- Título semilla: ${topic.titleSeed}
- Enfoque: ${topic.angle}
- Categoría: ${topic.category}
- Atmósfera visual base: ${topic.visualTheme}
${narrativeBlock}
${learningBlock}
DOSSIER DE HECHOS REALES (Wikipedia):
${factsBlock}

REGLAS ESTRICTAS DE RETENCIÓN Y ANTI-MONOTONÍA:
1. Extensión 16:9: ${totalTargetWords}, dividido en exactamente ${chapterCount} capítulos de ${wordsPerChapter} palabras cada uno (sin asteriscos, sin markdown, sin relleno poético repetitivo).
2. SEGUNDO 0.0 (COLD OPEN UNIVERSAL PARA PÚBLICO FRÍO): PROHIBIDO empezar con fechas secas ("El 10 de agosto de 1628...") o nombres desconocidos sin contexto. La PRIMERA ORACIÓN debe lanzar una situación humana, física o sensorial inmediata que cualquiera entienda y no pueda ignorar (ej. "Imagina construir la máquina más cara del planeta y verla hundirse frente a miles de personas veinte minutos después de zarpar", "A treinta grados bajo cero, nueve excursionistas rasgaron su propia tienda desde adentro y corrieron descalzos hacia la nieve"). En los primeros 18 segundos plantea el misterio central.
3. Cada capítulo (excepto el último) cierra con un giro revelador ("micro-cliffhanger") que obligue a escuchar el siguiente acto. El último capítulo entrega la verdad científica/histórica verificada + una pregunta debatible A vs B.
4. "youtubeTitle" (EMPAQUETADO MÓVIL DE ALTO CTR):
   - Máximo 58 caracteres ideales (tope absoluto 64 caracteres) para que NUNCA se corte con "..." en teléfonos móviles.
   - Directo, emocional, curioso y comprensible para cualquier edad. PROHIBIDO usar títulos lentos de libro de texto o dos frases largas separadas por dos puntos ":".
5. Storyboard visual dinámico (${beatsPerChapter} planos por capítulo = 72 cortes rápidos cada ~6.5 segundos):
   - Elige el "colorLook": "ocean_noir" | "jungle_emerald" | "arctic_steel" | "coldwar_tungsten" | "cosmos_gold" | "vintage_sepia".
   - ~7-8 planos "video_broll" por capítulo con 3 búsquedas cortas en inglés ("videoSearchQueries", 2-3 palabras concretas cinematográficas; PROHIBIDO playas turísticas, oficinas o gente sonriendo).
   - ~2 planos "ai_cinema" por capítulo con "visualPromptEn" cinematográfico 70mm bien iluminado y realista (SIN texto, SIN letras).
   - 1 plano "stat_dossier" por capítulo con cifra real verificada ("statOverlay": { "eyebrow", "value", "label", "detail" }). Exactitud total: jamás confundas "24,000 millones de km" con "24,000 km".
   - Al menos 2 capítulos con "animated_map" (coordenadas reales lat/lon) y 2 con "archival_evidence".
6. "bridgeShort" (DISEÑO VIRAL DE BUCLE PERFECTO — 24 A 29 SEGUNDOS):
   - "narrationEs": ESTRICTAMENTE ENTRE ${shortMinW} Y ${shortMaxW} PALABRAS (ni una más).
   - Segundos 0-2: Frase inicial explosiva y universal para frenar el dedo al instante (sin fechas aburridas).
   - Segundos 2-24: 4 datos o giros rápidos llenos de tensión humana y cifras reales.
   - Últimos 3 segundos (LOOP CIRCULAR INFINITO): PROHIBIDO despedirse, prohibido decir "Mira el documental completo" o "Suscríbete". Termina con una frase incompleta o conector intrigante que encaje gramaticalmente con la primera palabra del segundo 0:00.
   - "pinnedComment": Pregunta corta y polémica A vs B para desatar comentarios en el Short + mención natural al título del documental largo en el canal.
   - Incluye 15 búsquedas verticales rápidas en inglés ("videoSearchQueries") y 3 prompts verticales ("visualPromptsEn").
7. MINIATURA 16:9 DE ALTO IMPACTO MÓVIL:
   - "thumbnailHeadline": 2 o 3 PALABRAS COMPLETAS EN ESPAÑOL EN MAYÚSCULAS (máx 15 caracteres en total, ej. "HUNDIDO EN 20M", "NADIE VOLVIÓ", "SECRETO BAJO HIELO", "FALLO MORTAL"). PROHIBIDO dejar frases cortadas a la mitad como "11KM BAJO" o terminar en preposición ("DE", "BAJO", "EN"). PROHIBIDO equivocarse en escalas numéricas.
   - "thumbnailStatBadge": dato corto único y verificado (máx 11 caracteres, ej. "-30°C REAL", "24 MIL M KM", "1,300 TON", "72 SEG").
   - "thumbnailPromptEn": escena hiperrealista 70mm EN INGLÉS MUY BIEN ILUMINADA (alto contraste, luz dramática clara sobre el sujeto para verse nítido en pantallas de celular con poco brillo, NUNCA siluetas negras oscuras): ${thumbCompositionCue}. SIN texto, SIN letras.

DEVUELVE EXCLUSIVAMENTE UN OBJETO JSON VÁLIDO CON ESTA ESTRUCTURA:
{
  "colorLook": "ocean_noir | jungle_emerald | arctic_steel | coldwar_tungsten | cosmos_gold | vintage_sepia",
  "visualStyleGuideEn": "string",
  "youtubeTitle": "string (<= 58 chars ideal, directo y magnético para todo público)",
  "thumbnailHeadline": "string (2-3 palabras completas en mayúsculas)",
  "thumbnailSubBadge": "string (máx 20 chars)",
  "thumbnailStatBadge": "string (máx 11 chars, único)",
  "thumbnailPromptEn": "string (bien iluminado, alto contraste, sin texto)",
  "primaryMapSpec": {
    "title": "string",
    "from": { "name": "string", "lat": 0, "lon": 0 },
    "to": { "name": "string", "lat": 0, "lon": 0 },
    "distanceLabel": "string",
    "dateLabel": "string"
  },
  "youtubeDescriptionIntro": "string (2 párrafos cortos y atrapantes)",
  "youtubeTags": ["12 tags en español"],
  "pinnedComment": "string (pregunta A vs B para debate en comentarios)",
  "chapters": [
    {
      "chapterNumber": 1,
      "chapterTitle": "string",
      "chapterDate": "string",
      "chapterLocation": "string",
      "narrationEs": "string",
      "scenes": [
        {
          "sceneNumber": 1,
          "visualType": "video_broll | ai_cinema | animated_map | stat_dossier | archival_evidence",
          "visualPromptEn": "string",
          "videoSearchQueries": ["q1", "q2", "q3"],
          "pexelsFallbackQuery": "string",
          "cameraMotion": "zoom_in | zoom_out | pan_left | pan_right",
          "subtitleCue": "string",
          "locationStamp": "string opcional",
          "keyQuoteEs": "string opcional",
          "statOverlay": { "eyebrow": "string", "value": "string", "label": "string", "detail": "string" },
          "mapSpec": { "title": "string", "from": { "name": "string", "lat": 0, "lon": 0 }, "to": { "name": "string", "lat": 0, "lon": 0 }, "distanceLabel": "string", "dateLabel": "string" }
        }
      ]
    }
  ],
  "bridgeShort": {
    "hookTitle": "string (máx 30 chars)",
    "narrationEs": "string (${shortMinW}-${shortMaxW} palabras exactas, loop circular sin despedida)",
    "visualPromptsEn": ["p1", "p2", "p3"],
    "videoSearchQueries": ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10", "q11", "q12", "q13", "q14", "q15"],
    "pexelsFallbackQueries": ["q1", "q2", "q3", "q4"],
    "youtubeTitle": "string (máx 65 chars, incluye #Shorts)",
    "youtubeDescription": "string",
    "pinnedComment": "string (pregunta rápida A vs B para comentarios del Short)",
    "hashtags": ["#Documental", "#HistoriaReal", "#Misterio", "#Curiosidades", "#Shorts"]
  }
}`;

  const raw = await callGeminiJson(prompt);

  if (!Array.isArray(raw?.chapters) || raw.chapters.length === 0) {
    throw new Error('Gemini no devolvió capítulos válidos en el guion.');
  }

  const primaryMapSpec = sanitizeMapSpec(raw.primaryMapSpec);
  let globalScene = 1;
  let mapsAssigned = 0;

  const normalizedChapters = raw.chapters.slice(0, chapterCount).map((ch: any, chIdx: number) => {
    const rawScenes = Array.isArray(ch.scenes) && ch.scenes.length > 0 ? ch.scenes : [];
    const scenes = [];

    for (let s = 0; s < beatsPerChapter; s++) {
      const src = rawScenes[s] || rawScenes[s % Math.max(1, rawScenes.length)] || {};
      let vType: BeatVisualType = VALID_VISUAL_TYPES.includes(src.visualType)
        ? src.visualType
        : s === 0
          ? 'ai_cinema'
          : s === 4
            ? 'stat_dossier'
            : 'video_broll';

      const parsedMap = sanitizeMapSpec(src.mapSpec);
      const parsedStat = sanitizeStatOverlay(src.statOverlay);

      let finalMapSpec = parsedMap;
      if (vType === 'animated_map') {
        if (!finalMapSpec && primaryMapSpec && mapsAssigned < 2) {
          finalMapSpec = primaryMapSpec;
        }
        if (!finalMapSpec) {
          vType = 'video_broll';
        } else {
          mapsAssigned++;
        }
      }

      if (vType === 'stat_dossier' && !parsedStat) {
        vType = 'video_broll';
      }

      const rawQueries: string[] = Array.isArray(src.videoSearchQueries)
        ? src.videoSearchQueries.map((q: any) => String(q).trim()).filter(Boolean)
        : [];
      const fallbackQ = String(src.pexelsFallbackQuery || rawQueries[0] || 'dark storm clouds night').trim();
      const videoSearchQueries = rawQueries.length > 0 ? rawQueries.slice(0, 3) : [fallbackQ];

      const motion: CameraMotion = MOTIONS.includes(src.cameraMotion)
        ? src.cameraMotion
        : MOTIONS[(globalScene - 1) % MOTIONS.length];

      scenes.push({
        sceneNumber: globalScene++,
        visualType: vType,
        visualPromptEn: String(
          src.visualPromptEn ||
            `${topic.visualTheme}, feature-film 70mm cinema photography, high contrast natural dramatic lighting, volumetric atmosphere, fine film grain, no text, no watermark`
        ).trim(),
        videoSearchQueries,
        pexelsFallbackQuery: fallbackQ,
        cameraMotion: motion,
        subtitleCue: String(src.subtitleCue || ch.chapterTitle || '').trim().slice(0, 80),
        locationStamp: src.locationStamp ? String(src.locationStamp).trim().slice(0, 50) : undefined,
        keyQuoteEs: src.keyQuoteEs ? String(src.keyQuoteEs).trim().slice(0, 88) : undefined,
        statOverlay: vType === 'stat_dossier' ? parsedStat : undefined,
        mapSpec: vType === 'animated_map' ? finalMapSpec : undefined,
        weight: 1 / beatsPerChapter,
      });
    }

    if (chIdx === 0 && scenes.length > 0 && scenes[0].visualType === 'video_broll') {
      scenes[0].visualType = 'ai_cinema';
    }

    if (chIdx === 0 && mapsAssigned === 0 && primaryMapSpec && scenes.length >= 4) {
      scenes[3].visualType = 'animated_map';
      scenes[3].mapSpec = primaryMapSpec;
      mapsAssigned++;
    }

    const cleanNarration = String(ch.narrationEs || '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\*\*|\*|##|#/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      chapterNumber: chIdx + 1,
      chapterTitle: String(ch.chapterTitle || `Acto ${chIdx + 1}`).trim(),
      chapterDate: ch.chapterDate ? String(ch.chapterDate).trim().slice(0, 28) : undefined,
      chapterLocation: ch.chapterLocation ? String(ch.chapterLocation).trim().slice(0, 36) : undefined,
      narrationEs: cleanNarration,
      scenes,
    };
  });

  const rawShort = raw.bridgeShort || {};
  const shortPrompts = Array.isArray(rawShort.visualPromptsEn) && rawShort.visualPromptsEn.length >= 2
    ? rawShort.visualPromptsEn.slice(0, 4).map((s: any) => String(s).trim()).filter(Boolean)
    : normalizedChapters[0].scenes.slice(0, 3).map((sc: any) => sc.visualPromptEn);

  const shortVidQueries = Array.isArray(rawShort.videoSearchQueries) && rawShort.videoSearchQueries.length >= 4
    ? rawShort.videoSearchQueries.slice(0, 16).map((s: any) => String(s).trim()).filter(Boolean)
    : normalizedChapters
        .flatMap((c: any) => c.scenes.map((sc: any) => sc.videoSearchQueries[0]))
        .filter(Boolean)
        .slice(0, 16);

  const shortPexels = Array.isArray(rawShort.pexelsFallbackQueries) && rawShort.pexelsFallbackQueries.length >= 3
    ? rawShort.pexelsFallbackQueries.slice(0, 8).map((s: any) => String(s).trim())
    : shortVidQueries.slice(0, 6);

  const shortNarration = enforceShortLoopWordBudget(
    String(rawShort.narrationEs || normalizedChapters[0].narrationEs.slice(0, 420)),
    shortMaxW
  );

  const slug = `${slugify(topic.id)}-${new Date().toISOString().slice(0, 10)}`;
  const colorLook: CinemaColorLook = VALID_COLOR_LOOKS.includes(raw.colorLook)
    ? raw.colorLook
    : topic.mood === 'awe'
      ? 'cosmos_gold'
      : topic.mood === 'tension'
        ? 'coldwar_tungsten'
        : topic.mood === 'mystery'
          ? 'vintage_sepia'
          : 'ocean_noir';

  const cleanYoutubeTitle = sanitizeMobileTitle(raw.youtubeTitle, topic.titleSeed);
  const cleanHeadline = sanitizeThumbnailHeadline(raw.thumbnailHeadline, 'CASO IMPOSIBLE');

  let cleanStatBadge = raw.thumbnailStatBadge
    ? String(raw.thumbnailStatBadge).trim().toUpperCase().slice(0, 14)
    : undefined;
  if (cleanStatBadge && plan?.forbiddenStatBadges?.includes(cleanStatBadge)) {
    cleanStatBadge = undefined;
  }

  return {
    topicId: topic.id,
    slug,
    category: topic.category,
    mood: topic.mood,
    colorLook,
    creativeDna: plan
      ? {
          narrativeArchetype: plan.narrativeArchetype,
          thumbnailArchetype: plan.thumbnailArchetype,
          accentPalette: plan.accentPalette,
          narratorVoice: plan.narratorVoice,
          musicVariant: plan.musicVariant,
          shortCaptionTheme: plan.shortCaptionTheme,
        }
      : undefined,
    visualStyleGuideEn: String(
      raw.visualStyleGuideEn ||
        `${topic.visualTheme}, feature-film 70mm anamorphic cinematography, rich luminous contrast, volumetric depth, fine film grain, ultra sharp, no text, no watermarks`
    ).trim(),
    youtubeTitle: cleanYoutubeTitle,
    thumbnailHeadline: cleanHeadline,
    thumbnailSubBadge: String(raw.thumbnailSubBadge || 'EXPEDIENTE REAL').trim().toUpperCase().slice(0, 22),
    thumbnailStatBadge: cleanStatBadge,
    thumbnailPromptEn: String(raw.thumbnailPromptEn || topic.visualTheme).trim(),
    primaryMapSpec,
    youtubeDescriptionIntro: String(raw.youtubeDescriptionIntro || topic.angle).trim(),
    youtubeTags: Array.isArray(raw.youtubeTags) && raw.youtubeTags.length > 0
      ? raw.youtubeTags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 15)
      : ['documental', 'historia real', 'misterios', 'supervivencia', 'ciencia'],
    pinnedComment: String(raw.pinnedComment || '¿Qué habrías hecho tú en los primeros segundos? Te leemos abajo.').trim(),
    chapters: normalizedChapters,
    bridgeShort: {
      hookTitle: String(rawShort.hookTitle || cleanHeadline).trim().slice(0, 32),
      narrationEs: shortNarration,
      visualPromptsEn: shortPrompts,
      videoSearchQueries: shortVidQueries,
      pexelsFallbackQueries: shortPexels,
      mapSpec: sanitizeMapSpec(rawShort.mapSpec) || primaryMapSpec,
      youtubeTitle: String(rawShort.youtubeTitle || `${cleanYoutubeTitle.slice(0, 56)} #Shorts`).trim().slice(0, 85),
      youtubeDescription: String(
        rawShort.youtubeDescription ||
          `Historia completa en el canal @${CONFIG.CHANNEL_NAME}: "${cleanYoutubeTitle}".`
      ).trim(),
      pinnedComment: String(
        rawShort.pinnedComment ||
          `¿Qué crees que pasó realmente? 👇 Mira el documental completo "${cleanYoutubeTitle}" en el canal @${CONFIG.CHANNEL_NAME}`
      ).trim(),
      hashtags: Array.isArray(rawShort.hashtags) && rawShort.hashtags.length > 0
        ? rawShort.hashtags.slice(0, 5).map((h: any) => String(h).trim())
        : ['#Documental', '#HistoriaReal', '#Supervivencia', '#Misterio', '#Shorts'],
    },
  };
}
