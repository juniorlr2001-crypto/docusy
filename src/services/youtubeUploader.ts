import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

async function getYouTubeAccessToken(): Promise<string> {
  if (!CONFIG.YOUTUBE_CLIENT_ID || !CONFIG.YOUTUBE_CLIENT_SECRET || !CONFIG.YOUTUBE_REFRESH_TOKEN) {
    throw new Error(
      'Faltan DOCU_YOUTUBE_CLIENT_ID, DOCU_YOUTUBE_CLIENT_SECRET y DOCU_YOUTUBE_REFRESH_TOKEN en docu-viral-engine/.env'
    );
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CONFIG.YOUTUBE_CLIENT_ID,
      client_secret: CONFIG.YOUTUBE_CLIENT_SECRET,
      refresh_token: CONFIG.YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data: any = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`YouTube OAuth error: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

/**
 * Uploads a finished documentary or Bridge Short to the separate YouTube channel (Phase 2).
 * Uses strictly DOCU_YOUTUBE_* credentials — completely isolated from AiAD.
 */
export async function uploadVideoToYouTube(params: {
  videoPath: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailPath?: string;
  captionsSrtPath?: string;
  firstCommentText?: string;
  privacyStatus?: 'public' | 'unlisted' | 'private';
}): Promise<{
  videoId: string;
  url: string;
  thumbnailAttached: boolean;
  captionsAttached?: boolean;
  commentPosted?: boolean;
}> {
  const accessToken = await getYouTubeAccessToken();
  const videoBuf = fs.readFileSync(params.videoPath);

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(videoBuf.length),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: params.title.slice(0, 100),
          description: params.description.slice(0, 5000),
          tags: params.tags.slice(0, 15),
          categoryId: '27', // Education / Documentary
          defaultLanguage: 'es',
          defaultAudioLanguage: 'es',
        },
        status: {
          privacyStatus: params.privacyStatus || CONFIG.YOUTUBE_PRIVACY || 'unlisted',
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: true,
        },
      }),
    }
  );

  const uploadUrl = initRes.headers.get('location');
  if (!initRes.ok || !uploadUrl) {
    throw new Error(`YouTube init error (${initRes.status}): ${await initRes.text()}`);
  }

  const upRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(videoBuf.length),
    },
    body: videoBuf,
  });
  const uploaded: any = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !uploaded.id) {
    throw new Error(`YouTube upload error (${upRes.status}): ${JSON.stringify(uploaded)}`);
  }

  let thumbnailAttached = false;
  if (params.thumbnailPath && fs.existsSync(params.thumbnailPath)) {
    try {
      const thumbBuf = fs.readFileSync(params.thumbnailPath);
      const tRes = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(uploaded.id)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'image/jpeg',
            'Content-Length': String(thumbBuf.length),
          },
          body: thumbBuf,
        }
      );
      thumbnailAttached = tRes.ok;
    } catch {
      thumbnailAttached = false;
    }
  }

  let captionsAttached = false;
  if (params.captionsSrtPath && fs.existsSync(params.captionsSrtPath)) {
    try {
      const srtContent = fs.readFileSync(params.captionsSrtPath, 'utf-8');
      const boundary = `----DocuViralSrtBoundary${Date.now()}`;
      const metadataPart = JSON.stringify({
        snippet: {
          videoId: uploaded.id,
          language: 'es',
          name: 'Español',
          isDraft: false,
        },
      });
      const multipartBody = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        metadataPart,
        `--${boundary}`,
        'Content-Type: application/x-subrip; charset=UTF-8',
        '',
        srtContent,
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const cRes = await fetch(
        'https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
        }
      );
      captionsAttached = cRes.ok;
    } catch {
      captionsAttached = false;
    }
  }

  let commentPosted = false;
  if (params.firstCommentText && params.firstCommentText.trim()) {
    try {
      const cmRes = await fetch(
        'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: JSON.stringify({
            snippet: {
              videoId: uploaded.id,
              topLevelComment: {
                snippet: {
                  textOriginal: params.firstCommentText.trim(),
                },
              },
            },
          }),
        }
      );
      commentPosted = cmRes.ok;
    } catch {
      commentPosted = false;
    }
  }

  return {
    videoId: uploaded.id,
    url: `https://www.youtube.com/watch?v=${uploaded.id}`,
    thumbnailAttached,
    captionsAttached,
    commentPosted,
  };
}

/**
 * Unattended full-episode uploader:
 * 1. Uploads 16:9 Documentary + 16:9 Thumbnail + .srt Captions + First comment
 * 2. Appends full documentary link to Bridge Short description & uploads 9:16 Bridge Short + 9:16 Thumbnail + First comment
 * 3. Persists YouTube URLs into metadata.json
 */
export async function uploadEpisodeBundleToYouTube(
  metadataPath: string,
  options?: { privacyStatus?: 'public' | 'unlisted' | 'private' }
): Promise<{
  documentary: {
    videoId: string;
    url: string;
    thumbnailAttached: boolean;
    captionsAttached?: boolean;
    commentPosted?: boolean;
  };
  bridgeShort: {
    videoId: string;
    url: string;
    thumbnailAttached: boolean;
    commentPosted?: boolean;
  };
}> {
  const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  const privacy =
    options?.privacyStatus ||
    ((CONFIG.YOUTUBE_PRIVACY as 'public' | 'unlisted' | 'private') || 'unlisted');

  console.log(`\n[YouTubeUploader] 🚀 Subiendo Documental 16:9 (${privacy}): "${meta.youtube.title}"...`);
  const docuRes = await uploadVideoToYouTube({
    videoPath: meta.files.documentary,
    title: meta.youtube.title,
    description: meta.youtube.description,
    tags: meta.youtube.tags || [],
    thumbnailPath: meta.files.thumbnail,
    captionsSrtPath: meta.files.captionsSrt,
    firstCommentText: meta.youtube.pinnedComment,
    privacyStatus: privacy,
  });
  console.log(
    `[YouTubeUploader] ✅ Documental 16:9 publicado: ${docuRes.url} (miniatura=${docuRes.thumbnailAttached}, srt=${docuRes.captionsAttached}, comentario=${docuRes.commentPosted})`
  );

  console.log(`[YouTubeUploader] 📱 Subiendo Short puente 9:16 (${privacy}): "${meta.bridgeShort.title}"...`);
  const shortRes = await uploadVideoToYouTube({
    videoPath: meta.files.bridgeShort,
    title: meta.bridgeShort.title,
    description: meta.bridgeShort.description,
    tags: Array.from(new Set([...(meta.youtube.tags || []), 'Shorts'])),
    privacyStatus: privacy,
  });
  console.log(`[YouTubeUploader] ✅ Short puente 9:16 publicado: ${shortRes.url}\n`);

  meta.youtubeUpload = {
    uploadedAt: new Date().toISOString(),
    privacyStatus: privacy,
    documentary: docuRes,
    bridgeShort: shortRes,
  };
  fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2), 'utf-8');

  return {
    documentary: docuRes,
    bridgeShort: shortRes,
  };
}
