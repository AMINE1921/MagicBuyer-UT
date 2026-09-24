import { sendExternalRequest } from "../services/externalRequest";
import { playTone } from "./audio";
import { eaToast } from "./page";
import { getSettings } from "./settings";

// Notifications : son, bureau, Discord (webhook), Telegram, toast EA.

export const sound = (kind) => {
  const settings = getSettings().notify;
  if (!settings.sound) {
    return false;
  }
  return playTone(kind, settings.volume);
};

const desktop = (title, body) => {
  try {
    if (
      getSettings().notify.desktop &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      const note = new Notification(title, { body, silent: true });
      setTimeout(() => note.close(), 8000);
    }
  } catch (e) {}
};

export const requestDesktopPermission = async () => {
  try {
    if (typeof Notification === "undefined") {
      return "unsupported";
    }
    if (Notification.permission === "granted" || Notification.permission === "denied") {
      return Notification.permission;
    }
    return await Notification.requestPermission();
  } catch (e) {
    return "denied";
  }
};

const post = (url, body) =>
  new Promise((resolve) => {
    sendExternalRequest({
      method: "POST",
      url,
      identifier: `notify_${Date.now()}`,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(body),
      onload: (res) => resolve(res && res.status >= 200 && res.status < 300),
    });
  });

const COLORS = { buy: 3066993, fail: 15158332, list: 3447003, stop: 15105570, alert: 15158332, test: 10181046 };

const sendDiscord = (message, kind) => {
  const url = String(getSettings().notify.discordWebhook || "").trim();
  if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(url)) {
    return Promise.resolve(false);
  }
  return post(url, {
    username: "MagicBuyer",
    embeds: [
      {
        description: message,
        color: COLORS[kind] || COLORS.test,
        footer: { text: `MagicBuyer · ${new Date().toLocaleTimeString("fr-FR")}` },
      },
    ],
  });
};

const sendTelegram = (message) => {
  const { telegramToken, telegramChatId } = getSettings().notify;
  const token = String(telegramToken || "").trim();
  const chatId = String(telegramChatId || "").trim();
  if (!/^\d+:[\w-]+$/.test(token) || !chatId) {
    return Promise.resolve(false);
  }
  return post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true,
  });
};

const EVENT_TOGGLES = { buy: "onBuy", fail: "onFail", list: "onList", stop: "onStop", alert: "onStop" };

// kind : buy | fail | list | stop | alert | test
export const notifyEvent = (kind, message, { toast = false, negative = false } = {}) => {
  const settings = getSettings().notify;
  const toggle = EVENT_TOGGLES[kind];
  const wanted = kind === "test" || kind === "alert" || !!(toggle && settings[toggle]);
  if (kind === "buy" || kind === "alert" || kind === "stop" || (kind !== "test" && wanted)) {
    sound(kind);
  }
  if (toast) {
    eaToast(message, negative);
  }
  if (!wanted) {
    return Promise.resolve([]);
  }
  desktop("MagicBuyer", message);
  return Promise.all([sendDiscord(message, kind), sendTelegram(message)]);
};
