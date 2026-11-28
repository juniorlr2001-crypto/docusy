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
import {
  generateDocumentaryThumbnail,
  generateShortThumbnail,
  isGenuinePhotographicImage,
} from './services/thumbnailGenerator.js';
import { ensureCinemaSfxPack, ensureDocumentaryMusicBed } from './services/ambientMusic.js';
import { assembleBridgeShortVideo, assembleDocumentaryVideo } from './services/docuAssembler.js';
import { auditDocumentaryCompliance } from './services/complianceGuard.js';
import { uploadEpisodeBundleToYouTube } from './services/youtubeUploader.js';
import { sendShortPackageToTelegram } from './services/telegramDelivery.js';
import {
  buildSelfLearningCreativePlan,
  recordCompletedEpisodeInMemory,
  syncLiveChannelTelemetry,
} from './services/selfLearningOptimizer.js';

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
    `🎬 DOCU-VIRAL ENGINE v2.5 — AUTO-APRENDIZAJE & EDICIÓN ANTI-FÁBRICA (${quickMode ? 'PRUEBA RÁPIDA' : 'DOCUMENTAL 1080p + SHORT LOOP'})`
  );
  console.log('====================================================================\n');

  // 0. Sync live YouTube channel metrics ($0) & build adaptive anti-factory Creative DNA
  const perfMemory = await syncLiveChannelTelemetry();
  const historySnapshot = loadHistory();
  const creativePlan = buildSelfLearningCreativePlan(perfMemory, historySnapshot.lastCategory);

  // 1. Select verified documentary topic & load Wikipedia facts
  const forceDiscover = process.argv.includes('--discover');
  const topic = await selectNextDocumentaryTopic({
    category,
    recommendedCategory: creativePlan.recommendedCategory,
    learningBriefEs: creativePlan.learningBriefEs,
    topicId,
    customTopic,
    forceDiscover,
  });
  console.log(`[Pipeline] 📌 Tema seleccionado: "${topic.titleSeed}" (${topic.category})`);

  // 2. Write complete IMAX documentary script + 72-beat visual storyboard + Circular-Loop Bridge Short
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
    script = await generateDocumentaryScript(topic, { quickMode, creativePlan });
    script.slug = episodeSlug;
    fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf-8');
  }

  // 3. Prepare rotated copyright-free cinematic score + cinema SFX pack
  const chosenMusicVariant = script.creativeDna?.musicVariant || creativePlan.musicVariant;
  const [musicPath, sfx] = await Promise.all([
    ensureDocumentaryMusicBed(script.mood, chosenMusicVariant),
    ensureCinemaSfxPack(),
  ]);

  // 4. Generate chapter voiceovers sequentially (rotating studio narrator voices)
  const chapterAudios: Array<{ chapterNumber: number; audioPath: string; durationSec: number }> = [];
  const narratorVoice =
    (script.creativeDna?.narratorVoice as 'Fenrir' | 'Charon' | 'Orus' | undefined) ||
    creativePlan.narratorVoice;

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

  // 5. Curate all cinema visual beats with cross-episode stock footage deduplication
  const curator = new EpisodeMediaCurator(perfMemory.recentStockVideoIds);
  await curator.preloadArchivalMedia(topic);

  // Pre-attempt 16:9 thumbnail hero AI background first while Cloudflare AI bucket is fresh (do NOT save flat emergency gradient yet!)
  const thumbnailPath = path.join(outDir, 'thumbnail_16x9.jpg');
  await generateDocumentaryThumbnail(script, workDir, thumbnailPath, {
    curator,
    allowEmergencyGradient: false,
  });

  const allScenes = script.chapters.flatMap(c => c.scenes);
  const beatAssets = new Map<number, CuratedBeatAsset>();

  console.log(`[Pipeline] 🎥 Curando ${allScenes.length} planos visuales 1080p (videos HD sin repetir + IA + mapas + fichas)...`);
  for (const sc of allScenes) {
    const curated = await curator.curateDocumentaryBeat({ scene: sc, script, workDir });
    beatAssets.set(sc.sceneNumber, curated);
  }

  const allCuratedArr = Array.from(beatAssets.values());

  // Curate 14-16 rapid vertical 9:16 assets (~1.8s/cut) for Bridge Short
  console.log('[Pipeline] 📱 Curando 15 planos verticales rápidos (~1.8s/corte) 1080x1920 para el Short...');
  const shortAssets = await curator.curateBridgeShortAssets({
    script,
    workDir,
    existingBeatAssets: allCuratedArr,
  });

  // 6. Guarantee a genuine high-contrast photographic 16:9 Thumbnail (uses curated AI/archival/HD video frame if Step 5 hit quota!)
  const rawThumbBg = path.join(workDir, 'thumb_bg_raw.jpg');
  if (!fs.existsSync(thumbnailPath) || !(await isGenuinePhotographicImage(rawThumbBg))) {
    const firstVideoBeat = allCuratedArr.find(a => a.mediaKind === 'video' && a.filePath);
    const firstAiBeat = allCuratedArr.find(
      a => a.mediaKind === 'image' && a.filePath && !a.provider.includes('procedural')
    );
    await generateDocumentaryThumbnail(script, workDir, thumbnailPath, {
      curator,
      fallbackImagePath: firstAiBeat?.filePath,
      fallbackVideoPath: firstVideoBeat?.filePath,
      forceRegenerateBg: true,
      allowEmergencyGradient: true,
    });
  }

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

  // 8. Assemble Full HD 1080x1920 @ 30fps Circular-Loop Short
  const shortPath = path.join(outDir, 'short_9x16.mp4');
  const assembledShort = await assembleBridgeShortVideo({
    script,
    shortAudioPath: shortAudio.audioPath,
    shortDurationSec: shortAudio.durationSec,
    shortAssets,
    shortThumbnailPath,
    musicPath,
    sfx,
    channelName: CONFIG.CHANNEL_NAME,
    workDir,
    outputShortPath: shortPath,
  });

  // 9. Build viewer-first SEO description (AI disclosure cleanly placed at the bottom)
  const mediaTelemetry = computeMediaTelemetry(allCuratedArr, assembled.durationSec);
  const chaptersBlock = assembled.chapterTimestamps
    .map(c => `${c.timestamp} ${c.title}`)
    .join('\n');

  const fullYoutubeDescription = [
    script.youtubeDescriptionIntro,
    '',
    `💬 ${script.pinnedComment}`,
    '',
    '📌 CAPÍTULOS:',
    chaptersBlock,
    '',
    '📚 Fuentes: registros históricos, archivos públicos y documentación científica verificada.',
    '🤖 Transparencia: producción documental independiente con narración asistida por voz IA y reconstrucciones cinematográficas.',
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
    engineVersion: '2.5-self-learning-antifactory',
    colorLook: script.colorLook,
    creativeDna: script.creativeDna,
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
      pinnedComment: script.bridgeShort.pinnedComment || script.pinnedComment,
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

  let uploadedDocuId: string | undefined;
  let uploadedShortId: string | undefined;
  let uploadedDocuUrl: string | undefined;
  let uploadedShortUrl: string | undefined;

  const autoUpload =
    process.argv.includes('--auto-upload') ||
    (process.env.DOCU_AUTO_UPLOAD || '').trim().toLowerCase() === 'true';

  if (autoUpload) {
    if (CONFIG.YOUTUBE_CLIENT_ID && CONFIG.YOUTUBE_CLIENT_SECRET && CONFIG.YOUTUBE_REFRESH_TOKEN) {
      const up = await uploadEpisodeBundleToYouTube(metadataPath);
      uploadedDocuId = up.documentary.videoId;
      uploadedShortId = up.bridgeShort.videoId;
      uploadedDocuUrl = up.documentary.url;
      uploadedShortUrl = up.bridgeShort.url;
    } else {
      console.warn(
        '[YouTubeUploader] ⚠️ --auto-upload activo pero faltan DOCU_YOUTUBE_CLIENT_ID / SECRET / REFRESH_TOKEN.'
      );
    }
  }

  // Send clean 1080p Short MP4 + TikTok/Reels ready-to-paste copy privately to Telegram ($0)
  await sendShortPackageToTelegram({
    shortVideoPath: shortPath,
    channelLabel: `🎬 @${CONFIG.CHANNEL_NAME}`,
    youtubeTitle: script.youtubeTitle,
    shortTitle: script.bridgeShort.youtubeTitle,
    pinnedComment: script.pinnedComment,
    hashtags: script.bridgeShort.hashtags,
    youtubeDocuUrl: uploadedDocuUrl,
    youtubeShortUrl: uploadedShortUrl,
  });

  // Persist Creative DNA + used stock video IDs into self-learning memory (`data/performance_memory.json` -> `radar-state`)
  if (!quickMode) {
    const shortWords = script.bridgeShort.narrationEs.split(/\s+/).filter(Boolean).length;
    recordCompletedEpisodeInMemory({
      memory: perfMemory,
      entry: {
        slug: episodeSlug,
        topicId: topic.id,
        category: topic.category,
        narrativeArchetype: script.creativeDna?.narrativeArchetype || creativePlan.narrativeArchetype,
        thumbnailArchetype: script.creativeDna?.thumbnailArchetype || creativePlan.thumbnailArchetype,
        accentPalette: script.creativeDna?.accentPalette || creativePlan.accentPalette,
        narratorVoice,
        musicVariant: chosenMusicVariant,
        shortCaptionTheme: script.creativeDna?.shortCaptionTheme || creativePlan.shortCaptionTheme,
        youtubeTitle: script.youtubeTitle,
        shortTitle: script.bridgeShort.youtubeTitle,
        thumbnailHeadline: script.thumbnailHeadline,
        thumbnailStatBadge: script.thumbnailStatBadge,
        shortWordCount: shortWords,
        shortDurationSec: Number(assembledShort.durationSec.toFixed(1)),
        documentaryVideoId: uploadedDocuId,
        shortVideoId: uploadedShortId,
        createdAt: new Date().toISOString(),
      },
      usedStockVideoIds: curator.getUsedStockVideoIds(),
    });
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
  console.log('✅ DOCUMENTAL v2.5 (AUTO-APRENDIZAJE + ANTI-FÁBRICA) GENERADO');
  console.log(`📁 Carpeta:      ${outDir}`);
  console.log(`🎬 Documental:   ${documentaryPath} (${(assembled.durationSec / 60).toFixed(2)} min)`);
  console.log(`📱 Short Loop:   ${shortPath} (${assembledShort.durationSec.toFixed(1)} s)`);
  console.log(`🖼️ Miniatura:    ${thumbnailPath}`);
  console.log(
    `📊 Telemetría:   ${mediaTelemetry.totalBeats} planos (${mediaTelemetry.avgSecPerBeat}s/corte) -> ` +
      `${mediaTelemetry.videoBrollCount} videos HD | ${mediaTelemetry.aiCinemaCount} IA | ` +
      `${mediaTelemetry.animatedMapCount} mapas | ${mediaTelemetry.statDossierCount} fichas`
  );
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
    `\n📚 Banco de temas documentales (${availableCount} disponibles / ${allTopics.length} conocidos | publicados: ${history.usedIds.length}):\n`
  );
  for (const t of allTopics) {
    const used = isTopicAlreadyUsed(t, history);
    console.log(`  - ${used ? '✅ [PUBLICADO] ' : '🟢 [DISPONIBLE]'} [${t.category}] ${t.id} -> ${t.titleSeed}`);
  }
  process.exit(0);
}

runEpisodeGenerator().catch(err => {
  console.error('\n❌ Error generando episodio documental:', err?.stack || err?.message || err);
  process.exit(1);
});
