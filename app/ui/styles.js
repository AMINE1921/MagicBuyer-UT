export const STYLES = `
#mb-root, #mb-hud {
  --mb-bg: #0c121c;
  --mb-bg-2: #111a27;
  --mb-card: rgba(255,255,255,0.045);
  --mb-card-2: rgba(255,255,255,0.075);
  --mb-line: rgba(255,255,255,0.08);
  --mb-text: #e9eef6;
  --mb-muted: rgba(233,238,246,0.6);
  --mb-accent: #6ff5cf;
  --mb-accent-2: #3fd9e8;
  --mb-gold: #e2bc4a;
  --mb-ok: #3ee0a0;
  --mb-warn: #ffb020;
  --mb-err: #ff5d6c;
  --mb-info: #5aa7ff;
  --mb-radius: 12px;
  --mb-width: 468px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  letter-spacing: 0 !important;
  color: var(--mb-text);
}
#mb-root *, #mb-hud * {
  box-sizing: border-box;
  font-family: inherit !important;
  letter-spacing: 0 !important;
}
#mb-root [hidden], #mb-hud [hidden] {
  display: none !important;
}
#mb-root {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(var(--mb-width), 100vw);
  z-index: 2147483000;
  transform: translateX(105%);
  transition: transform 0.22s ease;
  pointer-events: none;
}
#mb-root.is-open {
  transform: translateX(0);
  pointer-events: auto;
}
/* Panneau ancré (écrans larges) : le web app EA garde toute sa largeur utile à côté du panneau
   (EA fixe width: 100 % sur ces blocs, d'où width: auto). 468px = --mb-width du panneau. */
@media (min-width: 1500px) {
  body.mb-open.mb-dock > main.ut-root-view,
  body.mb-open.mb-dock > .fc-header-view { width: auto !important; margin-right: 468px; }
  body.mb-open.mb-dock > #NotificationLayer { transform: translateX(-468px); }
}
#mb-root .mb-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(700px 260px at 0% -10%, rgba(63,217,232,0.16), transparent 60%),
    radial-gradient(500px 220px at 110% 0%, rgba(226,188,74,0.1), transparent 55%),
    linear-gradient(180deg, var(--mb-bg-2) 0%, var(--mb-bg) 100%);
  border-left: 1px solid rgba(111,245,207,0.22);
  box-shadow: -24px 0 60px rgba(0,0,0,0.5);
  overflow: hidden;
}
#mb-root button, #mb-hud button {
  font: inherit;
  cursor: pointer;
  border: 0;
  margin: 0;
  line-height: 1.2;
  text-transform: none;
  -webkit-appearance: none;
  appearance: none;
}
#mb-root button:focus-visible, #mb-root input:focus-visible, #mb-root select:focus-visible, #mb-hud button:focus-visible {
  outline: 2px solid var(--mb-accent-2);
  outline-offset: 2px;
}
#mb-root button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
/* ---------------- en-tête */
#mb-root .mb-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--mb-line);
}
#mb-root .mb-logo {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 13px;
  color: #06121a;
  background: linear-gradient(135deg, var(--mb-accent), var(--mb-gold));
}
#mb-root .mb-title {
  flex: 1;
  min-width: 0;
}
#mb-root .mb-title strong {
  display: block;
  font-size: 15px;
  font-weight: 750;
}
#mb-root .mb-title small {
  display: block;
  font-size: 11px;
  color: var(--mb-muted);
}
#mb-root .mb-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--mb-card-2);
  color: var(--mb-text);
  font-size: 16px;
  display: grid;
  place-items: center;
}
#mb-root .mb-icon-btn:hover {
  background: rgba(255,255,255,0.13);
}
/* ---------------- état + commandes */
#mb-root .mb-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 0;
}
#mb-root .mb-state {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--mb-card);
  border: 1px solid var(--mb-line);
}
#mb-root .mb-dot {
  width: 9px;
  height: 9px;
  flex: 0 0 9px;
  border-radius: 50%;
  background: #6b7686;
}
#mb-root [data-status="running"] .mb-dot { background: var(--mb-ok); box-shadow: 0 0 0 4px rgba(62,224,160,0.18); animation: mb-pulse 1.6s infinite; }
#mb-root [data-status="starting"] .mb-dot { background: var(--mb-accent-2); }
#mb-root [data-status="paused"] .mb-dot,
#mb-root [data-status="auto-pause"] .mb-dot { background: var(--mb-warn); }
#mb-root [data-status="cooldown"] .mb-dot { background: #ff8a3d; }
#mb-root [data-status="stopped"] .mb-dot { background: #8a93a3; }
@keyframes mb-pulse { 50% { box-shadow: 0 0 0 7px rgba(62,224,160,0.05); } }
#mb-root .mb-state-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
#mb-root .mb-state-text b {
  font-size: 13px;
  font-weight: 700;
}
#mb-root .mb-state-text small {
  font-size: 11px;
  color: var(--mb-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#mb-root .mb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  color: var(--mb-text);
  background: var(--mb-card-2);
}
#mb-root .mb-btn:hover { filter: brightness(1.12); }
#mb-root .mb-btn-start { background: linear-gradient(135deg, #12b886, var(--mb-accent)); color: #04150f; }
#mb-root .mb-btn-pause { background: #f59f00; color: #1b1100; }
#mb-root .mb-btn-stop { background: #e03131; color: #fff; }
#mb-root .mb-btn-primary { background: linear-gradient(135deg, var(--mb-accent), var(--mb-accent-2)); color: #041319; }
#mb-root .mb-btn-ghost { background: var(--mb-card-2); color: var(--mb-text); }
#mb-root .mb-btn-danger { background: rgba(255,93,108,0.14); color: #ff8e99; }
#mb-root .mb-btn-sm { min-height: 30px; padding: 6px 10px; font-size: 12px; border-radius: 8px; }
/* ---------------- KPIs */
#mb-root .mb-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 10px 14px 0;
}
#mb-root .mb-kpi {
  padding: 7px 8px;
  border-radius: 10px;
  background: var(--mb-card);
  border: 1px solid var(--mb-line);
  min-width: 0;
}
#mb-root .mb-kpi span {
  display: block;
  font-size: 10px;
  text-transform: uppercase;
  color: var(--mb-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#mb-root .mb-kpi strong {
  display: block;
  margin-top: 2px;
  font-size: 14px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#mb-root .mb-kpi.is-good strong { color: var(--mb-ok); }
#mb-root .mb-kpi small { display: block; margin-top: 1px; font-size: 10px; font-weight: 650; color: var(--mb-ok); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mb-root .mb-kpi small.is-bad { color: #ff8e99; }
#mb-root .mb-kpi small[hidden] { display: none; }
#mb-root .mb-filter-io { margin-top: 8px; padding: 8px; border-radius: 10px; background: var(--mb-card); border: 1px solid var(--mb-line); }
#mb-root .mb-filter-io[hidden] { display: none; }
#mb-root .mb-filter-io-text { width: 100%; min-height: 96px; resize: vertical; font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 4px 0 6px; }
#mb-root .mb-hint.is-warn { color: #ffb86b; }
#mb-root .mb-filter-stats { display: block; margin-top: 2px; color: var(--mb-accent) !important; font-variant-numeric: tabular-nums; }
#mb-root .mb-filter-stats[hidden] { display: none; }
.mb-pick-best { position: relative; outline: 3px solid #f7c948; outline-offset: 3px; border-radius: 6px; }
.mb-pick-best::after { content: attr(data-mb-pick-label); position: absolute; left: 50%; top: -22px; transform: translateX(-50%); padding: 2px 8px; border-radius: 10px; background: #f7c948; color: #1b1300; font: 700 11px/1.4 system-ui, sans-serif; white-space: nowrap; z-index: 5; pointer-events: none; }
#mb-root .mb-hotkeys tr.is-conflict td { color: #ffb86b; }
#mb-root .mb-hotkeys tr.is-conflict .mb-key { border-color: #ffb86b; }
#mb-root .mb-analysis { margin-top: 8px; display: grid; gap: 8px; }
#mb-root .mb-analysis .mb-stats-list .is-good b { color: var(--mb-ok); }
#mb-root .mb-analysis .mb-stats-list .is-bad b { color: #ff8e99; }
#mb-root .mb-analysis-buckets { display: flex; flex-wrap: wrap; gap: 6px; }
#mb-root .mb-analysis-table td.is-good { color: var(--mb-ok); }
#mb-root .mb-analysis-table td.is-bad { color: #ff8e99; }
#mb-root .mb-analysis-table .mb-tag { font-size: 9.5px; padding: 1px 5px; border-radius: 6px; background: var(--mb-card-2); color: var(--mb-muted); text-transform: uppercase; }
#mb-root .mb-kpi.is-bad strong { color: #ff8e99; }
/* ---------------- prochaine recherche */
#mb-root .mb-next {
  margin: 8px 14px 0;
  position: relative;
  height: 20px;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
  overflow: hidden;
}
#mb-root .mb-next-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: 0;
  background: linear-gradient(90deg, rgba(111,245,207,0.45), rgba(226,188,74,0.45));
}
#mb-root .mb-next-label {
  position: relative;
  display: block;
  text-align: center;
  font-size: 11px;
  line-height: 20px;
  color: var(--mb-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 8px;
}
/* ---------------- onglets */
#mb-root .mb-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
#mb-root .mb-tabs::-webkit-scrollbar { display: none; }
#mb-root .mb-tab {
  flex: 0 0 auto;
  padding: 7px 11px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--mb-muted);
  background: transparent;
}
#mb-root .mb-tab:hover { color: var(--mb-text); background: var(--mb-card); }
#mb-root .mb-tab.is-active { color: var(--mb-accent); background: rgba(111,245,207,0.12); }
#mb-root .mb-body {
  flex: 1;
  min-height: 90px;
  overflow-y: auto;
  padding: 10px 14px 14px;
}
#mb-root .mb-page { display: none; }
#mb-root .mb-page.is-active { display: block; }
/* ---------------- champs */
#mb-root .mb-section {
  margin: 0 0 12px;
}
#mb-root .mb-section > h4 {
  margin: 4px 0 8px;
  font-size: 11px;
  font-weight: 750;
  text-transform: uppercase;
  color: var(--mb-muted);
}
#mb-root .mb-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
#mb-root .mb-field {
  min-width: 0;
  padding: 9px 10px;
  border-radius: var(--mb-radius);
  background: var(--mb-card);
  border: 1px solid var(--mb-line);
}
#mb-root .mb-field.is-wide { grid-column: 1 / -1; }
#mb-root .mb-field.is-key { border-color: rgba(111,245,207,0.35); background: rgba(111,245,207,0.06); }
#mb-root .mb-field label, #mb-root .mb-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--mb-text);
}
#mb-root .mb-label em {
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  color: var(--mb-accent);
  white-space: nowrap;
}
#mb-root .mb-hint {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.35;
  color: var(--mb-muted);
}
#mb-root .mb-hint.is-error { color: #ff8e99; }
#mb-root input.mb-input, #mb-root select.mb-input, #mb-root textarea.mb-input {
  display: block;
  width: 100%;
  height: 34px;
  padding: 0 10px !important;
  margin: 0 !important;
  border-radius: 9px !important;
  border: 1px solid rgba(63,217,232,0.3) !important;
  background: #0a111b !important;
  color: var(--mb-accent) !important;
  font-size: 13.5px !important;
  font-weight: 600;
  outline: none;
  box-shadow: none !important;
  -webkit-appearance: none;
  appearance: none;
  opacity: 1 !important;
}
#mb-root select.mb-input {
  padding-right: 26px !important;
  background-image: linear-gradient(45deg, transparent 50%, var(--mb-accent) 50%), linear-gradient(135deg, var(--mb-accent) 50%, transparent 50%) !important;
  background-position: calc(100% - 14px) 15px, calc(100% - 9px) 15px !important;
  background-size: 5px 5px, 5px 5px !important;
  background-repeat: no-repeat !important;
}
#mb-root select.mb-input option { color: #e9eef6; background: #0a111b; }
#mb-root input.mb-input::placeholder { color: rgba(233,238,246,0.3) !important; font-weight: 500; }
#mb-root input.mb-input.is-invalid { border-color: var(--mb-err) !important; color: #ff8e99 !important; }
#mb-root input.mb-input:focus { border-color: var(--mb-accent) !important; }
#mb-root .mb-price {
  display: flex;
  gap: 6px;
}
#mb-root .mb-price .mb-input { flex: 1; min-width: 0; text-align: center; }
#mb-root .mb-step {
  flex: 0 0 34px;
  height: 34px;
  border-radius: 9px;
  background: #16222f;
  color: var(--mb-accent);
  font-size: 18px;
  font-weight: 800;
}
#mb-root .mb-step:hover { background: #1f3244; }
#mb-root .mb-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: transparent;
  color: var(--mb-muted);
  font-size: 12px;
  font-weight: 700;
}
#mb-root .mb-switch::before {
  content: "";
  width: 38px;
  height: 22px;
  border-radius: 999px;
  background: rgba(255,255,255,0.14);
  transition: background 0.15s;
}
#mb-root .mb-switch::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 50%;
  width: 16px;
  height: 16px;
  margin-top: -8px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
#mb-root .mb-switch[aria-checked="true"] { color: var(--mb-accent); }
#mb-root .mb-switch[aria-checked="true"]::before { background: #12b886; }
#mb-root .mb-switch[aria-checked="true"]::after { transform: translateX(16px); }
#mb-root .mb-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
#mb-root .mb-toggle-row .mb-label { margin: 0; }
#mb-root .mb-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
#mb-root .mb-note {
  padding: 9px 11px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.4;
  background: rgba(90,167,255,0.1);
  border: 1px solid rgba(90,167,255,0.22);
  color: #cfe2ff;
}
#mb-root .mb-note.is-warn { background: rgba(255,176,32,0.1); border-color: rgba(255,176,32,0.25); color: #ffe2a8; }
#mb-root .mb-presets {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
#mb-root .mb-preset {
  padding: 9px 8px;
  border-radius: 10px;
  background: var(--mb-card);
  border: 1px solid var(--mb-line);
  color: var(--mb-text);
  text-align: left;
}
#mb-root .mb-preset b { display: block; font-size: 13px; }
#mb-root .mb-preset small { display: block; margin-top: 3px; font-size: 10.5px; line-height: 1.3; color: var(--mb-muted); }
#mb-root .mb-preset.is-active { border-color: rgba(111,245,207,0.55); background: rgba(111,245,207,0.1); }
/* ---------------- filtres */
#mb-root .mb-filter-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#mb-root .mb-filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--mb-card);
  border: 1px solid var(--mb-line);
  cursor: pointer;
}
#mb-root .mb-filter-item.is-active { border-color: rgba(111,245,207,0.55); background: rgba(111,245,207,0.08); }
#mb-root .mb-filter-item .mb-filter-main { flex: 1; min-width: 0; }
#mb-root .mb-filter-item b { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mb-root .mb-filter-item small { display: block; font-size: 11px; color: var(--mb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mb-root .mb-filter-item .mb-price-tag { font-size: 12px; font-weight: 700; color: var(--mb-gold); white-space: nowrap; }
#mb-root .mb-check {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  border-radius: 5px;
  border: 1.5px solid rgba(255,255,255,0.35);
  background: transparent;
  display: grid;
  place-items: center;
  color: #04150f;
  font-size: 12px;
  font-weight: 900;
  padding: 0;
}
#mb-root .mb-check[aria-checked="true"] { background: var(--mb-accent); border-color: var(--mb-accent); }
#mb-root .mb-player-search { position: relative; }
#mb-root .mb-results {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: 5;
  max-height: 260px;
  overflow-y: auto;
  border-radius: 10px;
  background: #0d1622;
  border: 1px solid rgba(63,217,232,0.3);
  box-shadow: 0 16px 36px rgba(0,0,0,0.5);
}
#mb-root .mb-results[hidden] { display: none; }
#mb-root .mb-hit {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  background: transparent;
  color: var(--mb-text);
  text-align: left;
  border-bottom: 1px solid var(--mb-line);
}
#mb-root .mb-hit:hover, #mb-root .mb-hit.is-focus { background: rgba(111,245,207,0.1); }
#mb-root .mb-hit-rating {
  flex: 0 0 34px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-weight: 800;
  font-size: 13px;
  color: #1a1400;
  background: linear-gradient(135deg, #f3d77a, #c89b2c);
}
#mb-root .mb-hit b { display: block; font-size: 13px; }
#mb-root .mb-hit small { display: block; font-size: 11px; color: var(--mb-muted); }
#mb-root .mb-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 6px 8px 6px 10px;
  border-radius: 999px;
  background: rgba(111,245,207,0.12);
  border: 1px solid rgba(111,245,207,0.3);
  font-size: 12.5px;
  font-weight: 650;
}
#mb-root .mb-chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#mb-root .mb-chip button { width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,0.12); color: var(--mb-text); font-size: 12px; padding: 0; }
#mb-root .mb-empty { font-size: 12px; color: var(--mb-muted); }
#mb-root .mb-preview {
  margin-top: 8px;
  border-radius: 10px;
  border: 1px solid var(--mb-line);
  overflow: hidden;
}
#mb-root .mb-preview table { width: 100%; border-collapse: collapse; font-size: 12px; }
#mb-root .mb-preview th, #mb-root .mb-preview td { padding: 5px 8px; text-align: left; border-bottom: 1px solid var(--mb-line); white-space: nowrap; }
#mb-root .mb-preview th { font-size: 10.5px; text-transform: uppercase; color: var(--mb-muted); background: rgba(255,255,255,0.03); }
#mb-root .mb-preview td.is-num { text-align: right; font-variant-numeric: tabular-nums; }
#mb-root .mb-preview tr.is-deal td { color: var(--mb-ok); font-weight: 700; }
#mb-root .mb-preview tr.is-muted td { color: var(--mb-muted); }
#mb-root .mb-holo-table { max-height: 380px; overflow: auto; }
#mb-root .mb-holo-table th, #mb-root .mb-holo-table td { padding: 5px 6px; }
#mb-root .mb-holo-table td { font-size: 11.5px; }
#mb-root .mb-holo-table th.is-num { text-align: right; }
#mb-root .mb-holo-table thead th { position: sticky; top: 0; z-index: 1; background: var(--mb-bg-2); }
#mb-root .mb-holo-table td a { color: inherit; text-decoration: underline dotted; }
#mb-root .mb-stats-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
#mb-root .mb-stats-list div {
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--mb-card);
  border: 1px solid var(--mb-line);
  font-size: 12px;
  color: var(--mb-muted);
}
#mb-root .mb-stats-list b { display: block; font-size: 15px; color: var(--mb-text); font-variant-numeric: tabular-nums; }
/* ---------------- journal */
#mb-root .mb-log {
  flex: 0 0 auto;
  height: var(--mb-log-h, 34vh);
  min-height: 90px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--mb-line);
  background: rgba(4,8,14,0.55);
}
#mb-root .mb-log.is-collapsed { height: 38px !important; min-height: 38px; }
#mb-root .mb-log-resize {
  height: 6px;
  margin-top: -3px;
  cursor: ns-resize;
}
#mb-root .mb-log-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 6px 14px;
}
#mb-root .mb-log-head strong { flex: 1; font-size: 12px; font-weight: 750; }
#mb-root .mb-log-filter {
  padding: 4px 8px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 650;
  color: var(--mb-muted);
  background: transparent;
}
#mb-root .mb-log-filter.is-active { color: var(--mb-accent); background: rgba(111,245,207,0.12); }
#mb-root .mb-log-list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0 10px 10px;
  font-size: 12px;
}
#mb-root .mb-log-entry {
  display: grid;
  grid-template-columns: 54px 16px 1fr;
  gap: 6px;
  align-items: start;
  padding: 4px 6px;
  border-radius: 7px;
  line-height: 1.35;
}
#mb-root .mb-log-entry:nth-child(odd) { background: rgba(255,255,255,0.02); }
#mb-root .mb-log-entry time { color: rgba(233,238,246,0.38); font-variant-numeric: tabular-nums; font-size: 11px; padding-top: 1px; }
#mb-root .mb-log-entry i { font-style: normal; text-align: center; }
#mb-root .mb-log-entry p { margin: 0; word-break: break-word; color: #dfe6f0; }
#mb-root .mb-log-entry.t-search p { color: rgba(223,230,240,0.72); }
#mb-root .mb-log-entry.t-success p { color: #8ff0c8; }
#mb-root .mb-log-entry.t-buy { background: rgba(62,224,160,0.1) !important; }
#mb-root .mb-log-entry.t-buy p { color: #9ff5d2; font-weight: 700; }
#mb-root .mb-log-entry.t-warning p { color: #ffd98a; }
#mb-root .mb-log-entry.t-error { background: rgba(255,93,108,0.08) !important; }
#mb-root .mb-log-entry.t-error p { color: #ffadb5; }
/* ---------------- HUD flottant */
#mb-hud {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147482999;
  display: flex;
  align-items: stretch;
  border-radius: 999px;
  background: rgba(12,18,28,0.94);
  border: 1px solid rgba(111,245,207,0.35);
  box-shadow: 0 12px 32px rgba(0,0,0,0.45);
  overflow: hidden;
  user-select: none;
}
body.mb-open #mb-hud { display: none; }
#mb-hud .mb-hud-main {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 7px;
  background: transparent;
  color: #e9eef6;
}
#mb-hud .mb-hud-logo {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 800;
  color: #06121a;
  background: linear-gradient(135deg, #6ff5cf, #e2bc4a);
}
#mb-hud .mb-hud-text { display: flex; flex-direction: column; text-align: left; }
#mb-hud .mb-hud-text b { font-size: 12.5px; font-weight: 750; }
#mb-hud .mb-hud-text small { font-size: 11px; color: rgba(233,238,246,0.65); font-variant-numeric: tabular-nums; }
#mb-hud .mb-dot { width: 8px; height: 8px; border-radius: 50%; background: #6b7686; }
#mb-hud[data-status="running"] .mb-dot { background: #3ee0a0; }
#mb-hud[data-status="paused"] .mb-dot, #mb-hud[data-status="auto-pause"] .mb-dot { background: #ffb020; }
#mb-hud[data-status="cooldown"] .mb-dot { background: #ff8a3d; }
#mb-hud .mb-hud-action {
  width: 40px;
  background: rgba(255,255,255,0.06);
  color: #e9eef6;
  font-size: 14px;
  border-left: 1px solid rgba(255,255,255,0.08);
}
#mb-hud .mb-hud-action:hover { background: rgba(255,255,255,0.12); }
/* ---------------- intégrations EA */
.ut-tab-bar-item.mb-native-tab { position: relative; }
.ut-tab-bar-item.mb-native-tab span { color: #6ff5cf !important; }
.ut-tab-bar-item.mb-native-tab::before {
  content: "";
  display: block;
  width: 24px;
  height: 24px;
  margin: 0 auto 4px;
  background: #6ff5cf;
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='black' d='M13 2L4 14h7l-1 8 10-14h-7l0-6z'/></svg>") center / contain no-repeat;
  mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='black' d='M13 2L4 14h7l-1 8 10-14h-7l0-6z'/></svg>") center / contain no-repeat;
}
.mb-ea-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(111,245,207,0.1);
  border: 1px solid rgba(111,245,207,0.3);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #e9eef6;
}
.mb-ea-bar strong { color: #6ff5cf; margin-right: auto; }
.mb-ea-bar button {
  border: 0;
  cursor: pointer;
  border-radius: 8px;
  padding: 7px 11px;
  font-weight: 700;
  font-size: 12.5px;
  color: #041319;
  background: linear-gradient(135deg, #6ff5cf, #3fd9e8);
}
.mb-ea-bar button.is-ghost { color: #e9eef6; background: rgba(255,255,255,0.1); }
.mb-tax-info {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 6px 0 2px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(111,245,207,0.08);
  font-size: 12px;
  color: #cdefe4;
}
.mb-tax-info b { color: #6ff5cf; }
.mb-tax-info b.is-neg { color: #ff8e99; }
/* ---------------- étiquettes FUTBIN sur les cartes EA */
.mb-card-rel { position: relative; }
.mb-card-price {
  position: absolute !important;
  top: 2px !important;
  left: 0 !important;
  right: 0 !important;
  bottom: auto !important;
  margin: 0 auto !important;
  width: max-content !important;
  height: auto !important;
  max-width: 96%;
  transform: none !important;
  z-index: 6;
  padding: 1px 6px;
  border-radius: 999px;
  font: 700 10px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0;
  white-space: nowrap;
  color: #dffaf1;
  background: rgba(8,14,22,0.82);
  border: 1px solid rgba(111,245,207,0.45);
  box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  cursor: pointer;
  pointer-events: auto !important;
  user-select: none;
}
.mb-card-price.is-ready { color: #6ff5cf; }
.mb-card-price.is-stale { color: #b9c6d3; border-color: rgba(185,198,211,0.4); }
.mb-card-price.is-suspect { color: #ffb020; border-color: rgba(255,176,32,0.6); }
.mb-card-price:hover { background: rgba(8,14,22,0.95); }
.large > .mb-card-price, .mb-card-price.is-large { font-size: 12.5px; padding: 2px 9px; }
.mb-card-price { display: flex !important; align-items: center; gap: 4px; }
.mb-card-price > span { display: inline-flex; align-items: center; }
.mb-cp-gem { color: #dcc2ff; gap: 3px; }
.mb-cp-gem::before {
  content: "";
  width: 6px;
  height: 6px;
  background: linear-gradient(135deg, #f0dcff, #a46cff);
  transform: rotate(45deg);
  border-radius: 1px;
  flex: none;
}
.large > .mb-card-price .mb-cp-gem::before { width: 8px; height: 8px; }
.mb-card-extra {
  position: absolute !important;
  bottom: 2px !important;
  left: 0 !important;
  right: 0 !important;
  top: auto !important;
  margin: 0 auto !important;
  width: max-content !important;
  max-width: 96%;
  z-index: 6;
  padding: 1px 6px;
  border-radius: 999px;
  font: 700 9.5px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  white-space: nowrap;
  pointer-events: auto !important;
  user-select: none;
  box-shadow: 0 2px 6px rgba(0,0,0,0.35);
}
.mb-card-extra.is-deal { color: #04160d; background: #3ee08f; }
.mb-card-extra.is-bought { color: #d8ecff; background: rgba(8,14,22,0.85); border: 1px solid rgba(120,170,230,0.5); }
.mb-card-extra.is-bought.is-neg { color: #ffb4b4; border-color: rgba(255,120,120,0.55); }
.listFUTItem.mb-row-bargain { box-shadow: inset 4px 0 0 #3ee08f !important; background-color: rgba(62,224,143,0.10) !important; }
/* ---------------- panneau « Mettre en vente » */
.mb-ql-futbin {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 8px;
  margin: 4px 0 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(111,245,207,0.08);
  font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #cdefe4;
}
.mb-ql-futbin .mb-ql-fill {
  flex: 0 0 auto;
  border: 0;
  border-radius: 7px;
  padding: 7px 10px;
  cursor: pointer;
  font: 700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #041319;
  background: linear-gradient(135deg, #6ff5cf, #3fd9e8);
}
.mb-ql-futbin .mb-ql-fill:disabled { opacity: 0.5; cursor: default; }
.mb-ql-futbin .mb-ql-lowest { color: #eaf4ff; background: linear-gradient(135deg, #3d6fd8, #5a8cff); }
.mb-ql-futbin .mb-ql-ea { font-size: 11px; color: #b9d3ff; }
/* ---------------- DCE : bouton et fenêtre « Solution FUTBIN » */
#mb-sbc-fab {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147482990;
  border: 1px solid rgba(111,245,207,0.5);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  font: 700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #041319;
  background: linear-gradient(135deg, #6ff5cf, #3fd9e8);
  box-shadow: 0 6px 20px rgba(0,0,0,0.45);
}
#mb-sbc-fab[hidden] { display: none; }
body.mb-open #mb-sbc-fab { left: calc(50% - 234px); }
#mb-sbc {
  position: fixed;
  inset: 0;
  z-index: 2147483100;
  display: grid;
  place-items: center;
  padding: 16px;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0;
  color: #e9eef6;
}
#mb-sbc * { box-sizing: border-box; letter-spacing: 0; }
#mb-sbc [hidden] { display: none !important; }
#mb-sbc .mb-sbc-backdrop { position: absolute; inset: 0; background: rgba(3,7,12,0.7); }
#mb-sbc .mb-sbc-dialog {
  position: relative;
  width: min(760px, 100%);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(180deg, #111a27 0%, #0c121c 100%);
  border: 1px solid rgba(111,245,207,0.3);
  box-shadow: 0 24px 70px rgba(0,0,0,0.6);
}
#mb-sbc .mb-sbc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
#mb-sbc .mb-sbc-head strong { display: block; font-size: 15px; color: #6ff5cf; }
#mb-sbc .mb-sbc-head small { display: block; color: rgba(233,238,246,0.6); font-size: 12px; }
#mb-sbc button { font: inherit; cursor: pointer; border: 0; margin: 0; }
#mb-sbc button:disabled { opacity: 0.45; cursor: not-allowed; }
#mb-sbc .mb-sbc-x {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  font-size: 18px;
  color: #e9eef6;
  background: rgba(255,255,255,0.08);
}
#mb-sbc .mb-sbc-url { display: flex; gap: 8px; padding: 12px 16px 0; }
#mb-sbc input {
  font: inherit;
  color: #e9eef6;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 9px;
  padding: 8px 10px;
  outline: none;
}
#mb-sbc input:focus { border-color: #3fd9e8; }
#mb-sbc .mb-sbc-url input { flex: 1; min-width: 0; }
#mb-sbc .mb-sbc-btn {
  padding: 8px 12px;
  border-radius: 9px;
  font-weight: 700;
  color: #e9eef6;
  background: rgba(255,255,255,0.1);
}
#mb-sbc .mb-sbc-btn.is-primary { color: #041319; background: linear-gradient(135deg, #6ff5cf, #3fd9e8); }
#mb-sbc .mb-sbc-btn.is-danger { color: #fff; background: #e03131; }
#mb-sbc .mb-sbc-status { margin: 10px 16px 0; color: rgba(233,238,246,0.75); font-size: 12.5px; }
#mb-sbc .mb-sbc-status[data-kind="ok"] { color: #3ee0a0; }
#mb-sbc .mb-sbc-status[data-kind="warn"] { color: #ffb020; }
#mb-sbc .mb-sbc-status[data-kind="error"] { color: #ff8e99; }
#mb-sbc .mb-sbc-body { flex: 1; overflow: auto; padding: 8px 16px 12px; min-height: 60px; }
#mb-sbc .mb-sbc-meta { margin: 4px 0 8px; font-size: 12px; color: rgba(233,238,246,0.6); }
#mb-sbc .mb-sbc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
#mb-sbc .mb-sbc-table th {
  text-align: left;
  font-weight: 650;
  font-size: 11.5px;
  color: rgba(233,238,246,0.55);
  padding: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
#mb-sbc .mb-sbc-table td { padding: 7px 6px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
#mb-sbc .mb-sbc-table .is-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
#mb-sbc .mb-sbc-table small { display: block; font-size: 11px; color: rgba(233,238,246,0.5); }
#mb-sbc .mb-sbc-table a { color: #6ff5cf; text-decoration: none; }
#mb-sbc .mb-sbc-pos { font-weight: 700; color: #e2bc4a; white-space: nowrap; }
#mb-sbc .mb-sbc-rating { color: rgba(233,238,246,0.6); }
#mb-sbc tr.is-owned td[data-sbc-state], #mb-sbc tr.is-bought td[data-sbc-state] { color: #3ee0a0; }
#mb-sbc tr.is-missing td[data-sbc-state] { color: #ffb020; }
#mb-sbc tr.is-searching td[data-sbc-state] { color: #5aa7ff; }
#mb-sbc tr.is-failed td[data-sbc-state] { color: #ff8e99; }
#mb-sbc .mb-sbc-max { width: 96px; text-align: right; padding: 6px 8px; }
#mb-sbc .mb-sbc-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
#mb-sbc .mb-sbc-summary { flex: 1 1 220px; font-size: 12.5px; color: rgba(233,238,246,0.75); }
#mb-sbc .mb-sbc-summary b { color: #e9eef6; }
#mb-sbc .mb-sbc-summary.is-short b { color: #ff8e99; }
#mb-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  z-index: 2147483001;
  transform: translate(-50%, 20px);
  opacity: 0;
  pointer-events: none;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(12,18,28,0.96);
  border: 1px solid rgba(111,245,207,0.35);
  color: #e9eef6;
  font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  transition: opacity 0.2s, transform 0.2s;
}
#mb-toast { display: flex; align-items: center; gap: 12px; }
#mb-toast.is-visible { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
#mb-toast .mb-toast-action {
  padding: 4px 10px;
  border: 0;
  border-radius: 6px;
  background: rgba(111,245,207,0.18);
  color: #6ff5cf;
  font: inherit;
  cursor: pointer;
}
#mb-toast .mb-toast-action:hover { background: rgba(111,245,207,0.32); }
#mb-root .mb-link {
  padding: 0;
  margin-left: 6px;
  background: none;
  color: var(--mb-accent);
  font-size: 12px;
  text-decoration: underline;
}
#mb-root .mb-live b { color: var(--mb-accent); }
#mb-root a.mb-link { margin-left: 6px; color: var(--mb-accent); font-size: 12px; text-decoration: underline; }
#mb-root .mb-versions { margin: 6px 0 2px; padding-left: 16px; font-size: 12px; line-height: 1.5; }
#mb-root .mb-live small { color: var(--mb-muted); }
/* ---------------- onglets Outils et Galerie */
#mb-root .mb-meter { height: 6px; margin: 4px 0 8px; border-radius: 999px; background: var(--mb-card-2); overflow: hidden; }
#mb-root .mb-meter > div { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--mb-accent), var(--mb-accent-2)); transition: width 0.3s; }
#mb-root .mb-meter.is-near > div { background: var(--mb-warn); }
#mb-root .mb-meter.is-over > div { background: var(--mb-err); }
#mb-root .mb-meter.is-done > div { background: var(--mb-ok); }
#mb-root .mb-meter-label { margin-top: 6px; font-size: 11px; color: var(--mb-muted); }
#mb-root .mb-tag { display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 700; color: #041319; background: var(--mb-gold); vertical-align: middle; }
#mb-root input.mb-input.mb-input-xs { display: inline-block; width: 52px; height: 28px; margin-right: 6px !important; text-align: center; vertical-align: middle; }
#mb-root input.mb-input.mb-input-sm, #mb-root select.mb-input.mb-input-sm { display: inline-block; width: auto; min-width: 120px; flex: 1 1 140px; height: 30px; font-size: 12.5px !important; }
#mb-root .mb-key { min-width: 64px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
#mb-root .mb-key.is-capturing { outline: 2px solid var(--mb-accent); color: var(--mb-accent); }
#mb-root .mb-hotkeys { max-height: 300px; overflow: auto; }
#mb-root .mb-task-bar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: rgba(90,167,255,0.12); border: 1px solid rgba(90,167,255,0.3); font-size: 12px; }
#mb-root .mb-task-bar[hidden] { display: none; }
#mb-root .mb-tools-status { min-height: 16px; margin: 8px 0 0; font-size: 12px; color: var(--mb-muted); }
#mb-root .mb-tools-status[data-kind="ok"] { color: var(--mb-ok); }
#mb-root .mb-tools-status[data-kind="warn"] { color: var(--mb-warn); }
#mb-root .mb-tools-status[data-kind="error"] { color: var(--mb-err); }
/* ---------------- Galerie : tuile de l'accueil et écrans EA */
.mb-gx, .mb-gallery-tile, .mb-gx-vars {
  --gx-bg: #1b1f29;
  --gx-card: #2a3035;
  --gx-card-2: #353c42;
  --gx-muted-bg: rgba(255,255,255,0.05);
  --gx-border: rgba(255,255,255,0.10);
  --gx-border-strong: rgba(255,255,255,0.20);
  --gx-fg: #ececec;
  --gx-muted: #a3a9af;
  --gx-primary: #34b16c;
  --gx-danger: #e5484d;
  --gx-radius: 12px;
  --gx-radius-sm: 8px;
}
/* Tuile de l'accueil : mêmes mesures que la tuile « FC Hub » d'EA (image 160 px, texte à 24 px). */
.mb-gallery-tile { display: flex; flex-direction: column; cursor: pointer; }
.mb-gallery-tile:focus-visible { outline: 2px solid rgba(177,255,255,0.6); outline-offset: 2px; }
.mb-gallery-tile .tileContent { position: relative; flex: 1 1 0%; }
.mb-gx-home { display: flex; flex-direction: column; height: 100%; }
.mb-gx-home-art { position: relative; flex: 1 1 0%; min-height: 160px; }
.mb-gx-home-emblem { position: absolute; top: 50%; left: 85%; width: 128px; height: auto; transform: translate(-85%, -50%); }
.mb-gx-home-text { position: absolute; top: 52px; left: 24px; max-width: calc(85% - 145px); }
.mb-gallery-tile .ut-tile-view--subtitle { margin: 0; font-size: 18px; font-weight: 300; color: rgb(222,222,216); word-break: break-word; }
.mb-gallery-tile .ut-tile-view--expiry { font-size: 16px; color: rgb(158,255,198); word-break: break-word; }
.mb-gallery-tile .description { margin: 0; }
.mb-gx { box-sizing: border-box; height: 100%; min-height: 100%; overflow-y: auto; color: var(--gx-fg); font-family: inherit; background: radial-gradient(1200px 500px at 20% -10%, rgba(52,177,108,0.10), transparent 60%), var(--gx-bg); }
.mb-gx * { box-sizing: border-box; }
.mb-gx [hidden] { display: none !important; }
.mb-gx button { font-family: inherit; }
.mb-gx-ico { width: 1em; height: 1em; flex: none; }
.mb-gx-ico.is-gem { color: #c49bff; }
.mb-gx-ico.is-token { color: #f2c14e; }
.mb-gx-page { display: flex; flex-direction: column; gap: 16px; max-width: 1320px; margin: 0 auto; padding: 20px 20px 40px; }
.mb-gx-topbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.mb-gx-muted { color: var(--gx-muted); font-size: 13px; }
.mb-gx-muted b { color: var(--gx-fg); font-weight: 700; }
.mb-gx-small { font-size: 12px; }
.mb-gx-grid { display: grid; gap: 12px; }
.mb-gx-grid.is-cats { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.mb-gx-grid.is-sets { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.mb-gx-grid.is-players { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.mb-gx-card { position: relative; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--gx-border); border-radius: var(--gx-radius); background: var(--gx-card); color: var(--gx-fg); box-shadow: 0 1px 2px rgba(0,0,0,0.35); transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s; }
.mb-gx-cat, .mb-gx-set { cursor: pointer; text-align: left; font: inherit; padding: 0; }
.mb-gx-cat:hover, .mb-gx-set:hover { border-color: var(--gx-border-strong); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
.mb-gx-card.is-skeleton { height: 150px; border-color: transparent; background: linear-gradient(90deg, var(--gx-card) 25%, var(--gx-card-2) 37%, var(--gx-card) 63%); background-size: 400% 100%; animation: mb-gx-shimmer 1.4s ease infinite; }
.mb-gx-grid.is-players .mb-gx-card.is-skeleton { height: 230px; }
@keyframes mb-gx-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }
.mb-gx-logo { display: grid; place-items: center; flex: none; width: 40px; height: 40px; }
.mb-gx-logo img { max-width: 100%; max-height: 100%; object-fit: contain; }
.mb-gx-logo.is-empty, .mb-gx-logo.is-icon { color: var(--gx-muted); }
.mb-gx-logo svg { width: 24px; height: 24px; }
.mb-gx-logo.is-big { width: 60px; height: 60px; }
.mb-gx-logo.is-big svg { width: 34px; height: 34px; }
.mb-gx-logos { display: flex; align-items: center; gap: 8px; }
.mb-gx-cat-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 16px 6px; }
.mb-gx-cat-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.mb-gx-cat-name { padding: 6px 16px 16px; font-size: 16px; font-weight: 700; }
.mb-gx-card-head { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--gx-border); background: var(--gx-muted-bg); }
.mb-gx-card-title { flex: 1; min-width: 0; overflow: hidden; font-size: 15px; font-weight: 700; white-space: nowrap; text-overflow: ellipsis; }
.mb-gx-card-body { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.mb-gx-sep { height: 1px; background: var(--gx-border); }
.mb-gx-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.mb-gx-row-left { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.mb-gx-view { align-self: flex-end; }
.mb-gx-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border: 1px solid var(--gx-border-strong); border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.mb-gx-tokens { display: inline-flex; align-items: center; gap: 5px; color: var(--gx-muted); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mb-gx-tokens .mb-gx-ico { width: 16px; height: 16px; }
.mb-gx-grades { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 6px; }
.mb-gx-gb { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.mb-gx-gb-track { width: 100%; height: 6px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,0.10); }
.mb-gx-gb-track > div { height: 100%; border-radius: inherit; background: var(--g); }
/* Losange du palier (lettre redressée) : rempli quand atteint, agrandi pour le palier en cours. */
.mb-gx-gb-badge { display: grid; place-items: center; width: 21px; height: 21px; margin: 2px 0; border: 1.5px solid var(--g); border-radius: 4px; color: var(--g); background: rgba(255,255,255,0.04); transform: rotate(45deg); transition: transform 0.15s; }
.mb-gx-gb-badge i { font-size: 11px; font-style: normal; font-weight: 800; transform: rotate(-45deg); }
.mb-gx-gb.is-reached .mb-gx-gb-badge { color: #16181d; background: var(--g); }
.mb-gx-gb.is-current .mb-gx-gb-badge { transform: rotate(45deg) scale(1.25); box-shadow: 0 0 0 3px rgba(255,255,255,0.08); }
.mb-gx-gb-pts { font-size: 11px; color: var(--gx-muted); font-variant-numeric: tabular-nums; }
.mb-gx-gb.is-current .mb-gx-gb-pts { font-weight: 700; color: var(--gx-fg); }
.mb-gx-grades.is-big .mb-gx-gb-track { height: 8px; }
.mb-gx-grades.is-big .mb-gx-gb-badge { width: 26px; height: 26px; }
.mb-gx-grades.is-big .mb-gx-gb-badge i { font-size: 13px; }
.mb-gx-grades.is-big .mb-gx-gb-pts { font-size: 12px; }
.mb-gx-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 38px; padding: 0 16px; border: 1px solid transparent; border-radius: var(--gx-radius-sm); background: var(--gx-primary); color: #fff; font-size: 14px; font-weight: 600; line-height: 1; white-space: nowrap; cursor: pointer; transition: filter 0.15s, background 0.15s, border-color 0.15s; }
.mb-gx-button:hover { filter: brightness(1.08); }
.mb-gx-button:disabled { opacity: 0.5; cursor: default; filter: none; }
.mb-gx-button.is-outline { border-color: var(--gx-border-strong); background: transparent; color: var(--gx-fg); }
.mb-gx-button.is-outline:hover { background: rgba(255,255,255,0.06); }
.mb-gx-button.is-ghost { background: transparent; color: var(--gx-fg); }
.mb-gx-button.is-ghost:hover { background: rgba(255,255,255,0.06); }
.mb-gx-button.is-danger { background: var(--gx-danger); }
.mb-gx-button.is-sm { height: 32px; padding: 0 12px; font-size: 13px; }
.mb-gx-icon-button { display: grid; place-items: center; flex: none; width: 32px; height: 32px; padding: 0; border: 1px solid var(--gx-border-strong); border-radius: var(--gx-radius-sm); background: transparent; color: var(--gx-fg); cursor: pointer; }
.mb-gx-icon-button:hover { background: rgba(255,255,255,0.06); }
.mb-gx-icon-button .mb-gx-ico { width: 16px; height: 16px; }
.mb-gx-search { display: flex; flex: 1 1 260px; align-items: center; gap: 8px; max-width: 440px; height: 40px; padding: 0 12px; border: 1px solid var(--gx-border); border-radius: 10px; background: var(--gx-card); color: var(--gx-muted); }
.mb-gx-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--gx-fg); font: inherit; font-size: 14px; }
.mb-gx-head { display: flex; align-items: center; gap: 16px; }
.mb-gx-head-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mb-gx-head h2 { margin: 0; font-size: 24px; font-weight: 800; }
.mb-gx-head-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.mb-gx-link { color: #6fdca0; font-size: 13px; font-weight: 600; text-decoration: none; }
.mb-gx-link:hover { text-decoration: underline; }
.mb-gx-grades-card { gap: 12px; padding: 16px; }
.mb-gx-grades-note { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: var(--gx-muted); font-size: 12px; }
.mb-gx-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.mb-gx-tag { padding: 3px 9px; border: 1px solid var(--gx-border); border-radius: 999px; color: var(--gx-muted); font-size: 11px; font-weight: 600; }
.mb-gx-tag.is-on { border-color: transparent; background: rgba(52,177,108,0.20); color: #7fe0a9; }
.mb-gx-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.mb-gx-tabs { display: inline-flex; gap: 4px; padding: 4px; border: 1px solid var(--gx-border); border-radius: 10px; background: var(--gx-card); }
.mb-gx-tab { display: inline-flex; align-items: center; height: 32px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: var(--gx-muted); font-size: 13px; font-weight: 600; cursor: pointer; }
.mb-gx-tab span { margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: rgba(255,255,255,0.08); font-size: 11px; }
.mb-gx-tab.is-active { background: var(--gx-card-2); color: var(--gx-fg); box-shadow: 0 1px 2px rgba(0,0,0,0.4); }
.mb-gx-target { display: flex; align-items: center; gap: 8px; color: var(--gx-muted); font-size: 13px; }
.mb-gx-target select { height: 36px; padding: 0 30px 0 10px; border: 1px solid var(--gx-border-strong); border-radius: var(--gx-radius-sm); background: var(--gx-card) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a3a9af' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center; color: var(--gx-fg); font: inherit; font-size: 13px; font-weight: 600; -webkit-appearance: none; appearance: none; }
.mb-gx-player { align-items: center; gap: 6px; padding: 12px 10px; }
.mb-gx-player.is-selected { border-color: var(--gx-primary); box-shadow: inset 0 0 0 1px var(--gx-primary); }
.mb-gx-cardslot { display: flex; align-items: flex-start; justify-content: center; width: 100%; min-height: 104px; }
.mb-gx-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 72px; height: 100px; border-radius: 8px; color: #221804; background: linear-gradient(160deg, #ecd27a, #8f6b1f); box-shadow: 0 4px 12px rgba(0,0,0,0.35); }
.mb-gx-fallback b { font-size: 22px; font-weight: 800; }
.mb-gx-fallback span { font-size: 11px; font-weight: 700; }
.mb-gx-player-name { max-width: 100%; overflow: hidden; font-size: 13px; font-weight: 700; white-space: nowrap; text-overflow: ellipsis; }
.mb-gx-player-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.mb-gx-player-meta > span { display: inline-flex; align-items: center; gap: 4px; }
.mb-gx-player-meta .mb-gx-ico { width: 14px; height: 14px; }
.mb-gx-player-actions { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 32px; margin-top: 2px; }
.mb-gx-player-actions .mb-gx-button { flex: 1; min-width: 0; }
.mb-gx-badge { padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.08); color: var(--gx-muted); font-size: 11px; font-weight: 700; }
.mb-gx-badge.is-owned, .mb-gx-badge.is-bought, .mb-gx-badge.is-listed { background: rgba(52,177,108,0.18); color: #6fdca0; }
.mb-gx-badge.is-failed { background: rgba(229,72,77,0.18); color: #ff8b8f; }
.mb-gx-badge.is-searching, .mb-gx-badge.is-waiting { background: rgba(110,143,240,0.18); color: #a9bcff; }
.mb-gx-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; }
.mb-gx-page-btn { min-width: 34px; height: 34px; padding: 0 10px; border: 1px solid var(--gx-border); border-radius: var(--gx-radius-sm); background: var(--gx-card); color: var(--gx-fg); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.mb-gx-page-btn:hover:not(:disabled) { border-color: var(--gx-border-strong); }
.mb-gx-page-btn.is-active { border-color: var(--gx-primary); background: var(--gx-primary); color: #fff; }
.mb-gx-page-btn:disabled { opacity: 0.4; cursor: default; }
.mb-gx-ellipsis { color: var(--gx-muted); padding: 0 2px; }
.mb-gx-dock { position: sticky; bottom: 12px; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border: 1px solid var(--gx-border); border-radius: var(--gx-radius); background: rgba(27,31,41,0.92); box-shadow: 0 -8px 28px rgba(0,0,0,0.4); backdrop-filter: blur(8px); }
.mb-gx-dock-text { color: var(--gx-muted); font-size: 13px; font-weight: 600; }
.mb-gx-dock-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mb-gx-status { margin: 0; color: var(--gx-muted); font-size: 13px; }
.mb-gx-status[data-kind="ok"] { color: #6fdca0; }
.mb-gx-status[data-kind="warn"] { color: #f5b544; }
.mb-gx-status[data-kind="info"] { padding: 10px 12px; border: 1px solid rgba(110,143,240,0.35); border-radius: var(--gx-radius-sm); background: rgba(110,143,240,0.10); color: #c5d2ff; line-height: 1.45; }
/* Bandeau de synchro de la collection */
.mb-gx-sync { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border: 1px solid var(--gx-border); border-radius: var(--gx-radius); background: var(--gx-card); }
.mb-gx-sync-text { font-size: 13px; color: var(--gx-fg); }
.mb-gx-sync-text b { font-variant-numeric: tabular-nums; }
.mb-gx-sync-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mb-gx-sync-actions .mb-gx-ico { width: 15px; height: 15px; }
.mb-gx-sync.is-running { justify-content: flex-start; }
.mb-gx-sync.is-running .mb-gx-sync-text { flex: 1 1 260px; }
.mb-gx-progress { flex: 1 1 200px; height: 8px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,0.10); }
.mb-gx-progress > div { height: 100%; border-radius: inherit; background: var(--gx-primary); transition: width 0.3s; }
.mb-gx-pill.is-collected { border-color: rgba(52,177,108,0.45); background: rgba(52,177,108,0.14); color: #7fe0a9; }
.mb-gx-pill .mb-gx-ico, .mb-gx-badge .mb-gx-ico { width: 12px; height: 12px; }
.mb-gx-cat-progress { padding: 0 16px 14px; margin-top: -8px; font-size: 12px; }
.mb-gx-ico.is-token-img { width: 18px; height: 18px; object-fit: contain; }
.mb-gx-cardslot[data-gx-market] { cursor: pointer; }
.mb-gx-cardslot[data-gx-market]:hover { filter: brightness(1.08); }
.mb-gx-holo { color: #9fd8ff; font-size: 11px; }
.mb-gx-badge { display: inline-flex; align-items: center; gap: 4px; }
.mb-gx-badge.is-reward { background: rgba(216,169,63,0.18); color: #e9c46a; }
.mb-gx-button.is-reward { border-color: #d8a93f; background: transparent; color: #e9c46a; }
.mb-gx-button.is-reward:hover { background: rgba(216,169,63,0.12); }
.mb-gx-warn { color: #f5b544; }
/* Filtres de l'onglet Manquants */
.mb-gx-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding: 10px 12px; border: 1px solid var(--gx-border); border-radius: var(--gx-radius); background: var(--gx-card); }
.mb-gx-filters label { display: flex; flex-direction: column; gap: 4px; color: var(--gx-muted); font-size: 12px; font-weight: 600; }
.mb-gx-filters .mb-gx-input { width: 120px; }
.mb-gx-check { flex-direction: row !important; align-items: center; gap: 8px !important; height: 36px; color: var(--gx-fg) !important; font-size: 13px !important; }
.mb-gx-input { height: 36px; padding: 0 10px; border: 1px solid var(--gx-border-strong); border-radius: var(--gx-radius-sm); background: var(--gx-bg); color: var(--gx-fg); font: inherit; font-size: 13px; outline: 0; }
.mb-gx-input:focus { border-color: var(--gx-primary); }
/* Fenêtre d'achat */
.mb-gx-modal { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px; background: rgba(5,8,12,0.66); backdrop-filter: blur(3px); }
.mb-gx-modal-card { display: flex; flex-direction: column; gap: 14px; width: min(880px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 20px; border: 1px solid var(--gx-border-strong); border-radius: 14px; background: var(--gx-bg); box-shadow: 0 24px 70px rgba(0,0,0,0.6); }
.mb-gx-modal-card h3 { margin: 0; font-size: 19px; font-weight: 800; }
.mb-gx-modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.mb-gx-modal-grid label { display: flex; flex-direction: column; gap: 5px; color: var(--gx-muted); font-size: 12px; font-weight: 600; }
.mb-gx-table-wrap { overflow: auto; max-height: 340px; border: 1px solid var(--gx-border); border-radius: var(--gx-radius-sm); }
.mb-gx-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.mb-gx-table th { position: sticky; top: 0; padding: 8px 10px; background: var(--gx-card-2); color: var(--gx-muted); font-size: 11px; font-weight: 700; text-align: left; text-transform: uppercase; letter-spacing: 0.02em; }
.mb-gx-table td { padding: 7px 10px; border-top: 1px solid var(--gx-border); vertical-align: middle; font-variant-numeric: tabular-nums; }
.mb-gx-table .mb-gx-input { width: 110px; height: 32px; }
.mb-gx-ladder { color: var(--gx-muted); font-size: 12px; white-space: nowrap; }
.mb-gx-modal-total { margin: 0; font-size: 14px; font-weight: 700; }
.mb-gx-risk { margin: 0; padding: 10px 12px; border-radius: var(--gx-radius-sm); background: rgba(245,181,68,0.10); color: #f5c76e; font-size: 12px; line-height: 1.45; }
.mb-gx-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
/* Menu ⋮ de la tuile de l'accueil */
.mb-gallery-tile header { position: relative; }
.mb-gx-tile-menu { position: absolute; top: 18px; right: 14px; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: #b3b9cf; cursor: pointer; }
.mb-gx-tile-menu:hover { background: rgba(255,255,255,0.08); color: #f3f5fb; }
.mb-gx-tile-menu .mb-gx-ico { width: 18px; height: 18px; }
.mb-gx-tile-pop { position: absolute; top: 52px; right: 14px; z-index: 3; display: flex; flex-direction: column; min-width: 220px; padding: 6px; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; background: #1b1f29; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
.mb-gx-tile-pop[hidden] { display: none; }
.mb-gx-tile-pop button { padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: #ececec; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.mb-gx-tile-pop button:hover { background: rgba(255,255,255,0.08); }
/* Pastille « déjà dans ta collection de galerie » sur les cartes EA (annonces, concepts) */
.mb-card-collected { position: absolute; left: 2px; bottom: 2px; z-index: 6; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #34b16c; color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.5); pointer-events: auto; }
.mb-card-collected svg { width: 11px; height: 11px; }
.large.item > .mb-card-collected { width: 22px; height: 22px; left: 4px; bottom: 4px; }
.large.item > .mb-card-collected svg { width: 13px; height: 13px; }
.mb-gx-loading { display: flex; align-items: center; gap: 10px; color: var(--gx-muted); font-size: 13px; }
.mb-gx-spin { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2); border-top-color: var(--gx-primary); border-radius: 50%; animation: mb-gx-rotate 0.8s linear infinite; }
@keyframes mb-gx-rotate { to { transform: rotate(360deg); } }
.mb-gx-empty { align-items: center; gap: 12px; padding: 32px; text-align: center; }
.mb-gx-empty > .mb-gx-ico { width: 40px; height: 40px; color: var(--gx-muted); }
.mb-gx-empty p { max-width: 560px; margin: 0; color: var(--gx-muted); line-height: 1.5; }
.mb-gx-empty-line { margin: 8px 0; }
/* ---------------- raccourcis : touche affichée sur les boutons EA */
.mb-kbd {
  display: inline-block;
  margin-left: 8px;
  padding: 0 5px;
  min-width: 10px;
  border-radius: 4px;
  font: 600 10px/15px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: center;
  color: rgba(255,255,255,0.8);
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.28);
  vertical-align: middle;
  white-space: nowrap;
  pointer-events: none;
}
/* Gros boutons du panneau de détail : touche dans le coin (le texte du bouton ne passe pas à la ligne). */
.DetailPanel .bidOptions > button { position: relative; }
.DetailPanel .bidOptions > button > .mb-kbd { position: absolute; top: 6px; right: 8px; margin: 0; }
/* Bouton retour d'EA : pas de pastille (elle ressemblait à une icône à côté du titre). */
.ut-navigation-button-control > .mb-kbd { display: none; }
/* ---------------- listes EA : totaux et menu ⋮ des sections, fenêtre de mise en vente groupée */
.mb-list-tools { position: relative; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; margin-left: auto; padding: 0 6px; color: #c9d3e0; font-size: 12px; font-variant-numeric: tabular-nums; }
.mb-list-totals { white-space: nowrap; }
.mb-list-relist { padding: 2px 8px; border-radius: 999px; background: rgba(111,245,207,0.14); color: #a8f5dc; font-weight: 700; }
.mb-list-more { width: 30px; height: 30px; padding: 0; border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; background: rgba(255,255,255,0.04); color: #e9eef6; font-size: 16px; line-height: 1; cursor: pointer; }
.mb-list-more:hover { background: rgba(255,255,255,0.10); }
.mb-list-pop { position: absolute; top: calc(100% + 4px); right: 0; z-index: 50; display: flex; flex-direction: column; min-width: 240px; padding: 6px; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; background: #1b1f29; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
.mb-list-pop[hidden] { display: none; }
.mb-list-pop.mb-list-pop-portal { position: fixed; top: 0; left: 0; right: auto; z-index: 2147482500; }
.mb-list-pop button { padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: #ececec; font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: left; cursor: pointer; }
.mb-list-pop button:hover { background: rgba(255,255,255,0.08); }
.mb-bulk-host { position: relative; z-index: 2147482000; color: var(--gx-fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.mb-bulk-host .mb-gx-modal-card { width: min(1040px, 100%); }
.mb-bulk-host tr.is-listed td { color: #8fe9b5; }
.mb-bulk-host tr.is-failed td { color: #ff9a9e; }
.mb-bulk-host tr.is-skipped td { color: var(--gx-muted); }
.mb-bulk-host tr.is-listing td { color: #c5d2ff; }
/* ---------------- compteur de requêtes dans la barre de recherche EA */
.mb-ea-usage { margin-left: auto; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); color: #c9d3e0; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mb-ea-usage.is-mid { color: #f5d06e; }
.mb-ea-usage.is-high { color: #ffb020; background: rgba(255,176,32,0.14); }
.mb-ea-usage.is-over { color: #fff; background: #e5484d; }
/* ---------------- panneau de détail : Prix min EA, Sniper cette carte */
.mb-detail-actions { display: flex; flex-direction: column; gap: 6px; margin: 8px 0 0; }
.mb-detail-buttons { display: flex; gap: 6px; }
.mb-detail-buttons button { flex: 1; height: 34px; padding: 0 10px; border: 1px solid rgba(111,245,207,0.35); border-radius: 8px; background: rgba(111,245,207,0.08); color: #a8f5dc; font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; cursor: pointer; }
.mb-detail-buttons button:hover { background: rgba(111,245,207,0.16); }
.mb-detail-buttons button:disabled { opacity: 0.5; cursor: default; }
.mb-detail-result { min-height: 14px; color: #c9d3e0; font-size: 12px; text-align: center; }
/* ---------------- résultats du marché : lignes masquées, marquées, bandeau, réglages */
.listFUTItem.mb-row-hidden { display: none !important; }
.listFUTItem.mb-row-owned .rowContent { box-shadow: inset 3px 0 0 #5aa7ff; }
.listFUTItem.mb-row-bid-bargain .rowContent { background-image: linear-gradient(90deg, rgba(255,176,32,0.16), transparent 60%); }
.mb-results-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 8px; padding: 8px 12px; border: 1px solid rgba(90,167,255,0.35); border-radius: 8px; background: rgba(90,167,255,0.10); color: #dbe7ff; font-size: 13px; }
.mb-results-why { color: rgba(219,231,255,0.7); font-size: 12px; }
.mb-results-bar button { margin-left: auto; padding: 4px 10px; border: 1px solid rgba(219,231,255,0.35); border-radius: 6px; background: transparent; color: #fff; font: inherit; font-size: 12px; cursor: pointer; }
.mb-results-box { margin: 8px 0 12px; border: 1px solid rgba(111,245,207,0.25); border-radius: 10px; background: rgba(12,18,28,0.72); color: #e9eef6; font-size: 13px; }
.mb-results-box > summary { padding: 10px 14px; cursor: pointer; font-weight: 700; list-style: none; }
.mb-results-box > summary::-webkit-details-marker { display: none; }
.mb-results-box > summary b { margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: #6ff5cf; color: #0b1a14; font-size: 11px; }
.mb-results-grid { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 0 14px 10px; }
.mb-results-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.mb-results-field { display: inline-flex; align-items: center; gap: 8px; color: rgba(233,238,246,0.75); }
.mb-results-field select, .mb-results-hide input { height: 30px; padding: 0 8px; border: 1px solid rgba(255,255,255,0.18); border-radius: 6px; background: #0c121c; color: #e9eef6; font: inherit; font-size: 12px; }
.mb-results-hide { display: flex; flex-direction: column; gap: 6px; padding: 0 14px 10px; }
.mb-results-hide-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mb-results-hide-label { min-width: 120px; color: rgba(233,238,246,0.7); font-size: 12px; }
.mb-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.mb-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; border-radius: 999px; background: rgba(111,245,207,0.14); color: #a8f5dc; font-size: 12px; }
.mb-chip button { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; }
.mb-chip button:hover { background: rgba(255,255,255,0.12); }
.mb-results-hint { margin: 0; padding: 0 14px 12px; color: rgba(233,238,246,0.55); font-size: 11px; line-height: 1.4; }
/* ---------------- panneau de détail : achat immédiat comparé au prix FUTBIN */
.mb-buy-check {
  margin: 10px 0 0;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.35;
  text-align: center;
  color: #dedede;
  background: rgba(255,255,255,0.06);
}
.mb-buy-check.is-profit { color: #8fe9b5; background: rgba(52,177,108,0.14); }
.mb-buy-check.is-loss { color: #ff9a9e; background: rgba(229,72,77,0.16); }
/* ---------------- DCE : collections masquées, valeur FUTBIN, après validation */
.mb-sbc-hidden { display: none !important; }
/* Sous le bouton favori rond d'EA (coin haut droit) ; position affinée par sbcTools.js. */
.mb-sbc-hide {
  position: absolute;
  top: 44px;
  right: 10px;
  z-index: 5;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  font: 700 14px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9eef6;
  background: rgba(8,14,22,0.75);
  cursor: pointer;
  opacity: 0.55;
}
.mb-sbc-hide:hover { opacity: 1; background: rgba(255,93,108,0.85); }
.ut-sbc-set-tile-view { position: relative; }
#mb-sbc-value {
  position: fixed;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147482990;
  padding: 4px 12px;
  border-radius: 999px;
  font: 700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #dffaf1;
  background: rgba(8,14,22,0.88);
  border: 1px solid rgba(111,245,207,0.45);
  pointer-events: none;
}
#mb-sbc-value[hidden] { display: none; }
body.mb-open #mb-sbc-value { left: calc(50% - 234px); }
#mb-sbc-after {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 14px;
  border-radius: 12px;
  font: 600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9eef6;
  background: rgba(12,18,28,0.97);
  border: 1px solid rgba(111,245,207,0.4);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
#mb-sbc-after button {
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  font: 700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #041319;
  background: linear-gradient(135deg, #6ff5cf, #3fd9e8);
  cursor: pointer;
}
#mb-sbc-after button[data-after="close"] { color: #e9eef6; background: rgba(255,255,255,0.1); }
#mb-sbc-after button:disabled { opacity: 0.5; }
@media (max-width: 720px) {
  .mb-gx-page { padding: 12px 12px 28px; }
  .mb-gx-grid.is-cats, .mb-gx-grid.is-sets { grid-template-columns: 1fr; }
  .mb-gx-grid.is-players { grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); }
  .mb-gx-head h2 { font-size: 20px; }
  .mb-gx-dock { bottom: 6px; }
  #mb-sbc .mb-sbc-table th:nth-child(3), #mb-sbc .mb-sbc-table td:nth-child(3) { display: none; }
  #mb-root { --mb-width: 100vw; }
  #mb-root .mb-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  #mb-root .mb-grid { grid-template-columns: 1fr; }
  #mb-hud { right: 10px; bottom: 70px; }
}
`;
