import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { CuratedBeatAsset, DocumentaryScript, EpisodeResult, MediaTelemetry, TopicCategory } from './types.js';
import {
  getAllKnownTopics,
  isTopicAlreadyUsed,
  loadHistory,
  markTopicUsed,
  selectNextDocumentaryTopic,
} from './services/topicRadar.js';
import { generateDocumentaryScript } from './services/scriptEngine.js';
import { generateNarrationAudio } from './services/narratorTts.js';
import { EpisodeMediaCurator } from './services/mediaCurator.js';
import { generateDocumentaryThumbnail, generateShortThumbnail } from './services/thumbnailGenerator.js';
import { ensureCinemaSfxPack, ensureDocumentaryMusicBed } from './services/ambientMusic.js';
import { assembleBridgeShortVideo, assembleDocumentaryVideo } from './services/docuAssembler.js';
import { auditDocumentaryCompliance } from './services/complianceGuard.js';
import { uploadEpisodeBundleToYouTube } from './services/youtubeUploader.js';

function parseArg(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const found = process.argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

function computeMediaTelemetry(
  assets: CuratedBeatAsset[],
  durationSec: number
): MediaTelemetry {
  let videoBrollCount = 0;
  let aiCinemaCount = 0;
  let animatedMapCount = 0;
  let statDossierCount = 0;
  let archivalCount = 0;
  let fallbackPhotoCount = 0;

  for (const a of assets) {
    if (a.mediaKind === 'animated_map') {
      animatedMapCount++;
    } else if (a.mediaKind === 'stat_dossier') {
      statDossierCount++;
    } else if (a.mediaKind === 'video') {
      videoBrollCount++;
    } else if (a.provider.includes('wikimedia') || a.provider === 'cache-archival') {
      archivalCount++;
    } else if (a.provider.includes('cloudflare') || a.provider.includes('fal') || a.provider === 'cache-ai') {
      aiCinemaCount++;
    } else {
      fallbackPhotoCount++;
    }
  }

  const totalBeats = Math.max(1, assets.length);
  return {
    totalBeats,
    videoBrollCount,
    aiCinemaCount,
    animatedMapCount,
    statDossierCount,
    archivalCount,
    fallbackPhotoCount,
    avgSecPerBeat: Number((durationSec / totalBeats).toFixed(2)),
    resolution: '1920x1080@24fps',
  };
}

async function runEpisodeGenerator(): Promise<EpisodeResult> {
  const quickMode = process.argv.includes('--quick');
  const markUsed = !process.argv.includes('--no-history');
  const category = parseArg('category') as TopicCategory | undefined;
  const topicId = parseArg('topic-id');
  const customTopic = parseArg('topic');

  console.log('\n====================================================================');
  console.log(
    `🎬 DOCU-VIRAL ENGINE v2 — CINEMA PRODUCTION EDITION (${quickMode ? 'PRUEBA RÁPIDA' : 'DOCUMENTAL 1080p + SHORT'})`
  );
  console.log('====================================================================\n');

  // 1. Select verified documentary topic & load Wikipedia facts
  const forceDiscover = process.argv.includes('--discover');
  const topic = await selectNextDocumentaryTopic({ category, topicId, customTopic, forceDiscover });
  console.log(`[Pipeline] 📌 Tema seleccionado: "${topic.titleSeed}" (${topic.category})`);

  // 2. Write complete IMAX documentary script + 60-beat visual storyboard + Bridge Short plan
  const episodeSlug = `${topic.id}-${new Date().toISOString().slice(0, 10)}${quickMode ? '-quick' : ''}`;
  const outDir = path.join(CONFIG.OUTPUT_DIR, episodeSlug);
  const workDir = path.join(outDir, 'work');
  fs.mkdirSync(workDir, { recursive: true });

  const scriptPath = path.join(outDir, 'script.json');
  let script: DocumentaryScript;
  if (fs.existsSync(scriptPath) && !process.argv.includes('--fresh')) {
    console.log(`[Pipeline] ♻️ Reutilizando guion guardado: ${scriptPath}`);
    script = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));
  } else {
    script = await generateDocumentaryScript(topic, { quickMode });
    script.slug = episodeSlug;
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf-8');
  }

  // 3. Prepare Hans-Zimmer-inspired tension score + cinema SFX pack (BRAAAM, Whoosh, Riser)
  const [musicPath, sfx] = await Promise.all([
    ensureDocumentaryMusicBed(script.mood),
    ensureCinemaSfxPack(),
  ]);

  // 4. Generate chapter voiceovers sequentially (Gemini 2.5 Native Audio Fenrir/Charon)
  const chapterAudios: Array<{ chapterNumber: number; audioPath: string; durationSec: number }> = [];
  const narratorVoice = script.mood === 'mystery' ? 'Charon' : 'Fenrir';

  for (const ch of script.chapters) {
    const audioOut = await generateNarrationAudio({
      text: ch.narrationEs,
      outputBasePath: path.join(workDir, 'audio', `chapter_${String(ch.chapterNumber).padStart(2, '0')}`),
      mood: script.mood,
      style: 'documentary',
      voiceName: narratorVoice,
    });
    chapterAudios.push({
      chapterNumber: ch.chapterNumber,
      audioPath: audioOut.audioPath,
      durationSec: audioOut.durationSec,
    });
  }

  // Narrate the vertical Bridge Short
  const shortAudio = await generateNarrationAudio({
    text: script.bridgeShort.narrationEs,
    outputBasePath: path.join(workDir, 'audio', 'bridge_short'),
    mood: script.mood,
    style: 'short',
    voiceName: narratorVoice,
  });

  // 5. Curate all cinema visual beats (Real 1080p HD Video + Hero IMAX AI + Animated Maps + Dossiers + Wikimedia Archival)
  const curator = new EpisodeMediaCurator();
  await curator.preloadArchivalMedia(topic);

  const allScenes = script.chapters.flatMap(c => c.scenes);
  const beatAssets = new Map<number, CuratedBeatAsset>();

  console.log(`[Pipeline] 🎥 Curando ${allScenes.length} planos visuales 1080p (videos HD + IA IMAX + mapas + fichas)...`);
  for (const sc of allScenes) {
    const curated = await curator.curateDocumentaryBeat({ scene: sc, script, workDir });
    beatAssets.set(sc.sceneNumber, curated);
  }

  // Curate fast-paced vertical 9:16 assets for Bridge Short
  console.log('[Pipeline] 📱 Curando planos verticales 1080x1920 para el Short puente...');
  const shortAssets = await curator.curateBridgeShortAssets({ script, workDir });

  // 6. Generate High-CTR IMAX Movie-Poster 1280x720 YouTube Thumbnail
  const allCuratedArr = Array.from(beatAssets.values());
  const firstVideoBeat = allCuratedArr.find(a => a.mediaKind === 'video' && a.filePath);
  const firstAiBeat = allCuratedArr.find(
    a => a.mediaKind === 'image' && a.filePath && !a.provider.includes('procedural')
  );
  const thumbnailPath = path.join(outDir, 'thumbnail_16x9.jpg');
  await generateDocumentaryThumbnail(script, workDir, thumbnailPath, {
    curator,
    fallbackVideoPath: firstVideoBeat?.filePath,
    fallbackImagePath: firstAiBeat?.filePath,
  });
  const shortThumbnailPath = path.join(outDir, 'thumbnail_short_9x16.jpg');
  await generateShortThumbnail(script, workDir, shortThumbnailPath, {
    fallbackImagePath: shortAssets.find(a => a.mediaKind === 'image' && a.filePath)?.filePath,
  });

  // 7. Assemble Full HD 1920x1080 @ 24fps IMAX Documentary + Synced .SRT Subtitles
  const documentaryPath = path.join(outDir, 'documentary_16x9.mp4');
  const captionsPath = path.join(outDir, 'captions.srt');
  const assembled = await assembleDocumentaryVideo({
    script,
    chapterAudios,
    beatAssets,
    musicPath,
    sfx,
    workDir,
    outputVideoPath: documentaryPath,
    outputSrtPath: captionsPath,
  });

  // 8. Assemble Full HD 1080x1920 @ 30fps Bridge Short
  const shortPath = path.join(outDir, 'short_9x16.mp4');
  const assembledShort = await assembleBridgeShortVideo({
    script,
    shortAudioPath: shortAudio.audioPath,
    shortDurationSec: shortAudio.durationSec,
    shortAssets,
    musicPath,
    sfx,
    channelName: CONFIG.CHANNEL_NAME,
    workDir,
    outputShortPath: shortPath,
  });

  // 9. Build SEO description + Honest Visual & Compliance Audit
  const mediaTelemetry = computeMediaTelemetry(allCuratedArr, assembled.durationSec);
  const chaptersBlock = assembled.chapterTimestamps
    .map(c => `${c.timestamp} ${c.title}`)
    .join('\n');

  const fullYoutubeDescription = [
    script.youtubeDescriptionIntro,
    '',
    '📌 CAPÍTULOS:',
    chaptersBlock,
    '',
    `💬 ${script.pinnedComment}`,
    '',
    '🤖 Producción documental independiente · Narración asistida con voz IA, reconstrucciones visuales cinematográficas y gráficos documentales originales.',
    '📚 Fuentes: registros históricos, archivos públicos y documentación verificada.',
    '',
    '#Documental #HistoriaReal #Misterios #Supervivencia #Ciencia',
  ].join('\n');

  const compliance = auditDocumentaryCompliance({
    script,
    fullDescription: fullYoutubeDescription,
    durationSec: assembled.durationSec,
    thumbnailPath,
    mediaTelemetry,
    quickMode,
  });

  const metadataPath = path.join(outDir, 'metadata.json');
  const metadataPackage = {
    generatedAt: new Date().toISOString(),
    engineVersion: '2.0-cinema-production',
    colorLook: script.colorLook,
    topicId: topic.id,
    category: topic.category,
    durationSec: Number(assembled.durationSec.toFixed(1)),
    shortDurationSec: Number(assembledShort.durationSec.toFixed(1)),
    mediaTelemetry,
    youtube: {
      title: script.youtubeTitle,
      description: fullYoutubeDescription,
      tags: script.youtubeTags,
      chapters: assembled.chapterTimestamps,
      pinnedComment: script.pinnedComment,
    },
    bridgeShort: {
      title: script.bridgeShort.youtubeTitle,
      description: `${script.bridgeShort.youtubeDescription}\n\n${script.bridgeShort.hashtags.join(' ')}`,
      hashtags: script.bridgeShort.hashtags,
    },
    compliance,
    files: {
      documentary: documentaryPath,
      bridgeShort: shortPath,
      thumbnail: thumbnailPath,
      shortThumbnail: shortThumbnailPath,
      captionsSrt: captionsPath,
    },
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadataPackage, null, 2), 'utf-8');

  if (markUsed && !quickMode) {
    markTopicUsed(topic);
  }

  const autoUpload =
    process.argv.includes('--auto-upload') ||
    (process.env.DOCU_AUTO_UPLOAD || '').trim().toLowerCase() === 'true';

  if (autoUpload) {
    if (CONFIG.YOUTUBE_CLIENT_ID && CONFIG.YOUTUBE_CLIENT_SECRET && CONFIG.YOUTUBE_REFRESH_TOKEN) {
      await uploadEpisodeBundleToYouTube(metadataPath);
    } else {
      console.warn(
        '[YouTubeUploader] ⚠️ --auto-upload activo pero faltan DOCU_YOUTUBE_CLIENT_ID / SECRET / REFRESH_TOKEN. Ejecuta `npm run auth:youtube` para conectar el canal.'
      );
    }
  }

  if (
    process.argv.includes('--clean-work') ||
    (process.env.DOCU_CLEAN_WORK || '').trim().toLowerCase() === 'true'
  ) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }

  console.log('\n====================================================================');
  console.log('✅ EPISODIO DOCUMENTAL v2 (1080p IMAX) GENERADO CON ÉXITO');
  console.log(`📁 Carpeta:      ${outDir}`);
  console.log(`🎬 Documental:   ${documentaryPath} (${(assembled.durationSec / 60).toFixed(2)} min · 1920x1080)`);
  console.log(`📱 Short 9:16:   ${shortPath} (${assembledShort.durationSec.toFixed(1)} s · 1080x1920)`);
  console.log(`🖼️ Póster 16:9:  ${thumbnailPath}`);
  console.log(`📝 Subtítulos:   ${captionsPath}`);
  console.log(
    `📊 Visuales:     ${mediaTelemetry.totalBeats} planos (${mediaTelemetry.avgSecPerBeat}s/corte) -> ` +
      `${mediaTelemetry.videoBrollCount} videos HD | ${mediaTelemetry.aiCinemaCount} IA IMAX | ` +
      `${mediaTelemetry.animatedMapCount} mapas | ${mediaTelemetry.statDossierCount} fichas | ${mediaTelemetry.archivalCount} archivo`
  );
  console.log(`🛡️ Auditoría:    ${compliance.score}/100 (${compliance.compliant ? 'APROBADO' : 'REVISAR'})`);
  if (compliance.warnings.length > 0) {
    console.log(`⚠️ Avisos:       ${compliance.warnings.join(' | ')}`);
  }
  console.log('====================================================================\n');

  return {
    slug: episodeSlug,
    outputDir: outDir,
    documentaryPath,
    shortPath,
    thumbnailPath,
    captionsPath,
    metadataPath,
    durationSec: assembled.durationSec,
    shortDurationSec: assembledShort.durationSec,
    mediaTelemetry,
    compliance,
  };
}

if (process.argv.includes('--list-topics')) {
  const history = loadHistory();
  const allTopics = getAllKnownTopics();
  const availableCount = allTopics.filter(t => !isTopicAlreadyUsed(t, history)).length;
  console.log(
    `\n📚 Banco de temas documentales verificados (${availableCount} disponibles / ${allTopics.length} en banco local + descubrimiento infinito activo):\n`
  );
  for (const t of allTopics) {
    const used = isTopicAlreadyUsed(t, history);
    console.log(`  - ${used ? '✅ [USADO]     ' : '🟢 [DISPONIBLE]'} [${t.category}] ${t.id} -> ${t.titleSeed}`);
  }
  process.exit(0);
}

runEpisodeGenerator().catch(err => {
  console.error('\n❌ Error generando documental:', err?.stack || err?.message || err);
  process.exit(1);
});
