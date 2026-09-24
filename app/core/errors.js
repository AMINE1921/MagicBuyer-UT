import { errorCode } from "./page";

// Classement des réponses d'erreur UTAS de FC 27.
export const KIND = {
  CAPTCHA: "captcha",
  AUTH: "auth",
  BANNED: "banned",
  LOCKED: "locked",
  RATE: "rate",
  BLOCKED: "blocked",
  GONE: "gone",
  FUNDS: "funds",
  FULL: "full",
  TIMEOUT: "timeout",
  OTHER: "other",
};

export const responseCode = (response) => {
  if (!response) {
    return 0;
  }
  const fromError = Number(response.error && response.error.code);
  if (fromError) {
    return fromError;
  }
  return Number(response.status) || 0;
};

export const classify = (response) => {
  const code = responseCode(response);
  if (response && response.timeout) {
    return { code, kind: KIND.TIMEOUT, label: "pas de réponse d'EA (délai dépassé)" };
  }
  if (code === errorCode("CAPTCHA_REQUIRED")) {
    return { code, kind: KIND.CAPTCHA, label: "captcha demandé par EA" };
  }
  if (code === 401) {
    return { code, kind: KIND.AUTH, label: "session EA expirée" };
  }
  if (code === errorCode("ACCOUNT_BANNED") || code === errorCode("UNRECOVERABLE")) {
    return { code, kind: KIND.BANNED, label: "compte bloqué par EA" };
  }
  if (code === errorCode("LOCKED_TRANSFER_MARKET")) {
    return { code, kind: KIND.LOCKED, label: "marché des transferts verrouillé (soft ban)" };
  }
  if (code === 429) {
    return { code, kind: KIND.RATE, label: "trop de requêtes" };
  }
  if (code === 512 || code === 521) {
    return { code, kind: KIND.BLOCKED, label: "EA bloque temporairement les requêtes" };
  }
  if (
    code === errorCode("PERMISSION_DENIED") ||
    code === errorCode("NO_TRADE_EXISTS") ||
    code === 426 ||
    code === 409
  ) {
    return { code, kind: KIND.GONE, label: "carte déjà partie (achetée ou expirée)" };
  }
  if (code === errorCode("NOT_ENOUGH_CREDIT")) {
    return { code, kind: KIND.FUNDS, label: "coins insuffisants" };
  }
  if (code === errorCode("DESTINATION_FULL")) {
    return { code, kind: KIND.FULL, label: "pile de destination pleine (non attribués / transferts)" };
  }
  return { code, kind: KIND.OTHER, label: code ? `erreur ${code}` : "erreur inconnue" };
};

// Erreurs qui doivent arrêter le bot immédiatement.
export const isFatal = (kind) =>
  kind === KIND.CAPTCHA || kind === KIND.AUTH || kind === KIND.BANNED || kind === KIND.LOCKED;

export const parseCodeList = (text) =>
  new Set(
    String(text || "")
      .split(/[\s,;]+/)
      .map((part) => parseInt(part, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
