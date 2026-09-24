// Lecture des champs "plage" : "6-10", "7.5", "20-40S", "1-2H", "5M", "1D".

const UNIT_SECONDS = { S: 1, M: 60, H: 3600, D: 86400, J: 86400 };

const cleanNumber = (text) => parseFloat(String(text).replace(",", "."));

// Retourne { min, max } en secondes (ou en unités brutes si unit = null), ou null si invalide.
export const parseRange = (value, defaultUnit = "S") => {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    const factor = defaultUnit ? UNIT_SECONDS[defaultUnit] || 1 : 1;
    return { min: value * factor, max: value * factor };
  }
  const text = String(value).trim().toUpperCase().replace(/\s+/g, "");
  if (!text) {
    return null;
  }
  const match = text.match(/^(\d+(?:[.,]\d+)?)(?:-(\d+(?:[.,]\d+)?))?([SMHDJ])?$/);
  if (!match) {
    return null;
  }
  const unit = match[3] || defaultUnit;
  const factor = unit ? UNIT_SECONDS[unit] || 1 : 1;
  let min = cleanNumber(match[1]);
  let max = match[2] != null ? cleanNumber(match[2]) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  if (max < min) {
    const swap = min;
    min = max;
    max = swap;
  }
  return { min: min * factor, max: max * factor };
};

export const isValidRange = (value, defaultUnit = "S") =>
  parseRange(value, defaultUnit) !== null;

export const randomBetween = (min, max) => {
  if (!(max > min)) {
    return min;
  }
  return min + Math.random() * (max - min);
};

// Valeur aléatoire en secondes dans la plage (0 si vide/invalide).
export const pickSeconds = (value, defaultUnit = "S") => {
  const range = parseRange(value, defaultUnit);
  return range ? randomBetween(range.min, range.max) : 0;
};

// Entier aléatoire dans la plage (ex. "15-25" recherches), 0 si vide.
export const pickInt = (value) => {
  const range = parseRange(value, null);
  if (!range) {
    return 0;
  }
  const min = Math.round(range.min);
  const max = Math.round(range.max);
  return min + Math.floor(Math.random() * (max - min + 1));
};

export const describeRange = (value, defaultUnit = "S") => {
  const range = parseRange(value, defaultUnit);
  if (!range) {
    return "—";
  }
  const fmt = (seconds) => {
    if (seconds >= 3600) {
      return `${+(seconds / 3600).toFixed(2)} h`;
    }
    if (seconds >= 60) {
      return `${+(seconds / 60).toFixed(1)} min`;
    }
    return `${+seconds.toFixed(1)} s`;
  };
  return range.min === range.max
    ? fmt(range.min)
    : `${fmt(range.min)} à ${fmt(range.max)}`;
};

export const formatDuration = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};
