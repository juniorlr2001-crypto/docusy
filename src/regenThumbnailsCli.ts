import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';
import { DocumentaryScript } from './types.js';
import { EpisodeMediaCurator } from './services/mediaCurator.js';
import { generateDocumentaryThumbnail, generateShortThumbnail } from './services/thumbnailGenerator.js';

const HERO_PROMPT_OVERRIDES: Record<string, { promptEn: string; headline?: string; statBadge?: string }> = {
  'alvarenga-438-dias': {
    headline: '438 DÍAS NÁUFRAGO',
    statBadge: '10,800 KM',
    promptEn:
      'Close-up dramatic portrait of a gaunt bearded castaway survivor in a tiny battered fiberglass boat on the right, gripping the edge with wide desperate eyes illuminated by golden sunset lightning, colossal turquoise ocean wave rising behind him',
  },
  'stanislav-petrov-1983': {
    headline: 'DETUVO EL APOCALIPSIS',
    statBadge: '5 MISILES',
    promptEn:
      'Medium close-up of a tense 1983 Soviet officer in uniform on the right side of frame, sweat on forehead, face brightly lit by glowing crimson nuclear warning screen and warm tungsten console lights, red launch alarm button glowing in foreground',
  },
  'juliane-koepcke-amazonas': {
    headline: 'CAYÓ 3,000 METROS',
    statBadge: '11 DÍAS SOLA',
    promptEn:
      'Dramatic action close-up on the right of a terrified 17-year-old girl strapped into an airliner row seat falling through storm clouds, bright golden lightning and fiery plane fuselage explosion behind her above vivid green Amazon rainforest canopy',
  },
  'faro-islas-flannan': {
    headline: 'NUNCA APARECIERON',
    statBadge: '3 FAREROS',
    promptEn:
      'Dramatic medium close-up on the right of a 1900 Scottish lighthouse keeper in wet yellow oilskin coat holding a blazing golden lantern in the rain, colossal crashing Atlantic wave and glowing stone lighthouse beacon on cliff behind him',
  },
};

async function main() {
  const dirs = fs
    .readdirSync(CONFIG.OUTPUT_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(CONFIG.OUTPUT_DIR, d.name));

  for (const epDir of dirs) {
    const scriptPath = path.join(epDir, 'script.json');
    if (!fs.existsSync(scriptPath)) continue;

    const script: DocumentaryScript = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));
    const workDir = path.join(epDir, 'work');
    fs.mkdirSync(workDir, { recursive: true });

    const override = HERO_PROMPT_OVERRIDES[script.topicId];
    if (override) {
      script.thumbnailPromptEn = override.promptEn;
      if (override.headline) script.thumbnailHeadline = override.headline;
      if (override.statBadge) script.thumbnailStatBadge = override.statBadge;
      fs.writeFileSync(scriptPath, JSON.stringify(script, null, 2), 'utf-8');
    }

    const rawBg = path.join(workDir, 'thumb_bg_raw.jpg');
    if (fs.existsSync(rawBg)) {
      fs.unlinkSync(rawBg);
    }

    const curator = new EpisodeMediaCurator();
    const thumb16x9 = path.join(epDir, 'thumbnail_16x9.jpg');
    const thumb9x16 = path.join(epDir, 'thumbnail_short_9x16.jpg');

    console.log(`\n🎨 Regenerando miniatura viral de alto CTR para: ${path.basename(epDir)}...`);
    await generateDocumentaryThumbnail(script, workDir, thumb16x9, {
      curator,
      forceRegenerateBg: true,
    });
    if (!fs.existsSync(rawBg) || fs.statSync(rawBg).size < 25_000) {
      throw new Error('No se pudo conectar a Cloudflare AI para generar el fondo HDR de la miniatura.');
    }
    await generateShortThumbnail(script, workDir, thumb9x16);
  }
}

main().catch(err => {
  console.error('❌ Error regenerando miniaturas:', err?.message || err);
  process.exit(1);
});
