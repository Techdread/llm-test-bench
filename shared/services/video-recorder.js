// Shared browser video recording service.
//
// Phase 1 records a user-selected tab/window/screen with getDisplayMedia().
// The service deliberately keeps browser globals behind functions so its
// format selection, metadata and disk persistence remain testable in Node.

export const RECORDING_SCHEMA_VERSION = 1;

export const MIME_CANDIDATES_BY_FORMAT = Object.freeze({
  mp4: Object.freeze([
    // Request H.264 explicitly for the broadest upload compatibility. Chrome
    // chooses the available audio codec for the selected capture source.
    'video/mp4;codecs=avc1',
    'video/mp4',
  ]),
  webm: Object.freeze([
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]),
});

export const MIME_CANDIDATES = Object.freeze([
  ...MIME_CANDIDATES_BY_FORMAT.mp4,
  ...MIME_CANDIDATES_BY_FORMAT.webm,
]);

export function recordingSupported(scope = globalThis) {
  return !!(
    scope?.navigator?.mediaDevices?.getDisplayMedia
    && scope?.MediaRecorder
  );
}

export function recordingFormatSupported(format, MediaRecorderClass = globalThis.MediaRecorder) {
  const candidates = MIME_CANDIDATES_BY_FORMAT[format];
  if (!candidates || !MediaRecorderClass?.isTypeSupported) return false;
  return candidates.some(type => MediaRecorderClass.isTypeSupported(type));
}

export function chooseRecordingMimeType(MediaRecorderClass = globalThis.MediaRecorder, preferredFormat = 'mp4') {
  if (!MediaRecorderClass?.isTypeSupported) return '';
  const preferred = MIME_CANDIDATES_BY_FORMAT[preferredFormat] || [];
  const fallback = MIME_CANDIDATES.filter(type => !preferred.includes(type));
  return [...preferred, ...fallback].find(type => MediaRecorderClass.isTypeSupported(type)) || '';
}

export function extensionForMimeType(mimeType = '') {
  const type = String(mimeType).toLowerCase();
  if (type.includes('mp4')) return 'mp4';
  if (type.includes('ogg')) return 'ogv';
  return 'webm';
}

export function formatRecordingDuration(durationMs = 0) {
  const seconds = Math.max(0, Math.floor(Number(durationMs) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatBytes(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop(); } catch { /* already ended */ }
  }
}

function recorderOptions(MediaRecorderClass, { format, frameRate, videoBitsPerSecond }) {
  const mimeType = chooseRecordingMimeType(MediaRecorderClass, format);
  return {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: videoBitsPerSecond || (frameRate >= 60 ? 10_000_000 : 6_000_000),
  };
}

/**
 * Ask the browser for a display stream and prepare (but do not start) a
 * MediaRecorder. Keeping start() separate lets the calling component remove
 * its permission dialog before the first encoded frame.
 */
export async function createDisplayRecordingSession({
  includeAudio = true,
  format = 'mp4',
  frameRate = 30,
  videoBitsPerSecond,
  timesliceMs = 1000,
} = {}, dependencies = {}) {
  const scope = dependencies.scope || globalThis;
  const mediaDevices = dependencies.mediaDevices || scope.navigator?.mediaDevices;

  if (
    !mediaDevices?.getDisplayMedia
    || !(dependencies.MediaRecorderClass || scope.MediaRecorder)
    || !(dependencies.BlobClass || scope.Blob)
  ) {
    throw new Error('Screen recording is not supported in this browser.');
  }

  const stream = await mediaDevices.getDisplayMedia({
    video: {
      displaySurface: 'browser',
      frameRate: { ideal: frameRate },
    },
    audio: includeAudio ? { suppressLocalAudioPlayback: false } : false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'include',
    systemAudio: includeAudio ? 'include' : 'exclude',
    monitorTypeSurfaces: 'include',
  });

  try {
    return createStreamRecordingSession(stream, { format, frameRate, videoBitsPerSecond, timesliceMs }, dependencies);
  } catch (error) {
    stopTracks(stream);
    throw error;
  }
}

/**
 * Prepare any caller-supplied MediaStream for recording. Canvas/WebGL apps can
 * use this directly with canvas.captureStream() while sharing the same timing,
 * encoding, preview and persistence contract as display capture.
 */
export function createStreamRecordingSession(stream, {
  format = 'mp4',
  frameRate = 30,
  videoBitsPerSecond,
  timesliceMs = 1000,
} = {}, dependencies = {}) {
  const scope = dependencies.scope || globalThis;
  const MediaRecorderClass = dependencies.MediaRecorderClass || scope.MediaRecorder;
  const BlobClass = dependencies.BlobClass || scope.Blob;
  const now = dependencies.now || (() => Date.now());

  if (!stream || !MediaRecorderClass || !BlobClass) {
    throw new Error('Media stream recording is not supported in this browser.');
  }

  const videoTrack = stream.getVideoTracks?.()[0];
  if (!videoTrack) {
    stopTracks(stream);
    throw new Error('The selected capture source did not provide a video track.');
  }

  let recorder;
  const options = recorderOptions(MediaRecorderClass, { format, frameRate, videoBitsPerSecond });
  try {
    recorder = new MediaRecorderClass(stream, options);
  } catch (error) {
    // A browser can report a type as supported yet reject it for a concrete
    // stream. Let it choose a safe default before giving up.
    try { recorder = new MediaRecorderClass(stream, { videoBitsPerSecond: options.videoBitsPerSecond }); }
    catch {
      stopTracks(stream);
      throw error;
    }
  }

  const chunks = [];
  let startedAt = null;
  let segmentStartedAt = null;
  let activeDurationMs = 0;
  let started = false;
  let settled = false;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });

  const getDurationMs = () => activeDurationMs + (
    segmentStartedAt == null ? 0 : Math.max(0, now() - segmentStartedAt)
  );

  recorder.ondataavailable = event => {
    if (event.data?.size) chunks.push(event.data);
  };

  recorder.onerror = event => {
    if (settled) return;
    settled = true;
    stopTracks(stream);
    rejectDone(event.error || new Error('The browser recorder failed.'));
  };

  recorder.onstop = () => {
    if (settled) return;
    if (segmentStartedAt != null) {
      activeDurationMs += Math.max(0, now() - segmentStartedAt);
      segmentStartedAt = null;
    }
    settled = true;
    stopTracks(stream);
    const mimeType = recorder.mimeType || chunks[0]?.type || options.mimeType || 'video/webm';
    const blob = new BlobClass(chunks, { type: mimeType });
    const settings = videoTrack.getSettings?.() || {};
    resolveDone({
      blob,
      mimeType,
      extension: extensionForMimeType(mimeType),
      requestedFormat: format,
      sizeBytes: blob.size,
      durationMs: activeDurationMs,
      startedAt: startedAt == null ? null : new Date(startedAt).toISOString(),
      endedAt: new Date(now()).toISOString(),
      width: settings.width || null,
      height: settings.height || null,
      frameRate: settings.frameRate || frameRate,
      displaySurface: settings.displaySurface || 'unknown',
      audio: (stream.getAudioTracks?.() || []).length > 0,
    });
  };

  const session = {
    stream,
    recorder,
    done,
    get state() { return recorder.state; },
    getDurationMs,
    start() {
      if (started || recorder.state !== 'inactive') return;
      started = true;
      startedAt = now();
      segmentStartedAt = startedAt;
      recorder.start(timesliceMs);
    },
    pause() {
      if (recorder.state !== 'recording') return;
      if (segmentStartedAt != null) activeDurationMs += Math.max(0, now() - segmentStartedAt);
      segmentStartedAt = null;
      recorder.pause();
    },
    resume() {
      if (recorder.state !== 'paused') return;
      segmentStartedAt = now();
      recorder.resume();
    },
    stop() {
      if (!started) {
        stopTracks(stream);
        if (!settled) {
          settled = true;
          rejectDone(new Error('Recording stopped before it started.'));
        }
        return done;
      }
      if (recorder.state !== 'inactive') recorder.stop();
      return done;
    },
  };

  videoTrack.addEventListener?.('ended', () => session.stop());
  return session;
}

function safeStem(value) {
  return String(value || 'recording')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 _-]+/g, '')
    .trim()
    .replace(/[ _]+/g, '-')
    .toLowerCase()
    .slice(0, 48) || 'recording';
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
}

async function allocateRecordingDirectory(recordingsDir, baseId) {
  for (let suffix = 1; suffix <= 100; suffix++) {
    const id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    try {
      await recordingsDir.getDirectoryHandle(id, { create: false });
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
      return { id, handle: await recordingsDir.getDirectoryHandle(id, { create: true }) };
    }
  }
  throw new Error('Could not allocate a unique recording folder.');
}

async function writeFile(directory, name, value) {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(value);
  await writable.close();
}

export async function saveRecording(appHandle, recording, {
  appId,
  appTitle = '',
  title = 'Recording',
  source = 'display',
  sourceArtefactId = null,
  route = '',
  metadata = {},
} = {}, dependencies = {}) {
  if (!appHandle) throw new Error('Connect a data root before saving this recording.');
  if (!recording?.blob) throw new Error('There is no completed recording to save.');

  const now = dependencies.now || (() => new Date());
  const random = dependencies.random || Math.random;
  const savedAt = now();
  const randomPart = random().toString(36).slice(2, 7) || 'video';
  const baseId = `${safeStem(title)}-${compactTimestamp(savedAt)}-${randomPart}`;
  const recordingsDir = await appHandle.getDirectoryHandle('recordings', { create: true });
  const { id, handle } = await allocateRecordingDirectory(recordingsDir, baseId);
  const extension = recording.extension || extensionForMimeType(recording.mimeType);
  const filename = `recording.${extension}`;
  const record = {
    schemaVersion: RECORDING_SCHEMA_VERSION,
    id,
    title: title || 'Recording',
    appId: appId || '',
    appTitle,
    source,
    sourceArtefactId: sourceArtefactId || null,
    route,
    createdAt: recording.startedAt,
    savedAt: savedAt.toISOString(),
    durationMs: recording.durationMs || 0,
    mimeType: recording.mimeType || recording.blob.type || '',
    requestedFormat: recording.requestedFormat || null,
    filename,
    sizeBytes: recording.blob.size,
    width: recording.width || null,
    height: recording.height || null,
    frameRate: recording.frameRate || null,
    displaySurface: recording.displaySurface || null,
    audio: !!recording.audio,
    context: metadata && typeof metadata === 'object' ? metadata : {},
  };

  await writeFile(handle, filename, recording.blob);
  await writeFile(handle, 'metadata.json', JSON.stringify(record, null, 2));
  return { id, filename, metadata: record, path: `recordings/${id}/${filename}` };
}

export function downloadRecording(recording, title = 'recording', dependencies = {}) {
  if (!recording?.blob) throw new Error('There is no completed recording to download.');
  const documentRef = dependencies.documentRef || globalThis.document;
  const urlApi = dependencies.urlApi || globalThis.URL;
  const extension = recording.extension || extensionForMimeType(recording.mimeType || recording.blob.type);
  const filename = `${safeStem(title)}.${extension}`;
  const url = urlApi.createObjectURL(recording.blob);
  const anchor = documentRef.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => urlApi.revokeObjectURL(url), 1000);
  return filename;
}
