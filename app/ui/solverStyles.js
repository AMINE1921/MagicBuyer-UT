// Styles du solveur DCE (ajoutés à la feuille MagicBuyer par injectStyles) : même langage visuel que la
// fenêtre « Solution FUTBIN » (#mb-sbc), bouton bleu pour le distinguer.
export const SOLVER_STYLES = `
/* ---------------- DCE : bouton et fenêtre « Solveur club », bouton « Remplir au moins cher » (en un clic) */
#mb-solver-fab, #mb-solver-oc, #mb-solver-concept {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147482990;
  border: 1px solid rgba(122,162,255,0.55);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
  white-space: nowrap;
  font: 700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #eef3ff;
  background: linear-gradient(135deg, #3d6fd8, #5a8cff);
  box-shadow: 0 6px 20px rgba(0,0,0,0.45);
}
#mb-solver-fab[hidden], #mb-solver-oc[hidden], #mb-solver-concept[hidden] { display: none; }
#mb-solver-concept { color: #1a1204; background: linear-gradient(135deg, #f5c542, #ff9f2e); border-color: rgba(255,176,32,0.6); }
body.mb-open #mb-solver-fab, body.mb-open #mb-solver-oc, body.mb-open :is(#mb-solver-oc-box, #mb-solver-note) { left: calc(50% - 234px); }
:is(#mb-solver-oc-box, #mb-solver-note) {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147482990;
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(560px, calc(100vw - 24px));
  padding: 8px 10px 8px 14px;
  border-radius: 12px;
  font: 600 12.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #e9eef6;
  background: rgba(12,18,28,0.97);
  border: 1px solid rgba(90,140,255,0.45);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
:is(#mb-solver-oc-box, #mb-solver-note)[data-kind="ok"] { border-color: rgba(62,224,160,0.55); }
:is(#mb-solver-oc-box, #mb-solver-note)[data-kind="warn"] { border-color: rgba(255,176,32,0.6); }
:is(#mb-solver-oc-box, #mb-solver-note)[data-kind="error"] { border-color: rgba(255,93,108,0.6); }
:is(#mb-solver-oc-box, #mb-solver-note) span { flex: 1; min-width: 0; }
:is(#mb-solver-oc-box, #mb-solver-note) button {
  flex: none;
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font: 700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #eef3ff;
  background: linear-gradient(135deg, #3d6fd8, #5a8cff);
}
:is(#mb-solver-oc-box, #mb-solver-note) button[data-oc="close"], #mb-solver-note button[data-note="close"] { color: #e9eef6; background: rgba(255,255,255,0.1); }
/* Écran d'équipe : sous la pastille de valeur FUTBIN (#mb-sbc-value). */
#mb-solver-note { top: 86px; }
#mb-solver, #mb-solver-buy {
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
:is(#mb-solver, #mb-solver-buy) * { box-sizing: border-box; letter-spacing: 0; }
:is(#mb-solver, #mb-solver-buy) [hidden] { display: none !important; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-backdrop { position: absolute; inset: 0; background: rgba(3,7,12,0.7); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-dialog {
  position: relative;
  width: min(820px, 100%);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  background: linear-gradient(180deg, #111a27 0%, #0c121c 100%);
  border: 1px solid rgba(90,140,255,0.35);
  box-shadow: 0 24px 70px rgba(0,0,0,0.6);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-head strong { display: block; font-size: 15px; color: #8fb2ff; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-head small { display: block; color: rgba(233,238,246,0.6); font-size: 12px; }
:is(#mb-solver, #mb-solver-buy) button { font: inherit; cursor: pointer; border: 0; margin: 0; }
:is(#mb-solver, #mb-solver-buy) button:disabled { opacity: 0.45; cursor: not-allowed; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-x {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  font-size: 18px;
  color: #e9eef6;
  background: rgba(255,255,255,0.08);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-top { padding: 10px 16px 0; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: grid;
  gap: 3px;
  max-height: 150px;
  overflow: auto;
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 8px;
  font-size: 12.5px;
  background: rgba(255,255,255,0.04);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li > span:nth-child(2) { flex: 1; min-width: 0; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li b { font-variant-numeric: tabular-nums; color: #e9eef6; white-space: nowrap; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs .mb-sv-mark { width: 14px; text-align: center; font-weight: 800; color: rgba(233,238,246,0.45); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li.is-ok .mb-sv-mark { color: #3ee0a0; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li.is-ko { background: rgba(255,93,108,0.1); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li.is-ko .mb-sv-mark, :is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li.is-ko b { color: #ff8e99; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li.is-na .mb-sv-mark { color: #ffb020; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-reqs li.mb-sv-or { background: none; padding: 0 2px; color: rgba(233,238,246,0.6); font-size: 12px; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-options {
  margin: 0 0 8px;
  border-radius: 9px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-options summary { cursor: pointer; padding: 7px 10px; font-weight: 650; color: rgba(233,238,246,0.8); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 14px;
  padding: 2px 10px 10px;
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-check { display: flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-check input { margin: 0; accent-color: #5a8cff; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-field { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12.5px; }
:is(#mb-solver, #mb-solver-buy) input[data-sv-num] {
  width: 110px;
  font: inherit;
  text-align: right;
  color: #e9eef6;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 8px;
  padding: 5px 8px;
  outline: none;
}
:is(#mb-solver, #mb-solver-buy) input[data-sv-num]:focus { border-color: #5a8cff; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-cache { flex: 1 1 160px; text-align: right; font-size: 11.5px; color: rgba(233,238,246,0.5); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-btn {
  padding: 8px 12px;
  border-radius: 9px;
  font-weight: 700;
  color: #e9eef6;
  background: rgba(255,255,255,0.1);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-btn.is-primary { color: #eef3ff; background: linear-gradient(135deg, #3d6fd8, #5a8cff); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-btn.is-danger { color: #fff; background: #e03131; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-progress {
  position: relative;
  height: 4px;
  margin: 10px 0 0;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255,255,255,0.08);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-progress span {
  display: block;
  height: 100%;
  width: 3%;
  border-radius: 4px;
  background: linear-gradient(90deg, #3d6fd8, #6ff5cf);
  transition: width 0.2s ease;
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-progress.is-busy span { width: 30%; animation: mb-sv-busy 1.1s ease-in-out infinite; }
@keyframes mb-sv-busy { 0% { transform: translateX(-100%); } 100% { transform: translateX(340%); } }
:is(#mb-solver, #mb-solver-buy) .mb-sv-status { margin: 8px 0 0; color: rgba(233,238,246,0.75); font-size: 12.5px; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-status[data-kind="ok"] { color: #3ee0a0; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-status[data-kind="warn"] { color: #ffb020; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-status[data-kind="error"] { color: #ff8e99; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-body { flex: 1; overflow: auto; padding: 8px 16px 12px; min-height: 40px; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-meta { margin: 2px 0 8px; font-size: 12px; color: rgba(233,238,246,0.6); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-table th {
  text-align: left;
  font-weight: 650;
  font-size: 11.5px;
  color: rgba(233,238,246,0.55);
  padding: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-table td { padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-table .is-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-table small { display: block; font-size: 11px; color: rgba(233,238,246,0.5); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-table tr.is-brick td, :is(#mb-solver, #mb-solver-buy) .mb-sv-table tr.is-empty td { color: rgba(233,238,246,0.45); font-style: italic; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-pos { font-weight: 700; color: #e2bc4a; white-space: nowrap; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-rating { color: rgba(233,238,246,0.6); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-src { color: rgba(233,238,246,0.7); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-off {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 10.5px;
  font-weight: 700;
  color: #ffb020;
  background: rgba(255,176,32,0.12);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-chem { letter-spacing: 1px; color: #3ee0a0; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-chem[data-chem="0"] { color: #ff8e99; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-chem[data-chem="1"] { color: #ffb020; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-dim { color: rgba(233,238,246,0.5); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
:is(#mb-solver, #mb-solver-buy) .mb-sv-summary { flex: 1 1 260px; font-size: 12.5px; color: rgba(233,238,246,0.8); }
#mb-solver-buy { z-index: 2147483200; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-dialog.is-small { width: min(600px, 100%); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-btn.is-buy { color: #1a1204; background: linear-gradient(135deg, #f5c542, #ff9f2e); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-table tr.is-market td { background: rgba(255,176,32,0.06); }
:is(#mb-solver, #mb-solver-buy) .mb-sv-buy { font-weight: 700; color: #ffb020; }
:is(#mb-solver, #mb-solver-buy) .mb-sv-price { color: #ffd27a; }
:is(#mb-solver, #mb-solver-buy) tr[data-state="searching"] .mb-sv-buy { color: #5aa7ff; }
:is(#mb-solver, #mb-solver-buy) tr[data-state="bought"] .mb-sv-buy { color: #3ee0a0; }
:is(#mb-solver, #mb-solver-buy) tr[data-state="failed"] .mb-sv-buy { color: #ff8e99; }
:is(#mb-solver-oc-box, #mb-solver-note) button.is-buy { color: #1a1204; background: linear-gradient(135deg, #f5c542, #ff9f2e); }
:is(#mb-solver-oc-box, #mb-solver-note) button.is-danger { color: #fff; background: #e03131; }
@media (max-width: 720px) {
  :is(#mb-solver, #mb-solver-buy) .mb-sv-grid { grid-template-columns: 1fr; }
  :is(#mb-solver, #mb-solver-buy) .mb-sv-table .mb-sv-src { display: none; }
  :is(#mb-solver, #mb-solver-buy) .mb-sv-cache { text-align: left; }
}
`;
