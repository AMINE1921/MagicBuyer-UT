// Sons générés (WebAudio) + maintien de l'onglet actif en arrière-plan.
// Aucun fichier externe : rien ne peut échouer au chargement.

let context = null;
let keepAliveNodes = null;

const getContext = () => {
  if (context) {
    return context;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    context = Ctor ? new Ctor() : null;
  } catch (e) {
    context = null;
  }
  return context;
};

// À appeler depuis un clic (Démarrer, tester le son) : Chrome exige un geste utilisateur.
export const unlockAudio = () => {
  const ctx = getContext();
  if (ctx && ctx.state === "suspended" && typeof ctx.resume === "function") {
    ctx.resume().catch(() => {});
  }
  return ctx;
};

const PATTERNS = {
  buy: [
    [660, 0.09],
    [880, 0.09],
    [1320, 0.16],
  ],
  fail: [
    [300, 0.12],
    [220, 0.16],
  ],
  list: [
    [740, 0.08],
    [990, 0.1],
  ],
  sold: [
    [880, 0.08],
    [1175, 0.08],
    [1568, 0.14],
  ],
  listfail: [
    [440, 0.1],
    [330, 0.14],
  ],
  stop: [
    [520, 0.12],
    [390, 0.12],
    [260, 0.2],
  ],
  alert: [
    [980, 0.14],
    [640, 0.14],
    [980, 0.14],
    [640, 0.14],
    [980, 0.14],
    [640, 0.24],
  ],
};

export const playTone = (kind, volume = 0.6) => {
  const ctx = unlockAudio();
  const pattern = PATTERNS[kind];
  if (!ctx || !pattern) {
    return false;
  }
  try {
    let at = ctx.currentTime + 0.02;
    const level = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.25;
    pattern.forEach(([frequency, duration]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "alert" ? "square" : "sine";
      osc.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + duration + 0.02);
      at += duration + 0.03;
    });
    return true;
  } catch (e) {
    return false;
  }
};

// Chrome ralentit fortement les minuteurs d'un onglet caché (1 réveil par minute après
// 5 min). Un signal audio quasi nul (inaudible) garde l'onglet "actif" pendant le bot.
export const startKeepAlive = () => {
  const ctx = unlockAudio();
  if (!ctx || keepAliveNodes) {
    return !!keepAliveNodes;
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 20;
    gain.gain.value = 0.0008;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    keepAliveNodes = { osc, gain };
    return true;
  } catch (e) {
    keepAliveNodes = null;
    return false;
  }
};

export const stopKeepAlive = () => {
  if (!keepAliveNodes) {
    return;
  }
  try {
    keepAliveNodes.osc.stop();
    keepAliveNodes.osc.disconnect();
    keepAliveNodes.gain.disconnect();
  } catch (e) {}
  keepAliveNodes = null;
};
