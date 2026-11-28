export type TopicCategory =
  | 'supervivencia'
  | 'errores_historicos'
  | 'misterios'
  | 'ciencia_extrema';

export type DocuMood = 'tension' | 'mystery' | 'awe' | 'survival';

export type CameraMotion = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right';

export type CinemaColorLook =
  | 'ocean_noir'
  | 'jungle_emerald'
  | 'arctic_steel'
  | 'coldwar_tungsten'
  | 'cosmos_gold'
  | 'vintage_sepia';

export type NarrativeArchetype =
  | 'countdown_forensic'
  | 'mystery_investigation'
  | 'survival_immersion'
  | 'domino_effect'
  | 'scale_paradox';

export type ThumbnailArchetype =
  | 'editorial_left'
  | 'editorial_right'
  | 'cinema_bottom'
  | 'forensic_dossier';

export type AccentPalette =
  | 'electric_gold'
  | 'crimson_alert'
  | 'biolum_cyan'
  | 'solar_amber'
  | 'ice_laser';

export type MusicVariant =
  | 'zimmer_pulse'
  | 'abyssal_cello'
  | 'clockwork_thriller'
  | 'interstellar_organ';

export type ShortCaptionTheme = 'gold_impact' | 'cyan_pulse' | 'crimson_alert';

export interface CreativeDnaPlan {
  recommendedCategory: TopicCategory;
  narrativeArchetype: NarrativeArchetype;
  narrativeInstructionEs: string;
  thumbnailArchetype: ThumbnailArchetype;
  accentPalette: AccentPalette;
  narratorVoice: 'Fenrir' | 'Charon' | 'Orus';
  musicVariant: MusicVariant;
  shortCaptionTheme: ShortCaptionTheme;
  targetShortMinWords: number;
  targetShortMaxWords: number;
  forbiddenStatBadges: string[];
  forbiddenOpeningPhrases: string[];
  learningBriefEs: string;
}

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
  mood: DocuMood;
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
  weight: number;
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
  pinnedComment?: string;
  hashtags: string[];
}

export interface DocumentaryScript {
  topicId: string;
  slug: string;
  category: TopicCategory;
  mood: DocuMood;
  colorLook?: CinemaColorLook;
  creativeDna?: {
    narrativeArchetype: NarrativeArchetype;
    thumbnailArchetype: ThumbnailArchetype;
    accentPalette: AccentPalette;
    narratorVoice: string;
    musicVariant: MusicVariant;
    shortCaptionTheme: ShortCaptionTheme;
  };
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
