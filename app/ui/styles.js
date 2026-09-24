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
/* ---------------- panneau « Mettre en vente » */
.mb-ql-futbin {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
#mb-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
#mb-root .mb-link {
  padding: 0;
  margin-left: 6px;
  background: none;
  color: var(--mb-accent);
  font-size: 12px;
  text-decoration: underline;
}
#mb-root .mb-live b { color: var(--mb-accent); }
@media (max-width: 720px) {
  #mb-sbc .mb-sbc-table th:nth-child(3), #mb-sbc .mb-sbc-table td:nth-child(3) { display: none; }
  #mb-root { --mb-width: 100vw; }
  #mb-root .mb-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  #mb-root .mb-grid { grid-template-columns: 1fr; }
  #mb-hud { right: 10px; bottom: 70px; }
}
`;
