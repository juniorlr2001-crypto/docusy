import { CONFIG } from '../config.js';
import {
  BeatVisualType,
  CameraMotion,
  CinemaColorLook,
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
    // Strip trailing commas before } or ] and control chars inside strings
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
              temperature: 0.72,
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
        console.log(`[ScriptEngine] ✅ Guion + storyboard IMAX generado con ${model} (${text.length} chars).`);
        return parsed;
      } catch (err: any) {
        lastError = `${model}: ${err?.message || err}`;
        console.warn(`[ScriptEngine] ⚠️ ${lastError}`);
      }
    }
  }

  throw new Error(`No se pudo generar el guion con Gemini: ${lastError}`);
}

/**
 * Generates a full 8-10 minute IMAX-paced documentary script & director's storyboard:
 * - Full mode: 6 acts x 10 visual beats = 60 fast cuts (~8-9s/shot) mixing real HD video B-roll,
 *   hero IMAX AI reconstructions, animated tactical maps, classified stat dossiers & archival evidence.
 * - Quick mode: 2 acts x 6 visual beats = 12 fast cuts (~5-6s/shot) + 9:16 Bridge Short.
 */
export async function generateDocumentaryScript(
  topic: DocumentaryTopic,
  options: { quickMode?: boolean } = {}
): Promise<DocumentaryScript> {
  const isQuick = Boolean(options.quickMode);
  const chapterCount = isQuick ? 2 : 6;
  const beatsPerChapter = isQuick ? 6 : 12;
  const wordsPerChapter = isQuick ? '75 a 95' : '215 a 245';
  const totalTargetWords = isQuick
    ? '160 a 190 palabras (~1 min)'
    : '1,320 a 1,460 palabras (8.5 a 9.5 minutos de alta densidad sin relleno)';

  const factsBlock = topic.verifiedFacts
    ? topic.verifiedFacts.slice(0, 4200)
    : 'Usa únicamente hechos históricos y científicos ampliamente verificados y reconocidos. No inventes cifras falsas ni nombres ficticios.';

  const prompt = `Eres guionista jefe y director de fotografía de documentales cinematográficos de alto presupuesto (calidad película de cine IMAX 70mm / National Geographic / Netflix / Lemmino / Fern) en español para YouTube.

TEMA VERIFICADO:
- Título semilla: ${topic.titleSeed}
- Enfoque: ${topic.angle}
- Categoría: ${topic.category}
- Atmósfera visual base: ${topic.visualTheme}

DOSSIER DE HECHOS REALES (Wikipedia):
${factsBlock}

TAREA:
Escribe un guion documental 100% ORIGINAL en español latinoamericano neutro con narrativa tensa, ritmo ágil sin relleno, rigor histórico/científico y un STORYBOARD VISUAL DE ALTA RETENCIÓN (72 planos, cortes cada ~6-7 segundos) con IDENTIDAD VISUAL PROPIA adaptada exactamente al mundo, clima y época de esta historia.

REQUISITOS ESTRICTOS DE NARRACIÓN:
1. Extensión total: ${totalTargetWords}, dividido en exactamente ${chapterCount} capítulos (actos).
2. Cada capítulo DEBE tener ${wordsPerChapter} palabras de narración fluida, visceral y directa al grano (CERO relleno poético repetitivo, sin muletillas, sin listas secas, sin asteriscos, sin markdown ni acotaciones entre paréntesis).
3. Capítulo 1 (COLD OPEN DE MÁXIMA RETENCIÓN): Abre IN MEDIAS RES en el segundo 0.0 con la cifra, paradoja o instante exacto del desastre/hallazgo (ej. la hora exacta, la profundidad exacta, la alerta sonando). En los primeros 20 segundos plantea la pregunta central irresoluble que obliga a quedarse hasta el final. PROHIBIDO saludar ("Hola bienvenidos", "En este video veremos").
4. Cada capítulo (excepto el último) cierra con un giro de guion ("micro-cliffhanger") o dato revelador que conecte con el siguiente acto.
5. Último capítulo: resolución real verificada + dato final escalofriante + pregunta corta y debatible para comentarios.

REQUISITOS ESTRICTOS DEL STORYBOARD VISUAL CINEMATOGRÁFICO (CRÍTICO):
6. Elige el "colorLook" que mejor represente la fotografía natural de ESTA historia específica:
   - "ocean_noir" (mar, tormentas oceánicas, naufragios, faros, abismos submarinos)
   - "jungle_emerald" (selva, Amazonas, cuevas tropicales, expediciones verdes)
   - "arctic_steel" (hielo, Antártida, nieve, montañas heladas, expediciones polares)
   - "coldwar_tungsten" (búnkeres, Guerra Fría, ciencia industrial, accidentes de ingeniería)
   - "cosmos_gold" (espacio, Marte, astronomía, radiación solar, ciencia extrema)
   - "vintage_sepia" (siglos pasados, artefactos antiguos, barcos históricos, archivos clásicos)
7. Cada capítulo DEBE tener exactamente ${beatsPerChapter} planos visuales ("scenes") para lograr ritmo documental moderno de alta retención (cortes cada ~6-7 segundos, JAMÁS imágenes estáticas largas).
8. Distribuye los tipos visuales ("visualType") en cada capítulo de manera variada y dinámica:
   - ~7 a 8 planos "video_broll": metraje real en movimiento HD (tormentas, olas, lluvia, niebla, nieve, selva aérea, radar, noche estrellada, océano, submarino, laboratorio, fuego, acero).
     * "videoSearchQueries": array de exactamente 3 búsquedas cortas EN INGLÉS (2 a 3 palabras simples y concretas, ej. "submarine underwater dark", "suspension bridge wind", "arctic ice ship") para videos stock cinematográficos coherentes con ESTA historia. PROHIBIDO buscar playas soleadas, turistas, oficinas modernas, personas sonriendo o conferencias.
   - ~2 planos "ai_cinema": los 2 momentos heroicos más dramáticos del capítulo.
     * "visualPromptEn": prompt cinematográfico hiperdetallado EN INGLÉS con calidad de largometraje IMAX 70mm, iluminación realista acorde a la época y entorno real de esta historia, lentes anamórficos, profundidad atmosférica, grano fílmico 35mm, SIN texto, SIN letras, SIN watermarks.
   - 1 plano "stat_dossier": cifra, fecha o medición clave verificada del capítulo (ej. "438 DÍAS", "10,935 M", "26 SEP 1983", "$327 MILLONES") con "statOverlay": { "eyebrow", "value", "label", "detail" }.
   - En al menos 2 capítulos incluye 1 plano "animated_map" con coordenadas reales EXACTAS ("mapSpec": { "title", "from": { "name", "lat", "lon" }, "to": { "name", "lat", "lon" } opcional, "distanceLabel", "dateLabel" }).
   - En al menos 2 capítulos incluye 1 plano "archival_evidence" para mostrar fotografía histórica real de archivo (Wikimedia Commons).
9. Etiquetas cinematográficas:
   - "locationStamp": en 1 o 2 planos por capítulo cuando cambie el lugar, la hora o la fecha (ej. "ESTRECHO DE PUGET · 7 NOV 1940 · 11:00 AM").
   - "keyQuoteEs": en 2 planos clímax por capítulo: frase corta demoledora de 3 a 7 palabras.
10. "primaryMapSpec": mapa principal del episodio con coordenadas reales exactas (lat/lon numéricas).
11. "bridgeShort" (DISEÑO VIRAL FASE 2 — LOOP INFINITO DE 34 A 40 SEGUNDOS):
    - "narrationEs": 85 a 102 palabras exactas (34 a 40 segundos).
    - Estructura obligatoria para romper el techo de 1,250 vistas y lograr >100% de retención:
      * Segundos 0-3 (GANCHO ANTI-SWIPE): Arranca con el dato físico o suceso más imposible y directo en la primera frase (PROHIBIDO introducciones lentas).
      * Segundos 3-32 (ESCALADA RÁPIDA): 4 giros cortos de alta tensión con cifras concretas.
      * Segundos 32-38 (LOOP CIRCULAR INFINITO — PROHIBIDO DESPEDIRSE): PROHIBIDO decir "Mira el documental completo en nuestro canal" o "Suscríbete" en la voz narrada (eso hace que la gente deslice antes del final; el aviso visual ya sale en pantalla automáticamente). En su lugar, termina la última oración con el misterio o giro más inquietante redactado de forma que CONECTE GRAMATICALMENTE con la primera frase del segundo 0:00 (efecto bucle/loop infinito).
    - Incluye 12 búsquedas cortas de video vertical EN INGLÉS ("videoSearchQueries") y 3 prompts heroicos verticales ("visualPromptsEn").
12. "thumbnailHeadline": 2 a 3 PALABRAS ULTRA CORTAS EN MAYÚSCULAS (máximo 15 caracteres en total, máximo 8-9 letras por palabra) de máxima intriga específica para ESTE caso (ej. "12 KM ABAJO", "NADIE VOLVIÓ", "SOLA 11 DÍAS", "ERROR FATAL", "0% OXÍGENO", "5 MINUTOS", "HIELO MORTAL"). PROHIBIDO usar textos largos o repetir "¿QUÉ HABÍA ABAJO?".
13. "thumbnailStatBadge": dato corto explosivo obligatorio para esquina de miniatura (máx 11 caracteres, ej. "10,935 M", "AÑO 1900", "-35°C", "3,000 M", "$327M NASA").
14. "thumbnailPromptEn": póster documental 16:9 estilo Netflix / National Geographic IMAX 70mm EN INGLÉS con COMPOSICIÓN REGLA DE TERCIOS: el sujeto principal (estructura colapsando, sumergible en el abismo iluminado, barco atrapado en hielo gigante o protagonista histórico en plano medio de perfil) DEBE estar ubicado limpiamente en el LADO DERECHO del encuadre (tercio derecho), dejando el LADO IZQUIERDO con atmósfera oscura limpia para el texto. Fotografía cinematográfica realista 70mm, iluminación natural dramática, tonos de piel reales (PROHIBIDO aspecto de caricatura o piel naranja neón saturada), SIN texto, SIN letras.

DEVUELVE EXCLUSIVAMENTE UN OBJETO JSON VÁLIDO CON ESTA ESTRUCTURA EXACTA:
{
  "colorLook": "ocean_noir | jungle_emerald | arctic_steel | coldwar_tungsten | cosmos_gold | vintage_sepia",
  "visualStyleGuideEn": "string (guía fotográfica cinematográfica 70mm específica para el entorno, época y paleta de color única de ESTA historia, sin texto ni watermarks)",
  "youtubeTitle": "string (máx 75 chars)",
  "thumbnailHeadline": "string (2-4 palabras mayúsculas)",
  "thumbnailSubBadge": "string (máx 24 chars, ej: EXPEDIENTE REAL)",
  "thumbnailStatBadge": "string (máx 14 chars, ej: 10,800 KM)",
  "thumbnailPromptEn": "string",
  "primaryMapSpec": {
    "title": "string",
    "from": { "name": "string", "lat": 0, "lon": 0 },
    "to": { "name": "string", "lat": 0, "lon": 0 },
    "distanceLabel": "string",
    "dateLabel": "string"
  },
  "youtubeDescriptionIntro": "string (2 párrafos cortos y magnéticos en español)",
  "youtubeTags": ["10 a 14 tags en español"],
  "pinnedComment": "string (pregunta reflexiva abierta, sin URLs)",
  "chapters": [
    {
      "chapterNumber": 1,
      "chapterTitle": "string",
      "chapterDate": "string (ej: 17 NOV 2012)",
      "chapterLocation": "string (ej: CHIAPAS, MÉXICO)",
      "narrationEs": "string (párrafo continuo listo para locución, sin markdown)",
      "scenes": [
        {
          "sceneNumber": 1,
          "visualType": "video_broll | ai_cinema | animated_map | stat_dossier | archival_evidence",
          "visualPromptEn": "string",
          "videoSearchQueries": ["query 1", "query 2", "query 3"],
          "pexelsFallbackQuery": "string",
          "cameraMotion": "zoom_in | zoom_out | pan_left | pan_right",
          "subtitleCue": "string (máx 65 chars)",
          "locationStamp": "string opcional",
          "keyQuoteEs": "string opcional",
          "statOverlay": { "eyebrow": "string", "value": "string", "label": "string", "detail": "string" },
          "mapSpec": { "title": "string", "from": { "name": "string", "lat": 0, "lon": 0 }, "to": { "name": "string", "lat": 0, "lon": 0 }, "distanceLabel": "string", "dateLabel": "string" }
        }
      ]
    }
  ],
  "bridgeShort": {
    "hookTitle": "string (máx 34 chars)",
    "narrationEs": "string (95-120 palabras)",
    "visualPromptsEn": ["prompt 1", "prompt 2", "prompt 3"],
    "videoSearchQueries": ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"],
    "pexelsFallbackQueries": ["q1", "q2", "q3", "q4"],
    "youtubeTitle": "string (máx 80 chars, incluye #Shorts)",
    "youtubeDescription": "string",
    "hashtags": ["#Documental", "#HistoriaReal", "#Misterio", "#Cine", "#Shorts"]
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
        : s === 0 || s === 5
          ? 'ai_cinema'
          : s === 3
            ? 'stat_dossier'
            : 'video_broll';

      const parsedMap = sanitizeMapSpec(src.mapSpec);
      const parsedStat = sanitizeStatOverlay(src.statOverlay);

      // Ensure animated_map has valid coordinates, otherwise fall cleanly to video_broll
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

      // Ensure stat_dossier has a real stat payload
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
            `${topic.visualTheme}, feature-film 70mm cinema photography, natural dramatic lighting, volumetric atmosphere, fine film grain, no text, no watermark`
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

    // Always open Chapter 1 (second 0!) with a bespoke hero AI cinema shot so the hook frame is 100% authentic
    if (chIdx === 0 && scenes.length > 0 && scenes[0].visualType === 'video_broll') {
      scenes[0].visualType = 'ai_cinema';
    }

    // Guarantee at least one tactical animated map in the episode if primaryMapSpec exists
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
      chapterTitle: String(ch.chapterTitle || `Capítulo ${chIdx + 1}`).trim(),
      chapterDate: ch.chapterDate ? String(ch.chapterDate).trim().slice(0, 28) : undefined,
      chapterLocation: ch.chapterLocation ? String(ch.chapterLocation).trim().slice(0, 36) : undefined,
      narrationEs: cleanNarration,
      scenes,
    };
  });

  const totalWords = normalizedChapters
    .map((c: any) => c.narrationEs.split(/\s+/).filter(Boolean).length)
    .reduce((a: number, b: number) => a + b, 0);
  console.log(
    `[ScriptEngine] 🎬 ${normalizedChapters.length} actos, ${globalScene - 1} planos visuales (~8-9s/corte), ${totalWords} palabras (~${(totalWords / 150).toFixed(1)} min).`
  );

  const rawShort = raw.bridgeShort || {};
  const shortPrompts = Array.isArray(rawShort.visualPromptsEn) && rawShort.visualPromptsEn.length >= 2
    ? rawShort.visualPromptsEn.slice(0, 4).map((s: any) => String(s).trim()).filter(Boolean)
    : normalizedChapters[0].scenes.slice(0, 3).map((sc: any) => sc.visualPromptEn);

  const shortVidQueries = Array.isArray(rawShort.videoSearchQueries) && rawShort.videoSearchQueries.length >= 4
    ? rawShort.videoSearchQueries.slice(0, 14).map((s: any) => String(s).trim()).filter(Boolean)
    : normalizedChapters
        .flatMap((c: any) => c.scenes.map((sc: any) => sc.videoSearchQueries[0]))
        .filter(Boolean)
        .slice(0, 14);

  const shortPexels = Array.isArray(rawShort.pexelsFallbackQueries) && rawShort.pexelsFallbackQueries.length >= 3
    ? rawShort.pexelsFallbackQueries.slice(0, 8).map((s: any) => String(s).trim())
    : shortVidQueries.slice(0, 6);

  // Strip any spoken outro commercial ("Mira el documental completo...", "Suscríbete...") so the Short maintains a 100% seamless loop
  const shortNarration = String(rawShort.narrationEs || normalizedChapters[0].narrationEs.slice(0, 520))
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\*\*|\*/g, '')
    .replace(/(?:Si quieres conocer|Para conocer|Mira|Descubre|Encuentra)\s+(?:la historia completa|el documental completo|toda la verdad)[^.!?]*[.!?]?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

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

  return {
    topicId: topic.id,
    slug,
    category: topic.category,
    mood: topic.mood,
    colorLook,
    visualStyleGuideEn: String(
      raw.visualStyleGuideEn ||
        `${topic.visualTheme}, feature-film 70mm anamorphic cinematography, rich authentic lighting, volumetric depth, fine film grain, ultra sharp, no text, no watermarks`
    ).trim(),
    youtubeTitle: String(raw.youtubeTitle || topic.titleSeed).trim().slice(0, 95),
    thumbnailHeadline: String(raw.thumbnailHeadline || 'HISTORIA REAL').trim().toUpperCase().slice(0, 28),
    thumbnailSubBadge: String(raw.thumbnailSubBadge || 'EXPEDIENTE REAL').trim().toUpperCase().slice(0, 26),
    thumbnailStatBadge: raw.thumbnailStatBadge ? String(raw.thumbnailStatBadge).trim().toUpperCase().slice(0, 16) : undefined,
    thumbnailPromptEn: String(raw.thumbnailPromptEn || topic.visualTheme).trim(),
    primaryMapSpec,
    youtubeDescriptionIntro: String(raw.youtubeDescriptionIntro || topic.angle).trim(),
    youtubeTags: Array.isArray(raw.youtubeTags) && raw.youtubeTags.length > 0
      ? raw.youtubeTags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 15)
      : ['documental', 'historia real', 'misterios', 'supervivencia', 'ciencia'],
    pinnedComment: String(raw.pinnedComment || '¿Qué habrías hecho tú en esa situación? Te leemos abajo.').trim(),
    chapters: normalizedChapters,
    bridgeShort: {
      hookTitle: String(rawShort.hookTitle || raw.thumbnailHeadline || 'HISTORIA REAL').trim().slice(0, 38),
      narrationEs: shortNarration,
      visualPromptsEn: shortPrompts,
      videoSearchQueries: shortVidQueries,
      pexelsFallbackQueries: shortPexels,
      mapSpec: sanitizeMapSpec(rawShort.mapSpec) || primaryMapSpec,
      youtubeTitle: String(rawShort.youtubeTitle || `${topic.titleSeed.slice(0, 68)} #Shorts`).trim().slice(0, 95),
      youtubeDescription: String(
        rawShort.youtubeDescription ||
          `Documental completo disponible en nuestro canal ${CONFIG.CHANNEL_NAME}.\n\nNarración asistida con voz IA · Producción documental cinematográfica.`
      ).trim(),
      hashtags: Array.isArray(rawShort.hashtags) && rawShort.hashtags.length > 0
        ? rawShort.hashtags.slice(0, 6).map((h: any) => String(h).trim())
        : ['#Documental', '#HistoriaReal', '#Supervivencia', '#Misterio', '#Shorts'],
    },
  };
}
