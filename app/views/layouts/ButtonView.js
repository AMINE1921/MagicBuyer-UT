import { getTapEvent } from "../../utils/eaCompat";

export const createButton = function (text, callBack, customClass) {
  if (typeof UTStandardButtonControl === "function") {
    const stdButton = new UTStandardButtonControl();
    stdButton.init();
    const tap =
      typeof EventType !== "undefined" && EventType.TAP != null
        ? EventType.TAP
        : getTapEvent();
    stdButton.addTarget(stdButton, callBack, tap);
    stdButton.setText(text);

    if (customClass) {
      const classes = customClass.split(" ");
      for (let cl of classes) stdButton.getRootElement().classList.add(cl);
    }

    return stdButton;
  }

  const el = document.createElement("button");
  el.type = "button";
  el.className = `btn-standard ${customClass || ""}`.trim();
  el.textContent = text;
  el.addEventListener("click", callBack);
  return {
    __root: el,
    getRootElement: () => el,
  };
};
