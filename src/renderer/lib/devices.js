// Camera and microphone access, with the settings that make a voice lesson sound good.
import { usableCameras, usableMics, pickDevice } from './device-pick.js';

export async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return { cameras: usableCameras(all), mics: usableMics(all) };
}

export async function openCamera(deviceId) {
  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export async function openMic(deviceId) {
  const audio = {
    echoCancellation: false, // nothing is playing through the speakers while recording
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio, video: false });
}

/** Saved device if still present (by id, then label), else the first usable one. */
export function choose(list, saved) {
  return pickDevice(list, saved);
}

export function describe(track) {
  if (!track) return null;
  return { id: track.getSettings().deviceId, label: track.label };
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Silent audio track, so takes recorded without a microphone still have an audio stream. */
export function silentAudioTrack() {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  return dest.stream.getAudioTracks()[0];
}
