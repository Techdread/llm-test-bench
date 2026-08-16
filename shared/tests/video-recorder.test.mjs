import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseRecordingMimeType,
  createDisplayRecordingSession,
  extensionForMimeType,
  formatBytes,
  formatRecordingDuration,
  recordingFormatSupported,
  saveRecording,
} from '../services/video-recorder.js';

class FakeTrack {
  constructor(settings = {}) {
    this.settings = settings;
    this.listeners = new Map();
    this.stopped = false;
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  getSettings() { return this.settings; }
  stop() { this.stopped = true; }
  end() { this.listeners.get('ended')?.(); }
}

class FakeMediaRecorder {
  static isTypeSupported(type) { return type.startsWith('video/webm'); }
  constructor(stream, options = {}) {
    this.stream = stream;
    this.state = 'inactive';
    this.mimeType = options.mimeType || 'video/webm';
  }
  start(timeslice) { this.timeslice = timeslice; this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recorded-video'], { type: this.mimeType }) });
    queueMicrotask(() => this.onstop?.());
  }
}

class FakeMultiFormatRecorder extends FakeMediaRecorder {
  static isTypeSupported(type) {
    return type === 'video/mp4;codecs=avc1' || type === 'video/webm;codecs=vp9,opus';
  }
}

class MemoryFileHandle {
  value = null;
  async createWritable() {
    return {
      write: async value => { this.value = value; },
      close: async () => {},
    };
  }
}

class MemoryDirectoryHandle {
  constructor(name = '') { this.name = name; this.directories = new Map(); this.files = new Map(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    if (this.directories.has(name)) return this.directories.get(name);
    if (!create) { const error = new Error('missing'); error.name = 'NotFoundError'; throw error; }
    const directory = new MemoryDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory;
  }
  async getFileHandle(name, { create = false } = {}) {
    if (this.files.has(name)) return this.files.get(name);
    if (!create) { const error = new Error('missing'); error.name = 'NotFoundError'; throw error; }
    const file = new MemoryFileHandle();
    this.files.set(name, file);
    return file;
  }
}

test('format negotiation and human-readable labels are deterministic', () => {
  assert.equal(chooseRecordingMimeType(FakeMediaRecorder), 'video/webm;codecs=vp9,opus');
  assert.equal(chooseRecordingMimeType(FakeMultiFormatRecorder), 'video/mp4;codecs=avc1');
  assert.equal(chooseRecordingMimeType(FakeMultiFormatRecorder, 'webm'), 'video/webm;codecs=vp9,opus');
  assert.equal(recordingFormatSupported('mp4', FakeMultiFormatRecorder), true);
  assert.equal(recordingFormatSupported('mp4', FakeMediaRecorder), false);
  assert.equal(extensionForMimeType('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extensionForMimeType('video/webm'), 'webm');
  assert.equal(formatRecordingDuration(3_725_000), '1:02:05');
  assert.equal(formatBytes(5 * 1024 ** 2), '5.0 MB');
});

test('display recording session accounts for pauses and reports source details', async () => {
  let clock = 1_000;
  let requestedOptions = null;
  const videoTrack = new FakeTrack({ width: 1440, height: 900, frameRate: 30, displaySurface: 'browser' });
  const audioTrack = new FakeTrack();
  const stream = {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [audioTrack],
    getTracks: () => [videoTrack, audioTrack],
  };
  const mediaDevices = {
    getDisplayMedia: async options => { requestedOptions = options; return stream; },
  };

  const session = await createDisplayRecordingSession(
    { includeAudio: true, frameRate: 30, timesliceMs: 250 },
    { mediaDevices, MediaRecorderClass: FakeMediaRecorder, BlobClass: Blob, now: () => clock },
  );
  assert.equal(session.state, 'inactive');
  assert.equal(requestedOptions.preferCurrentTab, true);
  assert.equal(requestedOptions.audio.suppressLocalAudioPlayback, false);

  session.start();
  clock = 4_000;
  session.pause();
  clock = 7_000;
  session.resume();
  clock = 9_000;
  const result = await session.stop();

  assert.equal(result.durationMs, 5_000);
  assert.equal(result.width, 1440);
  assert.equal(result.height, 900);
  assert.equal(result.displaySurface, 'browser');
  assert.equal(result.audio, true);
  assert.equal(result.sizeBytes, 14);
  assert.equal(videoTrack.stopped, true);
  assert.equal(audioTrack.stopped, true);
});

test('recordings save append-only with sibling video and metadata files', async () => {
  const app = new MemoryDirectoryHandle('test-app');
  const blob = new Blob(['video-data'], { type: 'video/webm' });
  const recording = {
    blob,
    mimeType: 'video/webm',
    extension: 'webm',
    startedAt: '2026-08-14T10:00:00.000Z',
    durationMs: 12_500,
    width: 1280,
    height: 720,
    frameRate: 30,
    displaySurface: 'browser',
    audio: false,
  };
  const options = {
    appId: 'test-app',
    appTitle: 'Test App',
    title: 'My Demo',
    sourceArtefactId: 'sketch-7',
    route: '#/create',
    metadata: { seed: 42 },
  };
  const dependencies = { now: () => new Date('2026-08-14T11:00:00.000Z'), random: () => 0 };

  const first = await saveRecording(app, recording, options, dependencies);
  const second = await saveRecording(app, recording, options, dependencies);
  assert.notEqual(first.id, second.id);
  assert.equal(second.id, `${first.id}-2`);

  const recordings = app.directories.get('recordings');
  const folder = recordings.directories.get(first.id);
  assert.equal(folder.files.get('recording.webm').value, blob);
  const metadata = JSON.parse(folder.files.get('metadata.json').value);
  assert.equal(metadata.sourceArtefactId, 'sketch-7');
  assert.equal(metadata.durationMs, 12_500);
  assert.equal(metadata.context.seed, 42);
  assert.equal(metadata.filename, 'recording.webm');
});

test('MP4 recordings retain an upload-friendly MP4 filename and MIME type', async () => {
  const app = new MemoryDirectoryHandle('mp4-app');
  const blob = new Blob(['mp4-video'], { type: 'video/mp4;codecs=avc1' });
  const saved = await saveRecording(app, {
    blob,
    mimeType: blob.type,
    extension: 'mp4',
    requestedFormat: 'mp4',
    startedAt: '2026-08-14T10:00:00.000Z',
  }, {
    appId: 'mp4-app',
    title: 'Upload Demo',
  }, {
    now: () => new Date('2026-08-14T11:00:00.000Z'),
    random: () => 0.5,
  });

  assert.equal(saved.filename, 'recording.mp4');
  assert.equal(saved.metadata.mimeType, 'video/mp4;codecs=avc1');
  assert.equal(saved.metadata.requestedFormat, 'mp4');
  const folder = app.directories.get('recordings').directories.get(saved.id);
  assert.equal(folder.files.get('recording.mp4').value, blob);
});
