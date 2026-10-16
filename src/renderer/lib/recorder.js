// Records the stage canvas + microphone, one take per slide, streamed to disk every second.
const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MIN_TAKE_MS = 700; // shorter takes are accidental clicks and are discarded

export function pickMime() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export class TakeRecorder {
  constructor(canvas, audioTrack, api = window.api) {
    this.api = api;
    this.videoTrack = canvas.captureStream(30).getVideoTracks()[0];
    this.stream = new MediaStream([this.videoTrack, audioTrack]);
    this.mimeType = pickMime();
  }

  setAudioTrack(track) {
    for (const t of this.stream.getAudioTracks()) this.stream.removeTrack(t);
    this.stream.addTrack(track);
  }

  /**
   * Start recording a take right away (synchronously), so switching slides leaves no gap.
   * The disk file is opened in parallel and chunks wait for it.
   */
  start(dir, index) {
    const rec = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 6_000_000,
      audioBitsPerSecond: 128_000,
    });
    const token = this.api.beginTake(dir, index);
    const take = { index, rec, token, queue: token.then(() => {}), startedAt: performance.now(), failed: null };
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const blob = e.data;
      take.queue = take.queue
        .then(async () => this.api.takeChunk(await token, await blob.arrayBuffer()))
        .catch((err) => {
          take.failed = err;
        });
    };
    take.stopped = new Promise((resolve) => {
      rec.onstop = resolve;
    });
    rec.start(1000);
    return take;
  }

  elapsed(take) {
    return performance.now() - take.startedAt;
  }

  /** Stop a take and save it. Resolves to the updated project, or null if discarded. */
  async stop(take, { discard = false } = {}) {
    const durationMs = performance.now() - take.startedAt;
    if (take.rec.state !== 'inactive') take.rec.stop();
    await take.stopped;
    await take.queue;
    const token = await take.token;
    if (discard || take.failed || durationMs < MIN_TAKE_MS) {
      await this.api.abortTake(token);
      if (take.failed) throw take.failed;
      return null;
    }
    return this.api.finishTake(token, durationMs);
  }
}
