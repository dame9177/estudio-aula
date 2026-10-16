// Pure device selection rules (unit tested). The DOM side lives in devices.js.

const INFRARED = /\bIR\b|infra-?red|infravermelh/i;

export function isInfrared(label = '') {
  return INFRARED.test(label);
}

/** Cameras usable for a face bubble: drop IR sensors (Windows Hello style), they give a black/grey image. */
export function usableCameras(devices) {
  return devices.filter((d) => d.kind === 'videoinput' && !isInfrared(d.label));
}

/** Microphones, without the "Default"/"Communications" aliases when real entries exist. */
export function usableMics(devices) {
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const real = mics.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications');
  return real.length ? real : mics;
}

/**
 * Choose a device: the saved one (by id, then by label, since ids can change after a reboot),
 * else the first usable one.
 */
export function pickDevice(list, saved) {
  if (!list.length) return null;
  if (saved) {
    const byId = list.find((d) => d.deviceId === saved.id);
    if (byId) return byId;
    const byLabel = saved.label && list.find((d) => d.label === saved.label);
    if (byLabel) return byLabel;
  }
  return list[0];
}

/** Friendly pt-BR explanation for a getUserMedia error. */
export function humanMediaError(err, kind) {
  const what = kind === 'video' ? 'a câmera' : 'o microfone';
  const name = err?.name || '';
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `Não consegui ligar ${what}. Ela pode estar sendo usada por outro programa (Meet, Zoom, navegador). Feche-o e clique em “Tentar de novo”.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return `Não encontrei ${what}. Confira se está conectad${kind === 'video' ? 'a' : 'o'} e clique em “Tentar de novo”.`;
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `O sistema bloqueou ${what}. Verifique em Configurações → Privacidade se o acesso está liberado.`;
  }
  return `Algo deu errado com ${what} (${name || 'erro desconhecido'}). Clique em “Tentar de novo”.`;
}
