# Traduction de l'interface MagicBuyer (fr + en)

- Import : `import { t, plural } from "<chemin relatif>/i18n";` (module `app/i18n/index.js`).
- `t("zone.cle", { param })` renvoie le texte dans la langue du compte FC (anglais par défaut pour les langues absentes).
- Dictionnaires par zone : `app/i18n/<zone>.js` → `export default { fr: { "zone.cle": "…" }, en: { "zone.cle": "…" } };`
- Paramètres : `{nom}` dans le texte. Une valeur peut être une fonction `(p) => texte` pour les tournures complexes.
- Pluriels : `plural(n, "zone.cleUn", "zone.clePlusieurs", params)` (le nombre est disponible sous `{n}`).
- Le français est la référence : texte identique à l'ancien texte en dur. L'anglais est une traduction naturelle et concise.
- Textes calculés au chargement du module (constantes, listes d'options) : les transformer en fonctions appelées au rendu,
  pour que le changement de langue soit pris en compte.
- Ne pas traduire : identifiants de code, classes CSS, attributs data-*, expressions régulières de lecture des pages EA/FUTBIN,
  noms propres (FUTBIN, EA, MagicBuyer), commentaires du code.
