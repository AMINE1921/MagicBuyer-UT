export const escapeHtml = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const qs = (root, selector) => (root ? root.querySelector(selector) : null);
export const qsa = (root, selector) => (root ? Array.from(root.querySelectorAll(selector)) : []);

export const fromHtml = (html) => {
  const template = document.createElement("template");
  template.innerHTML = String(html).trim();
  return template.content.firstElementChild;
};

// Ne touche au DOM que si le contenu change (évite les boucles de mutations).
export const setText = (el, text) => {
  if (el && el.textContent !== String(text)) {
    el.textContent = String(text);
  }
};

export const setHtml = (el, html) => {
  if (el && el.__mbHtml !== html) {
    el.__mbHtml = html;
    el.innerHTML = html;
  }
};

export const toggleClass = (el, name, on) => {
  if (el && el.classList.contains(name) !== !!on) {
    el.classList.toggle(name, !!on);
  }
};

export const debounce = (fn, wait) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

export const formatTime = (timestamp) =>
  new Date(timestamp).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
