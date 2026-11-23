import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { DocumentaryTopic, TopicCategory } from '../types.js';

const HISTORY_FILE = path.join(CONFIG.DATA_DIR, 'published_topics.json');
const DISCOVERED_FILE = path.join(CONFIG.DATA_DIR, 'discovered_topics.json');

export const PILLAR_ORDER: TopicCategory[] = [
  'supervivencia',
  'errores_historicos',
  'misterios',
  'ciencia_extrema',
];

interface TopicHistoryEntry {
  id: string;
  category: TopicCategory;
  wikiTitleEs: string;
  titleSeed: string;
  usedAt: string;
}

interface TopicHistory {
  usedIds: string[];
  usedWikiTitles: string[];
  usedTitles: string[];
  lastCategory?: TopicCategory;
  historyLog: TopicHistoryEntry[];
}

/**
 * Curated bank of high-retention, 100% real, historically documented stories
 * across the 4 pillars (Supervivencia, Errores históricos, Misterios reales, Ciencia extrema).
 * Every topic is fact-grounded via live Wikipedia REST/Action API before scriptwriting.
 * When this bank is exhausted for any pillar, the Infinite Discovery Engine automatically
 * discovers and verifies new real cases on Wikipedia without ever repeating.
 */
export const SEED_TOPICS: DocumentaryTopic[] = [
  // === SUPERVIVENCIA EXTREMA ===
  {
    id: 'alvarenga-438-dias',
    category: 'supervivencia',
    titleSeed: 'El hombre que sobrevivió 438 días a la deriva en el océano Pacífico',
    angle: 'Cómo José Salvador Alvarenga cruzó más de 10,000 kilómetros en una lancha de 7 metros tras una tormenta frente a Chiapas.',
    wikiTitleEs: 'José_Salvador_Alvarenga',
    mood: 'survival',
    visualTheme: 'cinematic ocean storm, tiny fiberglass boat in endless dark Pacific waves, dramatic twilight lighting, hyperrealistic documentary photography',
  },
  {
    id: 'juliane-koepcke-amazonas',
    category: 'supervivencia',
    titleSeed: 'Cayó 3,000 metros desde un avión partido por un rayo y caminó 11 días en el Amazonas',
    angle: 'La historia real del vuelo 508 de LANSA y cómo una adolescente de 17 años aplicó los consejos de su padre para sobrevivir sola en la selva.',
    wikiTitleEs: 'Juliane_Koepcke',
    mood: 'survival',
    visualTheme: 'dense misty Amazon rainforest canopy, dramatic sunbeams piercing storm clouds, cinematic survival documentary film still',
  },
  {
    id: 'endurance-shackleton-antartida',
    category: 'supervivencia',
    titleSeed: 'Atrapados en el hielo de la Antártida sin radio: el rescate imposible del Endurance',
    angle: 'Cómo Ernest Shackleton perdió su barco aplastado por el hielo en 1915 y logró traer de vuelta vivos a los 28 hombres de su tripulación.',
    wikiTitleEs: 'Expedición_Imperial_Transantártica',
    mood: 'survival',
    visualTheme: 'wooden sailing ship crushed in towering Antarctic sea ice, freezing cobalt twilight, dramatic historical documentary cinematography',
  },
  {
    id: 'rescate-cueva-tham-luang',
    category: 'supervivencia',
    titleSeed: 'Atrapados 4 kilómetros bajo tierra y bajo el agua: la operación imposible de Tham Luang',
    angle: 'Los 18 días que mantuvieron en vilo al mundo para rescatar a 12 niños atrapados en una cueva inundada en Tailandia.',
    wikiTitleEs: 'Rescate_de_la_cueva_de_Tham_Luang',
    mood: 'tension',
    visualTheme: 'flooded dark limestone cave tunnel, underwater diving flashlights cutting murky water, dramatic cinematic documentary realism',
  },
  {
    id: 'milagro-de-los-andes-1972',
    category: 'supervivencia',
    titleSeed: '72 días a 4,000 metros bajo cero: cómo sobrevivieron al accidente de los Andes cuando el mundo los dio por muertos',
    angle: 'La travesía extrema de Nando Parrado y Roberto Canessa cruzando la cordillera sin equipo de montaña tras escuchar por radio que habían cancelado su búsqueda.',
    wikiTitleEs: 'Accidente_del_avión_571_de_la_Fuerza_Aérea_Uruguaya',
    mood: 'survival',
    visualTheme: 'frozen high Andes mountain peaks at twilight, crashed fuselage half-buried in deep snow, dramatic windblown blizzard cinema photography',
  },
  {
    id: 'aron-ralston-127-horas',
    category: 'supervivencia',
    titleSeed: 'Atrapado 127 horas en el fondo de un cañón sin que nadie supiera dónde estaba',
    angle: 'Cómo una roca de 360 kilos inmovilizó a Aron Ralston en Bluejohn Canyon y la decisión límite que tomó al quinto día sin agua.',
    wikiTitleEs: 'Aron_Ralston',
    mood: 'survival',
    visualTheme: 'narrow red sandstone slot canyon in Utah, single shaft of sunlight hitting deep shadow, gritty survival documentary cinematography',
  },
  {
    id: 'steven-callahan-76-dias-atlantico',
    category: 'supervivencia',
    titleSeed: '76 días solo en una balsa inflable de 1.8 metros cruzando el Atlántico',
    angle: 'Cómo Steven Callahan sobrevivió a un naufragio nocturno fabricando un destilador solar roto y cazando peces con un arpón improvisado a lo largo de 3,300 kilómetros.',
    wikiTitleEs: 'Steven_Callahan',
    mood: 'survival',
    visualTheme: 'tiny orange inflatable life raft floating in vast dark Atlantic Ocean swell under stormy sky, cinematic IMAX ocean survival frame',
  },
  {
    id: 'harrison-okene-60-horas-bajo-el-mar',
    category: 'supervivencia',
    titleSeed: 'Sobrevivió 60 horas en el fondo del océano dentro de una burbuja de aire de 1 metro',
    angle: 'Cómo el cocinero Harrison Okene quedó atrapado a 30 metros de profundidad en un remolcador volcado en Nigeria hasta que los buzos tocaron su mano en la oscuridad.',
    wikiTitleEs: 'Harrison_Okene',
    mood: 'tension',
    visualTheme: 'submerged dark ship cabin air pocket 30 meters underwater, diver flashlight beam cutting pitch-black ocean water, claustrophobic IMAX tension',
  },

  // === ERRORES HISTÓRICOS DE 1 SEGUNDO ===
  {
    id: 'stanislav-petrov-1983',
    category: 'errores_historicos',
    titleSeed: 'El hombre que desobedeció una alarma nuclear y salvó al mundo en 5 minutos',
    angle: 'La noche del 26 de septiembre de 1983 en que una computadora soviética anunció 5 misiles hacia Moscú y Stanislav Petrov tuvo que decidir solo.',
    wikiTitleEs: 'Stanislav_Petrov',
    mood: 'tension',
    visualTheme: 'Cold War Soviet underground bunker control room 1983, glowing red radar screens, moody tungsten shadows, tense cinematic film still',
  },
  {
    id: 'mars-climate-orbiter-unidades',
    category: 'errores_historicos',
    titleSeed: 'El error matemático de primaria que destruyó una nave de 327 millones en Marte',
    angle: 'Cómo confundir libras-fuerza con newtons hizo que la sonda Mars Climate Orbiter entrara demasiado bajo y se desintegrara en la atmósfera marciana.',
    wikiTitleEs: 'Mars_Climate_Orbiter',
    mood: 'awe',
    visualTheme: 'spacecraft approaching glowing red planet Mars atmosphere, dramatic orbital light, NASA mission control room, photorealistic cinema',
  },
  {
    id: 'puente-tacoma-narrows',
    category: 'errores_historicos',
    titleSeed: 'El día que un puente de acero se retorció como goma y se desplomó por el viento',
    angle: 'Por qué el tercer puente colgante más largo del mundo colapsó apenas 4 meses después de inaugurarse en 1940.',
    wikiTitleEs: 'Puente_de_Tacoma_(1940)',
    mood: 'tension',
    visualTheme: '1940 steel suspension bridge twisting violently over stormy gray river canyon, vintage cinematic documentary film grain',
  },
  {
    id: 'vasa-barco-suecia-1628',
    category: 'errores_historicos',
    titleSeed: 'El barco de guerra más caro de su época que se hundió a los 20 minutos de zarpar',
    angle: 'Cómo el orgullo de un rey y un error de centímetros hundieron al majestuoso galeón Vasa frente a miles de espectadores en Estocolmo.',
    wikiTitleEs: 'Vasa_(barco)',
    mood: 'mystery',
    visualTheme: '17th century ornate wooden war galleon listing in misty Baltic harbor, dramatic golden-hour storm clouds, cinematic realism',
  },
  {
    id: 'vasili-arkhipov-submarino-b59',
    category: 'errores_historicos',
    titleSeed: 'El oficial encerrado en un submarino sin oxígeno que se negó a disparar un torpedo nuclear',
    angle: 'Cómo Vasili Arjípov detuvo por un solo voto el lanzamiento nuclear del submarino soviético B-59 durante la Crisis de los Misiles de Cuba en 1962.',
    wikiTitleEs: 'Vasili_Arjípov',
    mood: 'tension',
    visualTheme: 'claustrophobic 1962 Soviet diesel submarine control room underwater, sweat and red emergency lights, depth charges exploding outside, IMAX film look',
  },
  {
    id: 'gimly-glider-vuelo-143',
    category: 'errores_historicos',
    titleSeed: 'Sin una gota de combustible a 12,000 metros: el error de litros y libras del Planeador de Gimli',
    angle: 'Cómo una confusión al pasar al sistema métrico dejó a un Boeing 767 con ambos motores apagados en pleno vuelo y obligó a aterrizarlo como planeador en una pista de carreras.',
    wikiTitleEs: 'Vuelo_143_de_Air_Canada',
    mood: 'tension',
    visualTheme: 'commercial airliner gliding silently through twilight clouds with engines dark, cockpit instruments flickering, tense aviation documentary realism',
  },
  {
    id: 'ariane-5-vuelo-501-codigo',
    category: 'errores_historicos',
    titleSeed: 'Los 37 segundos que costaron 370 millones: la línea de código que hizo explotar al cohete Ariane 5',
    angle: 'Cómo reutilizar un módulo de software del Ariane 4 provocó un desbordamiento de 64 a 16 bits y autodestruyó el cohete europeo en su vuelo inaugural de 1996.',
    wikiTitleEs: 'Vuelo_501_del_Ariane_5',
    mood: 'tension',
    visualTheme: 'massive European space rocket ascending through tropical clouds in Kourou before sudden fiery telemetry anomaly, mission control screens, IMAX cinema',
  },
  {
    id: 'lago-peigneur-remolino-taladro',
    category: 'errores_historicos',
    titleSeed: 'El día que un taladro perforó por error una mina de sal y se tragó un lago entero en minutos',
    angle: 'Cómo un error de coordenadas de 1980 en Luisiana convirtió un lago de agua dulce en un remolino gigante que succionó 11 barcazas, una plataforma petrolera y hectáreas de bosque.',
    wikiTitleEs: 'Lago_Peigneur',
    mood: 'awe',
    visualTheme: 'giant whirlpool vortex opening in the middle of a calm lake swallowing industrial barges and trees, mist and roaring water, dramatic documentary shot',
  },

  // === MISTERIOS REALES Y ENIGMAS ===
  {
    id: 'faro-islas-flannan',
    category: 'misterios',
    titleSeed: 'El misterio del faro vacío: 3 hombres desaparecieron sin dejar rastro en medio del Atlántico',
    angle: 'Lo que encontraron los rescatistas en diciembre de 1900 al abrir la puerta del faro de las islas Flannan: comida servida, relojes detenidos y nadie adentro.',
    wikiTitleEs: 'Misterio_de_las_islas_Flannan',
    mood: 'mystery',
    visualTheme: 'isolated stone lighthouse on jagged Scottish cliff in roaring Atlantic storm, eerie lantern light in fog, moody cinema photography',
  },
  {
    id: 'mecanismo-anticitera',
    category: 'misterios',
    titleSeed: 'La computadora de bronce de 2,000 años que no debería haber existido',
    angle: 'Cómo unos buzos de esponjas en 1901 rescataron del fondo del mar un engranaje capaz de predecir eclipses con precisión astronómica.',
    wikiTitleEs: 'Mecanismo_de_Anticitera',
    mood: 'mystery',
    visualTheme: 'ancient corroded bronze astronomical gears illuminated by dramatic studio light, deep Mediterranean shipwreck shadows, cinematic macro',
  },
  {
    id: 'senial-wow-1977',
    category: 'misterios',
    titleSeed: 'Los 72 segundos que desconcertaron a la astronomía: el enigma de la Señal Wow',
    angle: 'La noche de agosto de 1977 en Ohio en que un radiotelescopio captó una transmisión del espacio profundo que jamás volvió a repetirse.',
    wikiTitleEs: 'Señal_Wow!',
    mood: 'mystery',
    visualTheme: 'giant radio telescope dish under starry Milky Way night sky, glowing green oscilloscope waveform, mysterious atmospheric cinema',
  },
  {
    id: 'paso-diatlov-1959',
    category: 'misterios',
    titleSeed: 'Qué ocurrió realmente en el Paso Diátlov: el enigma helado de 1959 que la ciencia tardó 62 años en explicar',
    angle: 'Por qué 9 experimentados alpinistas cortaron su tienda desde adentro a 30 grados bajo cero en los montes Urales.',
    wikiTitleEs: 'Incidente_del_paso_Diátlov',
    mood: 'mystery',
    visualTheme: 'remote snowbound Ural mountain slope at twilight, windblown pine trees and lone canvas expedition tent, cinematic mystery documentary',
  },
  {
    id: 'mary-celeste-barco-fantasma',
    category: 'misterios',
    titleSeed: 'El barco encontrado intacto en mitad del Atlántico sin un solo tripulante a bordo',
    angle: 'En diciembre de 1872 el bergantín Mary Celeste apareció navegando solo con 6 meses de comida, las pertenencias intactas y el último registro de bitácora 10 días antes.',
    wikiTitleEs: 'Mary_Celeste',
    mood: 'mystery',
    visualTheme: '19th century wooden brigantine ghost ship drifting silently in foggy Atlantic Ocean at dawn, tattered sails, eerie chiaroscuro cinema lighting',
  },
  {
    id: 'manuscrito-voynich-codigo',
    category: 'misterios',
    titleSeed: 'El libro ilustrado del siglo XV escrito en un idioma que ningún criptógrafo ni supercomputadora ha podido leer',
    angle: 'Fechado con carbono-14 entre 1404 y 1438, el Manuscrito Voynich contiene plantas inexistentes, mapas astronómicos desconcertantes y un alfabeto con leyes lingüísticas reales.',
    wikiTitleEs: 'Manuscrito_Voynich',
    mood: 'mystery',
    visualTheme: 'ancient vellum manuscript open on dark oak table with bizarre botanical illustrations and unknown script, candlelight shadows, macro cinema photography',
  },
  {
    id: 'incidente-vela-1979-doble-destello',
    category: 'misterios',
    titleSeed: 'El doble destello en el océano Índico de 1979 que ningún país admitió jamás',
    angle: 'Cómo el satélite estadounidense Vela 6911 detectó la firma luminosa exacta de una detonación nuclear cerca de las islas del Príncipe Eduardo y el misterio desclasificado que siguió.',
    wikiTitleEs: 'Incidente_Vela',
    mood: 'mystery',
    visualTheme: 'remote stormy Southern Indian Ocean night sky illuminated by eerie double flash over dark waves, Cold War satellite telemetry room, moody cinema',
  },
  {
    id: 'expedicion-franklin-terror-erebus',
    category: 'misterios',
    titleSeed: 'Los dos barcos que desaparecieron con 129 hombres en el Ártico y tardaron 169 años en aparecer bajo el hielo',
    angle: 'Qué revelaron las notas halladas en montículos de piedra y el descubrimiento submarino del HMS Erebus y el HMS Terror sobre el destino de la expedición de Sir John Franklin.',
    wikiTitleEs: 'Expedición_perdida_de_Franklin',
    mood: 'mystery',
    visualTheme: '19th century Royal Navy ships HMS Erebus and Terror frozen in pack ice under haunting Arctic aurora borealis, dark historical cinema',
  },

  // === CIENCIA EXTREMA ===
  {
    id: 'pozo-superprofundo-kola',
    category: 'ciencia_extrema',
    titleSeed: 'Qué encontraron cuando perforaron el agujero más profundo de la Tierra',
    angle: 'Los 12 kilómetros hacia el interior del planeta en la península de Kola: calor extremo, agua imposible y por qué tuvieron que sellarlo.',
    wikiTitleEs: 'Pozo_superprofundo_de_Kola',
    mood: 'awe',
    visualTheme: 'abandoned Soviet Arctic drilling tower in snowy tundra, glowing subterranean geological layers cutaway, dark cinematic sci-doc style',
  },
  {
    id: 'fosa-de-las-marianas',
    category: 'ciencia_extrema',
    titleSeed: 'A 11,000 metros bajo el mar: qué pasa realmente en el punto más profundo del planeta',
    angle: 'Presión capaz de aplastar un submarino como una lata, vida que no necesita luz solar y los pocos humanos que lograron bajar al abismo Challenger.',
    wikiTitleEs: 'Fosa_de_las_Marianas',
    mood: 'awe',
    visualTheme: 'deep ocean abyssal trench, glowing bioluminescent deep-sea creatures, tiny yellow research submersible beam in pitch-black water',
  },
  {
    id: 'voyager-1-disco-oro',
    category: 'ciencia_extrema',
    titleSeed: 'La máquina humana a 24,000 millones de kilómetros que todavía nos habla desde el espacio interestelar',
    angle: 'Cómo una sonda lanzada en 1977 con menos memoria que un llavero sigue enviando señales tras salir del sistema solar.',
    wikiTitleEs: 'Voyager_1',
    mood: 'awe',
    visualTheme: 'golden Voyager spacecraft drifting through deep interstellar nebula, distant pale blue dot Earth, breathtaking cinematic space documentary',
  },
  {
    id: 'tormenta-solar-carrington-1859',
    category: 'ciencia_extrema',
    titleSeed: 'El día que el cielo ardió en todo el planeta: qué pasaría si el Evento Carrington ocurriera hoy',
    angle: 'En 1859 una tormenta solar encendió cables de telégrafo y llenó el cielo de auroras hasta el Caribe; así golpearía nuestra red eléctrica moderna.',
    wikiTitleEs: 'Tormenta_solar_de_1859',
    mood: 'tension',
    visualTheme: 'massive coronal mass ejection erupting from blazing sun toward Earth, glowing crimson aurora over darkened modern city skyline',
  },
  {
    id: 'cueva-movile-aislada-5-millones-anios',
    category: 'ciencia_extrema',
    titleSeed: 'La cueva sellada durante 5.5 millones de años con una atmósfera tóxica y criaturas que jamás vieron el sol',
    angle: 'Descubierta por accidente en Rumania en 1986, la cueva de Movile alberga un ecosistema subterráneo completo basado en quimiosíntesis de azufre y metano en lugar de fotosíntesis.',
    wikiTitleEs: 'Cueva_de_Movile',
    mood: 'awe',
    visualTheme: 'sealed subterranean sulfur cave lake in Romania, científicos in breathing apparatus descending narrow shaft, eerie bioluminescent mist, IMAX sci-doc',
  },
  {
    id: 'reactor-nuclear-natural-oklo',
    category: 'ciencia_extrema',
    titleSeed: 'El reactor nuclear que funcionó solo bajo tierra hace 2,000 millones de años antes de que existiera el ser humano',
    angle: 'Cómo unos físicos franceses descubrieron en 1972 que una mina de uranio en Gabón había mantenido reacciones de fisión nuclear autorreguladas por agua subterránea durante cientos de miles de años.',
    wikiTitleEs: 'Reactor_nuclear_natural_de_Oklo',
    mood: 'awe',
    visualTheme: 'deep subterranean uranium ore seam glowing subtly with Cherenkov blue shimmer in groundwater fissures, ancient prehistoric Earth geology cinema',
  },
  {
    id: 'cueva-de-los-cristales-naica',
    category: 'ciencia_extrema',
    titleSeed: 'A 300 metros bajo tierra a 58 grados: la cámara subterránea donde el cuerpo humano solo resiste 10 minutos',
    angle: 'La Cueva de los Cristales de Naica en México, con columnas de selenita de 11 metros y 55 toneladas formadas en agua termal donde la humedad del 99% hace que el aire queme los pulmones.',
    wikiTitleEs: 'Mina_de_Naica',
    mood: 'awe',
    visualTheme: 'colossal translucent selenite crystal beams dwarfing tiny explorer in orange cooling suit with respirator, subterranean steam, breathtaking IMAX frame',
  },
  {
    id: 'evento-tunguska-1908-siberia',
    category: 'ciencia_extrema',
    titleSeed: 'La explosión sin cráter que arrasó 80 millones de árboles en Siberia con la fuerza de 185 bombas de Hiroshima',
    angle: 'Qué ocurrió la mañana del 30 de junio de 1908 sobre el río Podkámennaya Tunguska cuando una bola de fuego detonó en el aire e iluminó las noches de Londres a miles de kilómetros.',
    wikiTitleEs: 'Evento_de_Tunguska',
    mood: 'awe',
    visualTheme: 'blinding atmospheric airburst shockwave flattening endless Siberian taiga forest in radial pattern, fiery sky and seismic dust cloud, IMAX cinema',
  },
];

function normalizeKey(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function slugifyId(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52);
}

export function loadDiscoveredTopics(): DocumentaryTopic[] {
  try {
    if (fs.existsSync(DISCOVERED_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DISCOVERED_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        return parsed.filter(t => t && typeof t.id === 'string' && typeof t.titleSeed === 'string');
      }
    }
  } catch {
    // ignore corrupted file
  }
  return [];
}

function saveDiscoveredTopics(topics: DocumentaryTopic[]): void {
  fs.writeFileSync(DISCOVERED_FILE, JSON.stringify(topics, null, 2), 'utf-8');
}

export function getAllKnownTopics(): DocumentaryTopic[] {
  const discovered = loadDiscoveredTopics();
  const seenIds = new Set(SEED_TOPICS.map(t => t.id));
  const seenWiki = new Set(SEED_TOPICS.map(t => normalizeKey(t.wikiTitleEs)));
  const merged = [...SEED_TOPICS];

  for (const d of discovered) {
    if (!seenIds.has(d.id) && !seenWiki.has(normalizeKey(d.wikiTitleEs))) {
      merged.push(d);
      seenIds.add(d.id);
      seenWiki.add(normalizeKey(d.wikiTitleEs));
    }
  }
  return merged;
}

export function loadHistory(): TopicHistory {
  const allTopics = getAllKnownTopics();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      const usedIds: string[] = Array.isArray(parsed.usedIds) ? parsed.usedIds : [];
      const usedWikiSet = new Set<string>(
        Array.isArray(parsed.usedWikiTitles) ? parsed.usedWikiTitles.map(normalizeKey) : []
      );
      const usedTitlesSet = new Set<string>(
        Array.isArray(parsed.usedTitles) ? parsed.usedTitles.map(normalizeKey) : []
      );
      const historyLog: TopicHistoryEntry[] = Array.isArray(parsed.historyLog) ? parsed.historyLog : [];
      const loggedIds = new Set(historyLog.map(e => e.id));

      // Backfill wikiTitleEs, titleSeed, and historyLog for episodes generated before this upgrade
      for (const id of usedIds) {
        const known = allTopics.find(t => t.id === id);
        if (known) {
          usedWikiSet.add(normalizeKey(known.wikiTitleEs));
          usedTitlesSet.add(normalizeKey(known.titleSeed));
          if (!loggedIds.has(id)) {
            historyLog.push({
              id: known.id,
              category: known.category,
              wikiTitleEs: known.wikiTitleEs,
              titleSeed: known.titleSeed,
              usedAt: 'backfilled',
            });
            loggedIds.add(id);
          }
        }
      }

      return {
        usedIds,
        usedWikiTitles: Array.from(usedWikiSet).filter(Boolean),
        usedTitles: Array.from(usedTitlesSet).filter(Boolean),
        lastCategory: parsed.lastCategory,
        historyLog,
      };
    }
  } catch {
    // start fresh
  }
  return {
    usedIds: [],
    usedWikiTitles: [],
    usedTitles: [],
    historyLog: [],
  };
}

export function isTopicAlreadyUsed(topic: DocumentaryTopic, history = loadHistory()): boolean {
  if (history.usedIds.includes(topic.id)) return true;
  const wikiKey = normalizeKey(topic.wikiTitleEs);
  if (wikiKey && history.usedWikiTitles.includes(wikiKey)) return true;
  const titleKey = normalizeKey(topic.titleSeed);
  if (titleKey && history.usedTitles.includes(titleKey)) return true;
  return false;
}

export function markTopicUsed(topic: DocumentaryTopic): void {
  const history = loadHistory();
  if (!history.usedIds.includes(topic.id)) {
    history.usedIds.push(topic.id);
  }
  const wikiKey = normalizeKey(topic.wikiTitleEs);
  if (wikiKey && !history.usedWikiTitles.includes(wikiKey)) {
    history.usedWikiTitles.push(wikiKey);
  }
  const titleKey = normalizeKey(topic.titleSeed);
  if (titleKey && !history.usedTitles.includes(titleKey)) {
    history.usedTitles.push(titleKey);
  }
  history.lastCategory = topic.category;
  if (!history.historyLog.some(e => e.id === topic.id)) {
    history.historyLog.push({
      id: topic.id,
      category: topic.category,
      wikiTitleEs: topic.wikiTitleEs,
      titleSeed: topic.titleSeed,
      usedAt: new Date().toISOString(),
    });
  }
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
}

/**
 * Picks the next documentary pillar in a balanced 4-pillar cycle:
 * supervivencia -> errores_historicos -> misterios -> ciencia_extrema
 * Always avoids repeating `lastCategory` back-to-back and prioritizes pillars with fewer published episodes.
 */
function pickBalancedNextCategory(history: TopicHistory): TopicCategory {
  const counts: Record<TopicCategory, number> = {
    supervivencia: 0,
    errores_historicos: 0,
    misterios: 0,
    ciencia_extrema: 0,
  };

  for (const entry of history.historyLog) {
    if (entry.category in counts) {
      counts[entry.category]++;
    }
  }

  const lastIdx = history.lastCategory ? PILLAR_ORDER.indexOf(history.lastCategory) : -1;
  const cycleOrder: TopicCategory[] = [];
  for (let i = 1; i <= PILLAR_ORDER.length; i++) {
    const candidate = PILLAR_ORDER[(lastIdx + i + PILLAR_ORDER.length) % PILLAR_ORDER.length];
    if (candidate !== history.lastCategory) {
      cycleOrder.push(candidate);
    }
  }

  // Pick the pillar in cycleOrder with the lowest total published count
  let best = cycleOrder[0] || 'supervivencia';
  let bestCount = counts[best];
  for (const cat of cycleOrder) {
    if (counts[cat] < bestCount) {
      best = cat;
      bestCount = counts[cat];
    }
  }
  return best;
}

/**
 * Searches Spanish Wikipedia to resolve the best canonical article title when a direct title doesn't match.
 */
async function resolveCanonicalWikiTitleEs(query: string): Promise<string | null> {
  if (!query || !query.trim()) return null;
  try {
    const headers = { 'User-Agent': 'DocuViralEngine/2.0 (educational documentary research)' };
    const searchUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query.replace(/_/g, ' ').trim()
    )}&srlimit=3&format=json`;
    const res = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (!res || !res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const firstHit = data?.query?.search?.[0]?.title;
    return firstHit ? String(firstHit).trim().replace(/\s+/g, '_') : null;
  } catch {
    return null;
  }
}

/**
 * Fetches verified encyclopedic context from Wikipedia REST + Action API
 * so the scriptwriter works from 100% factual dates, names, and figures.
 * Automatically falls back to Wikipedia Search if the initial title is redirected or imprecise.
 */
export async function fetchWikipediaFacts(
  wikiTitleEs: string,
  fallbackSearchQuery?: string
): Promise<{ facts: string; resolvedWikiTitleEs: string }> {
  const tryFetchTitle = async (rawTitle: string): Promise<{ text: string; canonicalTitle: string }> => {
    if (!rawTitle) return { text: '', canonicalTitle: rawTitle };
    const cleanTitle = rawTitle.trim().replace(/\s+/g, '_');
    const summaryUrl = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTitle)}?redirect=true`;
    const extractUrl = `https://es.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=false&explaintext=true&exchars=4500&titles=${encodeURIComponent(
      cleanTitle
    )}&format=json&redirects=1`;

    const headers = { 'User-Agent': 'DocuViralEngine/2.0 (educational documentary research)' };
    const [sumRes, extRes] = await Promise.all([
      fetch(summaryUrl, { headers, signal: AbortSignal.timeout(8_000) }).catch(() => null),
      fetch(extractUrl, { headers, signal: AbortSignal.timeout(8_000) }).catch(() => null),
    ]);

    const parts: string[] = [];
    let canonical = cleanTitle;

    if (sumRes && sumRes.ok) {
      const sumJson: any = await sumRes.json().catch(() => null);
      if (sumJson?.title) {
        canonical = String(sumJson.title).trim().replace(/\s+/g, '_');
      }
      if (sumJson?.extract) {
        parts.push(`RESUMEN VERIFICADO (${canonical.replace(/_/g, ' ')}): ${sumJson.extract}`);
      }
    }
    if (extRes && extRes.ok) {
      const extJson: any = await extRes.json().catch(() => null);
      const pages = extJson?.query?.pages || {};
      const firstPage: any = Object.values(pages)[0];
      if (firstPage && !firstPage.missing && firstPage.extract) {
        if (firstPage.title) {
          canonical = String(firstPage.title).trim().replace(/\s+/g, '_');
        }
        parts.push(`DETALLES DOCUMENTADOS:\n${String(firstPage.extract).slice(0, 4000)}`);
      }
    }

    return { text: parts.join('\n\n'), canonicalTitle: canonical };
  };

  try {
    let attempt = await tryFetchTitle(wikiTitleEs);
    if (attempt.text.length >= 350) {
      return { facts: attempt.text, resolvedWikiTitleEs: attempt.canonicalTitle };
    }

    // Fallback: search Spanish Wikipedia by wikiTitleEs or fallbackSearchQuery
    for (const q of [wikiTitleEs, fallbackSearchQuery || ''].filter(Boolean)) {
      const resolved = await resolveCanonicalWikiTitleEs(q);
      if (resolved) {
        attempt = await tryFetchTitle(resolved);
        if (attempt.text.length >= 300) {
          return { facts: attempt.text, resolvedWikiTitleEs: attempt.canonicalTitle };
        }
      }
    }

    return { facts: attempt.text, resolvedWikiTitleEs: attempt.canonicalTitle || wikiTitleEs };
  } catch {
    return { facts: '', resolvedWikiTitleEs: wikiTitleEs };
  }
}

/**
 * Infinite Topic Discovery Engine:
 * When the local seed bank for a category runs out (or when --discover is passed),
 * asks Gemini for 5 new real, historically/scientifically documented cases not in our history,
 * validates each candidate live against Spanish Wikipedia (>350 chars of verified context),
 * and permanently caches verified topics into `data/discovered_topics.json`.
 */
async function discoverNewVerifiedTopicsForCategory(
  category: TopicCategory,
  history: TopicHistory
): Promise<DocumentaryTopic[]> {
  if (!CONFIG.GEMINI_API_KEY) {
    return [];
  }

  const allKnown = getAllKnownTopics();
  const forbiddenWiki = Array.from(
    new Set([
      ...history.usedWikiTitles,
      ...allKnown.map(t => normalizeKey(t.wikiTitleEs)),
    ])
  ).join(', ');
  const forbiddenIds = Array.from(
    new Set([...history.usedIds, ...allKnown.map(t => t.id)])
  ).join(', ');

  const categoryDescriptions: Record<TopicCategory, string> = {
    supervivencia:
      'Supervivencia humana extrema real y documentada (naufragios, accidentes aéreos, cuevas, expediciones polares, desiertos, rescates imposibles).',
    errores_historicos:
      'Errores humanos, matemáticos, de ingeniería o decisiones críticas de 1 segundo reales y documentadas (crisis nucleares evitadas, sondas espaciales, colapsos de ingeniería, aviación).',
    misterios:
      'Misterios históricos, arqueológicos, marítimos o astronómicos 100% reales y documentados en enciclopedias (barcos fantasma reales, artefactos antiguos, señales espaciales, expediciones desaparecidas).',
    ciencia_extrema:
      'Lugares, fenómenos naturales, experimentos o misiones científicas extremas reales en la Tierra o el espacio (abismos, cuevas extremas, sondas interestelares, eventos astronómicos o geológicos).',
  };

  const prompt = `Eres el director de investigación de un canal de documentales estilo IMAX ("Archivos Ocultos").
Necesito descubrir 5 NUEVOS casos 100% REALES, históricamente documentados y con artículo propio en Wikipedia en español para la categoría: "${category}" (${categoryDescriptions[category]}).

PROHIBIDO REPETIR cualquiera de estos casos o artículos ya usados o conocidos:
- IDs existentes: ${forbiddenIds}
- Artículos Wikipedia excluidos: ${forbiddenWiki}

REGLAS ESTRICTAS:
1. Cada caso DEBE ser un hecho real verificable en Wikipedia en español (nada de leyendas urbanas falsas, teorías conspirativas ni ficción).
2. "wikiTitleEs" debe ser el título exacto del artículo en es.wikipedia.org con guiones bajos (ej. "Desastre_de_Bhopal", "Vuelo_232_de_United_Airlines", "Lago_Nyos").
3. "titleSeed" debe ser un título documental magnético en español (alto CTR, sin mayúsculas gritonas ni clickbait falso).
4. "visualTheme" debe estar en inglés describiendo la atmósfera cinematográfica IMAX 70mm.

Devuelve ÚNICAMENTE un JSON válido con este esquema exacto:
{
  "candidates": [
    {
      "id": "slug-corto-unico",
      "category": "${category}",
      "titleSeed": "Título documental magnético en español",
      "angle": "Resumen de 1 oración con fechas, cifras y protagonistas reales.",
      "wikiTitleEs": "Titulo_Exacto_En_Wikipedia",
      "mood": "survival | tension | mystery | awe",
      "visualTheme": "dramatic IMAX 70mm documentary cinematography description in English"
    }
  ]
}`;

  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  let rawCandidates: any[] = [];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        CONFIG.GEMINI_API_KEY
      )}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) continue;
      const data: any = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed?.candidates) && parsed.candidates.length > 0) {
          rawCandidates = parsed.candidates;
          break;
        }
      }
    } catch {
      // try next model
    }
  }

  if (rawCandidates.length === 0) {
    return [];
  }

  const discoveredBank = loadDiscoveredTopics();
  const knownIds = new Set(allKnown.map(t => t.id));
  const knownWiki = new Set(allKnown.map(t => normalizeKey(t.wikiTitleEs)));
  const validMoods = new Set(['survival', 'tension', 'mystery', 'awe']);
  const verifiedNew: DocumentaryTopic[] = [];

  for (const raw of rawCandidates) {
    if (!raw || !raw.titleSeed || !raw.wikiTitleEs) continue;

    const wikiLookup = await fetchWikipediaFacts(String(raw.wikiTitleEs), String(raw.titleSeed));
    if (wikiLookup.facts.length < 350) {
      continue;
    }

    const canonicalWiki = wikiLookup.resolvedWikiTitleEs;
    const wikiKey = normalizeKey(canonicalWiki);
    const id = slugifyId(String(raw.id || canonicalWiki));

    if (!id || knownIds.has(id) || knownWiki.has(wikiKey)) continue;

    const topic: DocumentaryTopic = {
      id,
      category,
      titleSeed: String(raw.titleSeed).trim(),
      angle: String(raw.angle || raw.titleSeed).trim(),
      wikiTitleEs: canonicalWiki,
      mood: validMoods.has(raw.mood) ? raw.mood : category === 'supervivencia' ? 'survival' : 'mystery',
      visualTheme:
        String(raw.visualTheme || '').trim() ||
        'cinematic IMAX 70mm documentary photography, moody dramatic chiaroscuro lighting, photorealistic film still',
      verifiedFacts: wikiLookup.facts,
    };

    if (isTopicAlreadyUsed(topic, history)) continue;

    knownIds.add(topic.id);
    knownWiki.add(wikiKey);
    discoveredBank.push({ ...topic, verifiedFacts: undefined });
    verifiedNew.push(topic);
  }

  if (verifiedNew.length > 0) {
    saveDiscoveredTopics(discoveredBank);
    console.log(
      `[TopicRadar] 🛰️ Descubiertos y verificados en Wikipedia ${verifiedNew.length} nuevos casos reales para [${category}].`
    );
  }

  return verifiedNew;
}

export async function selectNextDocumentaryTopic(
  options: {
    category?: TopicCategory;
    customTopic?: string;
    topicId?: string;
    forceDiscover?: boolean;
  } = {}
): Promise<DocumentaryTopic> {
  if (options.customTopic && options.customTopic.trim()) {
    const raw = options.customTopic.trim();
    const slugId = slugifyId(raw);
    const wikiLookup = await fetchWikipediaFacts(raw, raw);
    const custom: DocumentaryTopic = {
      id: slugId || `custom-${Date.now()}`,
      category: options.category || 'misterios',
      titleSeed: raw,
      angle: `Mini-documental narrativo profundo y verificado sobre: ${raw}`,
      wikiTitleEs: wikiLookup.resolvedWikiTitleEs || raw,
      mood: 'mystery',
      visualTheme:
        'cinematic documentary photography, dramatic chiaroscuro lighting, hyperrealistic film still, ultra detailed',
      verifiedFacts: wikiLookup.facts,
    };
    return custom;
  }

  const allKnown = getAllKnownTopics();

  if (options.topicId) {
    const exact = allKnown.find(t => t.id === options.topicId);
    if (exact) {
      const copy = { ...exact };
      const wikiLookup = await fetchWikipediaFacts(copy.wikiTitleEs, copy.titleSeed);
      copy.verifiedFacts = wikiLookup.facts;
      copy.wikiTitleEs = wikiLookup.resolvedWikiTitleEs || copy.wikiTitleEs;
      return copy;
    }
  }

  const history = loadHistory();
  const targetCategory = options.category || pickBalancedNextCategory(history);

  let unusedForTarget = allKnown.filter(
    t => t.category === targetCategory && !isTopicAlreadyUsed(t, history)
  );

  // If the target category is exhausted (or --discover was requested), auto-discover new verified topics on Wikipedia
  if (unusedForTarget.length === 0 || options.forceDiscover) {
    console.log(
      `[TopicRadar] 🛰️ Buscando nuevos casos reales en Wikipedia para el pilar [${targetCategory}]...`
    );
    const discovered = await discoverNewVerifiedTopicsForCategory(targetCategory, history);
    if (discovered.length > 0) {
      unusedForTarget = options.forceDiscover ? discovered : [...unusedForTarget, ...discovered];
    }
  }

  // Fallback across other unused categories if offline or Gemini discovery wasn't reachable
  if (unusedForTarget.length === 0) {
    const anyUnused = getAllKnownTopics().filter(t => !isTopicAlreadyUsed(t, history));
    if (anyUnused.length > 0) {
      unusedForTarget = anyUnused;
    } else {
      // Try auto-discovering across any pillar before ever repeating
      for (const pillar of PILLAR_ORDER) {
        const discovered = await discoverNewVerifiedTopicsForCategory(pillar, history);
        if (discovered.length > 0) {
          unusedForTarget = discovered;
          break;
        }
      }
    }
  }

  if (unusedForTarget.length === 0) {
    throw new Error(
      'Todos los temas locales han sido publicados y no se pudo conectar con Gemini/Wikipedia para descubrir nuevos casos sin repetir.'
    );
  }

  const chosen = { ...unusedForTarget[0] };
  console.log(
    `[TopicRadar] 📚 Investigando hechos verificados en Wikipedia para [${chosen.category}]: "${chosen.titleSeed}"...`
  );
  if (!chosen.verifiedFacts) {
    const wikiLookup = await fetchWikipediaFacts(chosen.wikiTitleEs, chosen.titleSeed);
    chosen.verifiedFacts = wikiLookup.facts;
    chosen.wikiTitleEs = wikiLookup.resolvedWikiTitleEs || chosen.wikiTitleEs;
  }
  console.log(
    `[TopicRadar] ✅ Cargados ${chosen.verifiedFacts.length} caracteres de contexto histórico verificado (${chosen.wikiTitleEs}).`
  );
  return chosen;
}
