import { getPage } from "./core/page";

// Valeurs du web app FC 27 (lues dans la page, avec repli sur les valeurs connues).
export const DEFAULT_FUT_YEAR = "2027";
export const DEFAULT_FUT_GUID = "27A3C9F1-6B2E-4D7A-8C1F-2E9B5A4D6C7E";
export const DEFAULT_FUT_RESOURCE_ROOT = "https://www.ea.com";
export const DEFAULT_FUT_RESOURCE_BASE = "/ea-sports-fc/ultimate-team/web-app/content/";

const pageValue = (key, fallback) => {
  try {
    return getPage()[key] || fallback;
  } catch (e) {
    return fallback;
  }
};

export const getFutYear = () => pageValue("fut_year", DEFAULT_FUT_YEAR);
export const getFutGuid = () => pageValue("fut_guid", DEFAULT_FUT_GUID);
export const getFutResourceRoot = () => pageValue("fut_resourceRoot", DEFAULT_FUT_RESOURCE_ROOT);
export const getFutResourceBase = () => pageValue("fut_resourceBase", DEFAULT_FUT_RESOURCE_BASE);
export const getFutShortYear = () => String(getFutYear()).slice(-2);
