import { initOverrides } from "../function-overrides";
import { cssOverride } from "../function-overrides/css-override";
import { hookEaSearchCapture } from "./buyerContext";
import { ensureMagicBuyerChrome } from "./chromeOnly";

let booted = false;

export const bootMagicBuyer = () => {
  ensureMagicBuyerChrome();
  if (booted) {
    return;
  }
  booted = true;
  try {
    cssOverride();
  } catch (e) {
    console.warn("[MagicBuyer] cssOverride", e);
  }
  try {
    initOverrides();
  } catch (e) {
    console.error("[MagicBuyer] initOverrides", e);
  }
  try {
    hookEaSearchCapture();
  } catch (e) {}
};
