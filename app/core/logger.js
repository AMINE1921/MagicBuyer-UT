import { t } from "../i18n";
import { addLog } from "./state";

const write = (type, text, meta) => {
  if (type === "error") {
    try {
      console.warn("[MagicBuyer]", text);
    } catch (e) {}
  }
  return addLog(type, text, meta);
};

export const log = {
  info: (text, meta) => write("info", text, meta),
  success: (text, meta) => write("success", text, meta),
  warn: (text, meta) => write("warning", text, meta),
  error: (text, meta) => write("error", text, meta),
  buy: (text, meta) => write("buy", text, meta),
  search: (text, meta) => write("search", text, meta),
};

export const errorMessage = (e) =>
  (e && (e.message || e.statusText || e.status)) || String(e || t("misc.errUnknown"));
