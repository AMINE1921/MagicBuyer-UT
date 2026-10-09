import { getPage } from "../core/page";

// Même suite d'évènements qu'un vrai clic : pointerdown, mousedown, pointerup, mouseup, click.
export const tapElement = (el) => {
  if (!el) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  };
  const page = getPage();
  const Pointer = (page && page.PointerEvent) || (typeof PointerEvent === "function" ? PointerEvent : null);
  const Mouse = (page && page.MouseEvent) || MouseEvent;
  const pointer = (type, buttons) =>
    Pointer ? el.dispatchEvent(new Pointer(type, Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true, buttons }, base))) : true;
  pointer("pointerdown", 1);
  el.dispatchEvent(new Mouse("mousedown", Object.assign({ buttons: 1 }, base)));
  pointer("pointerup", 0);
  el.dispatchEvent(new Mouse("mouseup", Object.assign({ buttons: 0 }, base)));
  el.dispatchEvent(new Mouse("click", Object.assign({ buttons: 0 }, base)));
  return true;
};
