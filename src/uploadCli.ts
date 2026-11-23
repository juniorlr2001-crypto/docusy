import fs from 'fs';
import path from 'path';
import { uploadEpisodeBundleToYouTube, uploadVideoToYouTube } from './services/youtubeUploader.js';

async function main() {
  const folderArg = process.argv[2];
  if (!folderArg) {
    console.error('Uso: npm run upload -- <ruta-carpeta-episodio> [--both] [--short] [--public]');
    process.exit(1);
  }
  const epDir = path.resolve(folderArg);
  const metaPath = path.join(epDir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`No existe metadata.json en ${epDir}`);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const uploadBoth = process.argv.includes('--both');
  const uploadShort = process.argv.includes('--short');
  const privacy = process.argv.includes('--public') ? 'public' : 'unlisted';

  if (uploadBoth) {
    const res = await uploadEpisodeBundleToYouTube(metaPath, { privacyStatus: privacy });
    console.log('✅ Paquete completo subido (Documental 16:9 + Short 9:16):', res);
  } else if (uploadShort) {
    const res = await uploadVideoToYouTube({
      videoPath: meta.files.bridgeShort,
      title: meta.bridgeShort.title,
      description: meta.bridgeShort.description,
      tags: meta.youtube.tags,
      privacyStatus: privacy,
    });
    console.log('✅ Short puente subido:', res);
  } else {
    const res = await uploadVideoToYouTube({
      videoPath: meta.files.documentary,
      title: meta.youtube.title,
      description: meta.youtube.description,
      tags: meta.youtube.tags,
      thumbnailPath: meta.files.thumbnail,
      captionsSrtPath: meta.files.captionsSrt,
      privacyStatus: privacy,
    });
    console.log('✅ Documental 16:9 subido:', res);
  }
}

main().catch(err => {
  console.error('❌ Error al subir:', err?.message || err);
  process.exit(1);
});
