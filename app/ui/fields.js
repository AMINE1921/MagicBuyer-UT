import { getActiveFilter, getRotation, setRotation, updateFilter } from "../core/filters";
import { floorPrice, parseCoinsInput, stepPrice } from "../core/prices";
import { describeRange, isValidRange, parseRange } from "../core/ranges";
import { getSetting, setSetting } from "../core/settings";
import { t } from "../i18n";
import { escapeHtml, qsa } from "./dom";

// Liaison des champs : data-bind="s:chemin.du.reglage" (réglages), "f:champ" (filtre actif),
// "r:champ" (rotation des filtres). data-kind = price | int | float | range | text | toggle | select.

// Champs "virtuels" d'un filtre (ex. poste/zone combinés) : { read(filter), write(value) }.
const virtualFilter = {};

export const registerVirtualFilterFields = (map) => {
  Object.assign(virtualFilter, map);
};

const readBound = (bind) => {
  const [scope, path] = String(bind).split(":");
  if (scope === "s") {
    return getSetting(path);
  }
  if (scope === "f") {
    const filter = getActiveFilter();
    if (!filter) {
      return undefined;
    }
    return virtualFilter[path] ? virtualFilter[path].read(filter) : filter[path];
  }
  if (scope === "r") {
    return getRotation()[path];
  }
  return undefined;
};

const writeBound = (bind, value) => {
  const [scope, path] = String(bind).split(":");
  if (scope === "s") {
    setSetting(path, value);
  } else if (scope === "f") {
    const filter = getActiveFilter();
    if (filter) {
      updateFilter(
        filter.id,
        virtualFilter[path] ? virtualFilter[path].write(value, filter) : { [path]: value }
      );
    }
  } else if (scope === "r") {
    setRotation({ [path]: value });
  }
};

const hintHtml = (hint) => (hint ? `<p class="mb-hint">${hint}</p>` : "");
// Attributs du bloc d'un champ. showIf : "f:priceMode=futbin", "s:sell.priceMode!=fixed",
// plusieurs valeurs possibles "a|b" ; le champ est masqué quand la condition est fausse.
const fieldAttrs = (opts) =>
  `class="mb-field${opts.wide ? " is-wide" : ""}${opts.key ? " is-key" : ""}"${
    opts.showIf ? ` data-show-if="${escapeHtml(opts.showIf)}"` : ""
  }`;

export const section = (title, body) =>
  `<section class="mb-section">${title ? `<h4>${title}</h4>` : ""}${body}</section>`;

export const grid = (...fields) => `<div class="mb-grid">${fields.join("")}</div>`;

export const priceField = (opts) => `
  <div ${fieldAttrs(opts)}>
    <div class="mb-label"><span>${opts.label}</span><em data-extra="${opts.bind}"></em></div>
    <div class="mb-price">
      <button type="button" class="mb-step" data-step="-1" data-for="${opts.bind}" aria-label="${escapeHtml(t("target.fieldStepDown"))}">−</button>
      <input class="mb-input" data-bind="${opts.bind}" data-kind="price" inputmode="text" autocomplete="off" placeholder="${escapeHtml(opts.placeholder || t("target.fieldPricePlaceholder"))}" aria-label="${escapeHtml(opts.label)}" />
      <button type="button" class="mb-step" data-step="1" data-for="${opts.bind}" aria-label="${escapeHtml(t("target.fieldStepUp"))}">+</button>
    </div>
    ${hintHtml(opts.hint)}
  </div>`;

export const numberField = (opts) => `
  <div ${fieldAttrs(opts)}>
    <label class="mb-label"><span>${opts.label}</span></label>
    <input class="mb-input" data-bind="${opts.bind}" data-kind="${opts.float ? "float" : "int"}" inputmode="${opts.float ? "decimal" : "numeric"}" autocomplete="off" placeholder="${escapeHtml(opts.placeholder || "")}" aria-label="${escapeHtml(opts.label)}"${opts.min != null ? ` data-min="${opts.min}"` : ""}${opts.max != null ? ` data-max="${opts.max}"` : ""} />
    ${hintHtml(opts.hint)}
  </div>`;

export const rangeField = (opts) => `
  <div ${fieldAttrs(opts)}>
    <div class="mb-label"><span>${opts.label}</span><em data-extra="${opts.bind}"></em></div>
    <input class="mb-input" data-bind="${opts.bind}" data-kind="range" data-unit="${opts.unit == null ? "" : opts.unit}"${opts.optional ? ' data-optional="1"' : ""} autocomplete="off" placeholder="${escapeHtml(opts.placeholder || "")}" aria-label="${escapeHtml(opts.label)}" />
    ${hintHtml(opts.hint)}
  </div>`;

export const textField = (opts) => `
  <div ${fieldAttrs(opts)}>
    <label class="mb-label"><span>${opts.label}</span></label>
    <input class="mb-input" data-bind="${opts.bind}" data-kind="text" type="${opts.secret ? "password" : "text"}" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(opts.placeholder || "")}" aria-label="${escapeHtml(opts.label)}" />
    ${hintHtml(opts.hint)}
  </div>`;

export const toggleField = (opts) => `
  <div ${fieldAttrs(opts)}>
    <div class="mb-toggle-row">
      <span class="mb-label"><span>${opts.label}</span></span>
      <button type="button" class="mb-switch" role="switch" aria-checked="false" data-bind="${opts.bind}" data-kind="toggle" aria-label="${escapeHtml(opts.label)}"></button>
    </div>
    ${hintHtml(opts.hint)}
  </div>`;

export const selectField = (opts) => `
  <div ${fieldAttrs(opts)}>
    <label class="mb-label"><span>${opts.label}</span></label>
    <select class="mb-input" data-bind="${opts.bind}" data-kind="select"${opts.numeric ? ' data-numeric="1"' : ""}${opts.list ? ` data-ea-list="${escapeHtml(opts.list)}"` : ""} aria-label="${escapeHtml(opts.label)}">
      ${opts.options.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join("")}
    </select>
    ${hintHtml(opts.hint)}
  </div>`;

// ------------------------------------------------------------------ lecture

const parseInput = (el) => {
  const kind = el.dataset.kind;
  const raw = el.value;
  if (kind === "price") {
    // Toujours un prix EA valide, arrondi vers le bas (jamais au-dessus de la saisie).
    return { ok: true, value: floorPrice(parseCoinsInput(raw)) };
  }
  if (kind === "int") {
    // "2.5" ou "2,5" → 3 (arrondi), jamais 25 ; les espaces sont ignorés ("50 565 123").
    const parsed = parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
    let n = Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
    if (el.dataset.max != null) {
      n = Math.min(n, Number(el.dataset.max));
    }
    if (el.dataset.min != null && raw !== "") {
      n = Math.max(n, Number(el.dataset.min));
    }
    return { ok: true, value: n };
  }
  if (kind === "float") {
    const n = parseFloat(String(raw).replace(",", "."));
    return { ok: raw === "" || Number.isFinite(n), value: Number.isFinite(n) ? n : 0 };
  }
  if (kind === "range") {
    const text = String(raw).trim();
    if (!text) {
      return { ok: !!el.dataset.optional, value: "" };
    }
    return { ok: isValidRange(text, el.dataset.unit || null), value: text };
  }
  return { ok: true, value: String(raw) };
};

const displayValue = (el, value) => {
  const kind = el.dataset.kind;
  if (kind === "price" || kind === "int") {
    return value ? String(value) : "";
  }
  if (kind === "float") {
    return value || value === 0 ? String(value) : "";
  }
  return value == null ? "" : String(value);
};

const paintExtra = (root, el, value) => {
  const extra = root.querySelector(`[data-extra="${el.dataset.bind}"]`);
  if (!extra) {
    return;
  }
  const formatter = root.__mbExtras && root.__mbExtras[el.dataset.bind];
  if (formatter) {
    extra.textContent = formatter(value) || "";
  } else if (el.dataset.kind === "range") {
    if (!value) {
      extra.textContent = "";
    } else if (el.dataset.unit) {
      extra.textContent = describeRange(value, el.dataset.unit);
    } else {
      const range = parseRange(value, null);
      extra.textContent = range
        ? range.min === range.max
          ? `${+range.min.toFixed(2)}`
          : t("target.fieldRange", { min: +range.min.toFixed(2), max: +range.max.toFixed(2) })
        : "";
    }
  }
};

const setValidity = (el, ok) => {
  el.classList.toggle("is-invalid", !ok);
  el.setAttribute("aria-invalid", ok ? "false" : "true");
};

const matchesShowIf = (rule) => {
  const match = String(rule || "").match(/^(.+?)(!=|=)(.*)$/);
  if (!match) {
    return true;
  }
  const value = readBound(match[1]);
  const current = typeof value === "boolean" ? String(value) : String(value == null ? "" : value);
  const hit = match[3].split("|").includes(current);
  return match[2] === "=" ? hit : !hit;
};

// Affiche / masque les champs conditionnels (data-show-if).
export const refreshVisibility = (root) => {
  qsa(root, "[data-show-if]").forEach((el) => {
    const hidden = !matchesShowIf(el.dataset.showIf);
    if (el.hidden !== hidden) {
      el.hidden = hidden;
    }
  });
};

// Remet les champs à jour depuis les réglages (sans écraser le champ en cours de saisie).
export const refreshFields = (root) => {
  refreshVisibility(root);
  qsa(root, "[data-bind]").forEach((el) => {
    const value = readBound(el.dataset.bind);
    if (el.dataset.kind === "toggle") {
      const on = !!value;
      if (el.getAttribute("aria-checked") !== String(on)) {
        el.setAttribute("aria-checked", String(on));
      }
      el.textContent = on ? t("target.fieldOn") : t("target.fieldOff");
      return;
    }
    if (el === document.activeElement) {
      paintExtra(root, el, parseInput(el).value);
      return;
    }
    const text = displayValue(el, value);
    if (el.value !== text) {
      el.value = text;
    }
    setValidity(el, true);
    paintExtra(root, el, value);
  });
};

export const bindFields = (root, extras = {}) => {
  root.__mbExtras = Object.assign(root.__mbExtras || {}, extras);
  if (root.__mbFieldsBound) {
    refreshFields(root);
    return;
  }
  root.__mbFieldsBound = true;
  const commit = (el) => {
    const parsed = parseInput(el);
    setValidity(el, parsed.ok);
    paintExtra(root, el, parsed.value);
    if (parsed.ok) {
      writeBound(el.dataset.bind, parsed.value);
    }
  };
  // Pendant la frappe : validation et aperçu seulement. L'enregistrement se fait à la
  // validation (Entrée ou sortie du champ) : un bot en marche ne lit jamais une saisie à moitié tapée.
  root.addEventListener("input", (event) => {
    const el = event.target;
    if (!el || !el.dataset || !el.dataset.bind || el.dataset.kind === "select") {
      return;
    }
    const parsed = parseInput(el);
    setValidity(el, parsed.ok);
    paintExtra(root, el, parsed.value);
  });
  root.addEventListener("change", (event) => {
    const el = event.target;
    if (!el || !el.dataset || !el.dataset.bind) {
      return;
    }
    if (el.dataset.kind === "select") {
      writeBound(el.dataset.bind, el.dataset.numeric ? Number(el.value) : el.value);
      return;
    }
    commit(el);
  });
  root.addEventListener("focusout", (event) => {
    const el = event.target;
    if (el && el.dataset && el.dataset.bind && el.dataset.kind !== "toggle") {
      setTimeout(() => refreshFields(root), 0);
    }
  });
  root.addEventListener("keydown", (event) => {
    const el = event.target;
    if (event.key === "Enter" && el && el.dataset && el.dataset.bind) {
      el.blur();
    }
  });
  root.addEventListener("click", (event) => {
    const toggle = event.target.closest && event.target.closest('[data-kind="toggle"]');
    if (toggle && root.contains(toggle)) {
      writeBound(toggle.dataset.bind, !readBound(toggle.dataset.bind));
      refreshFields(root);
      return;
    }
    const step = event.target.closest && event.target.closest("[data-step]");
    if (step && root.contains(step)) {
      const input = root.querySelector(`[data-bind="${step.dataset.for}"]`);
      if (!input) {
        return;
      }
      const current = parseCoinsInput(input.value);
      const next = stepPrice(floorPrice(current) || current, Number(step.dataset.step));
      input.value = next ? String(next) : "";
      commit(input);
    }
  });
  refreshFields(root);
};
