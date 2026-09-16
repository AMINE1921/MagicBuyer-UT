import { initDatabase } from "../utils/dbUtil";
import { xmlRequestOverride } from "./NetworkIntercepts";
import { sideBarNavOverride } from "./sidebarnav-override";
import { topNavOverride } from "./topnav-override";

import "./network-override";

export const initOverrides = () => {
  initDatabase();
  sideBarNavOverride();
  try {
    typeof isPhone === "function" && isPhone() && topNavOverride();
  } catch (e) {
    console.warn("[MagicBuyer] topNavOverride", e);
  }
  try {
    xmlRequestOverride();
  } catch (e) {
    console.warn("[MagicBuyer] xmlRequestOverride", e);
  }
};
