// Live microphone level (0..1) for the level bar and the "I can't hear you" warning.

export function createMeter(stream) {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  return {
    /** Peak absolute sample of the last ~20 ms. */
    peak() {
      analyser.getFloatTimeDomainData(buf);
      let p = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > p) p = v;
      }
      return p;
    },
    /** Perceptual 0..1 level for display (dB scaled, -60 dB .. 0 dB). */
    level() {
      const p = this.peak();
      if (p <= 0) return 0;
      const db = 20 * Math.log10(p);
      return Math.max(0, Math.min(1, (db + 60) / 60));
    },
    close() {
      source.disconnect();
      ctx.close();
    },
  };
}
