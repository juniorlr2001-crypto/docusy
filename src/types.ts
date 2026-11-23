export type TopicCategory =
  | 'supervivencia'
  | 'errores_historicos'
  | 'misterios'
  | 'ciencia_extrema';

export type CameraMotion = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right';

export type CinemaColorLook =
  | 'ocean_noir'
  | 'jungle_emerald'
  | 'arctic_steel'
  | 'coldwar_tungsten'
  | 'cosmos_gold'
  | 'vintage_sepia';

export type BeatVisualType =
  | 'video_broll'
  | 'ai_cinema'
  | 'animated_map'
  | 'stat_dossier'
  | 'archival_evidence';

export interface GeoPoint {
  name: string;
  lat: number;
  lon: number;
}

export interface MapSpec {
  title: string;
  from: GeoPoint;
  to?: GeoPoint;
  distanceLabel?: string;
  dateLabel?: string;
}

export interface StatOverlay {
  eyebrow?: string;
  value: string;
  label: string;
  detail?: string;
}

export interface DocumentaryTopic {
  id: string;
  category: TopicCategory;
  titleSeed: string;
  angle: string;
  wikiTitleEs: string;
  wikiTitleEn?: string;
  mood: 'tension' | 'mystery' | 'awe' | 'survival';
  visualTheme: string;
  verifiedFacts?: string;
}

export interface DocumentaryScene {
  sceneNumber: number;
  visualType: BeatVisualType;
  visualPromptEn: string;
  videoSearchQueries: string[];
  pexelsFallbackQuery: string;
  cameraMotion: CameraMotion;
  subtitleCue: string;
  locationStamp?: string;
  keyQuoteEs?: string;
  statOverlay?: StatOverlay;
  mapSpec?: MapSpec;
  weight: number; // Relative share of chapter duration
}

export interface DocumentaryChapter {
  chapterNumber: number;
  chapterTitle: string;
  chapterDate?: string;
  chapterLocation?: string;
  narrationEs: string;
  scenes: DocumentaryScene[];
}

export interface BridgeShortPlan {
  hookTitle: string;
  narrationEs: string;
  visualPromptsEn: string[];
  videoSearchQueries: string[];
  pexelsFallbackQueries: string[];
  statPunch?: StatOverlay;
  mapSpec?: MapSpec;
  youtubeTitle: string;
  youtubeDescription: string;
  hashtags: string[];
}

export interface DocumentaryScript {
  topicId: string;
  slug: string;
  category: TopicCategory;
  mood: 'tension' | 'mystery' | 'awe' | 'survival';
  colorLook?: CinemaColorLook;
  visualStyleGuideEn: string;
  youtubeTitle: string;
  thumbnailHeadline: string;
  thumbnailSubBadge: string;
  thumbnailPromptEn: string;
  thumbnailStatBadge?: string;
  primaryMapSpec?: MapSpec;
  youtubeDescriptionIntro: string;
  youtubeTags: string[];
  pinnedComment: string;
  chapters: DocumentaryChapter[];
  bridgeShort: BridgeShortPlan;
}

export interface CuratedBeatAsset {
  sceneNumber: number;
  mediaKind: 'video' | 'image' | 'animated_map' | 'stat_dossier';
  filePath?: string;
  backgroundVideoPath?: string;
  provider: string;
  durationSec?: number;
  mapSpec?: MapSpec;
  statOverlay?: StatOverlay;
}

export interface MediaTelemetry {
  totalBeats: number;
  videoBrollCount: number;
  aiCinemaCount: number;
  animatedMapCount: number;
  statDossierCount: number;
  archivalCount: number;
  fallbackPhotoCount: number;
  avgSecPerBeat: number;
  resolution: string;
}

export interface ComplianceReport {
  compliant: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
  checks: string[];
}

export interface EpisodeResult {
  slug: string;
  outputDir: string;
  documentaryPath: string;
  shortPath: string;
  thumbnailPath: string;
  captionsPath: string;
  metadataPath: string;
  durationSec: number;
  shortDurationSec: number;
  mediaTelemetry: MediaTelemetry;
  compliance: ComplianceReport;
}
