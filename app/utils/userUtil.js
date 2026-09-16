import { getValue, setValue } from "../services/repository";
import { getPageServices } from "./pageWindow";

export const getUserPlatform = () => {
  let platform = getValue("userPlatform");
  if (platform) return platform;

  try {
    const services = getPageServices();
    const user = services && services.User && services.User.getUser();
    const persona =
      user && typeof user.getSelectedPersona === "function"
        ? user.getSelectedPersona()
        : null;
    if (persona && persona.isPC) {
      setValue("userPlatform", "pc");
      return "pc";
    }
  } catch (e) {}

  setValue("userPlatform", "ps");
  return "ps";
};

export const updateUserCredits = () => {
  return new Promise((resolve) => {
    try {
      const services = getPageServices();
      if (!services || !services.User || typeof services.User.requestCurrencies !== "function") {
        resolve();
        return;
      }
      services.User.requestCurrencies().observe(this, function () {
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
};
