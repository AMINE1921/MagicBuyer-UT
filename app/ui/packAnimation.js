import { pageGlobal } from "../core/page";
import { getSettings } from "../core/settings";

// Ouverture des packs sans l'animation EA (réglage Outils → Packs) : la méthode EA runAnimation
// programme la fin de l'animation (runCallback) dans un minuteur ; on avance ce minuteur à tout de
// suite. runAnimation n'appelle pas this.superclass() (vérifié sur le web app FC 27) : l'enrober ne
// casse pas l'héritage EA. Si une future version d'EA l'appelle, le crochet n'est pas posé.

let hooked = false;

export const hookPackAnimation = () => {
  if (hooked) {
    return true;
  }
  const Controller = pageGlobal("UTPackAnimationViewController");
  const proto = Controller && Controller.prototype;
  if (!proto || typeof proto.runAnimation !== "function" || typeof proto.runCallback !== "function") {
    return false;
  }
  hooked = true;
  if (proto.__mbSkipAnimation || /superclass\s*\(/.test(String(proto.runAnimation))) {
    return true;
  }
  const original = proto.runAnimation;
  proto.runAnimation = function () {
    const result = original.apply(this, arguments);
    try {
      if (getSettings().packs.skipAnimation) {
        clearTimeout(this.animationTimeout);
        this.animationTimeout = setTimeout(() => this.runCallback(), 0);
      }
    } catch (e) {}
    return result;
  };
  proto.__mbSkipAnimation = true;
  return true;
};
