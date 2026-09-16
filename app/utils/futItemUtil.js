import { getPageServices, getPageWindow } from "./pageWindow";

export const getCardName = (card) => {
  try {
    const services = getPageServices();
    const translationService = services && services.Localization;
    if (!translationService) {
      return (card && card._staticData && card._staticData.name) || "";
    }
    if (typeof card.isManagerContract === "function" && card.isManagerContract()) {
      return translationService.localize("card.title.managercontracts");
    }
    if (typeof card.isPlayerContract === "function" && card.isPlayerContract()) {
      return translationService.localize("card.title.playercontracts");
    }
    if (typeof card.isStyleModifier === "function" && card.isStyleModifier()) {
      const page = getPageWindow();
      const util = page.UTLocalizationUtil || window.UTLocalizationUtil;
      if (util && typeof util.playStyleIdToName === "function") {
        return util.playStyleIdToName(card.subtype, translationService);
      }
    }
    if (
      typeof card.isPlayerPositionModifier === "function" &&
      card.isPlayerPositionModifier()
    ) {
      return translationService
        .localize(
          "card.desc.training.pos." +
            card._staticData.trainPosFrom +
            "_" +
            card._staticData.trainPosTo
        )
        .replace(" >> ", "->");
    }
    return (card._staticData && card._staticData.name) || "";
  } catch (e) {
    return (card && card._staticData && card._staticData.name) || "";
  }
};

export const checkRating = (
  cardRating,
  permittedRatingMin,
  permittedRatingMax
) => cardRating >= permittedRatingMin && cardRating <= permittedRatingMax;
