export const MAGICBUYER_STYLES = `
#mb-fab,
#mb-fab *,
#mb-root,
#mb-root * {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
  box-sizing: border-box;
  letter-spacing: 0 !important;
}
#mb-fab {
  position: fixed;
  top: auto;
  right: 18px;
  bottom: 18px;
  z-index: 2147483000;
  display: flex !important;
  align-items: center;
  gap: 10px;
  border: 0;
  cursor: pointer;
  color: #081018;
  background: linear-gradient(135deg, #7dffd4 0%, #4ee6eb 45%, #d4af37 100%);
  padding: 11px 16px 11px 12px;
  border-radius: 999px;
  font-weight: 700;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255,255,255,0.12) inset;
}
#mb-fab .mb-fab-mark {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #081018;
  color: #7dffd4;
  font-size: 12px;
}
body.mb-panel-open #mb-fab {
  display: flex !important;
  opacity: 0.92;
}
.ut-tab-bar-item.icon-magicbuyer.mb-native-tab {
  position: relative;
  flex: 0 0 auto !important;
  min-width: 72px;
  order: 99;
}
nav.ut-tab-bar,
.ut-tab-bar {
  overflow-x: auto !important;
}
.ut-tab-bar-item.icon-magicbuyer.mb-native-tab span {
  color: #7dffd4 !important;
}
.ut-tab-bar-item.icon-magicbuyer.mb-native-tab:before {
  content: "";
  display: block;
  width: 24px;
  height: 24px;
  margin: 0 auto 4px;
  background: currentColor;
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='black' d='M13 2L4 14h7l-1 8 10-14h-7l0-6z'/></svg>") center / contain no-repeat;
  mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='black' d='M13 2L4 14h7l-1 8 10-14h-7l0-6z'/></svg>") center / contain no-repeat;
  color: #7dffd4;
}
#mb-root {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 2147483001;
}
#mb-root.mb-open {
  display: block;
}
.mb-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(4, 8, 14, 0.72);
  backdrop-filter: blur(8px);
}
.mb-shell {
  position: absolute;
  inset: 18px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 22px;
  background:
    radial-gradient(1200px 400px at 10% -10%, rgba(78, 230, 235, 0.18), transparent 50%),
    radial-gradient(800px 320px at 100% 0%, rgba(212, 175, 55, 0.12), transparent 45%),
    linear-gradient(180deg, #121826 0%, #0b1018 100%);
  border: 1px solid rgba(126, 255, 212, 0.22);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  color: #e8eef7;
}
.mb-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.mb-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.mb-logo {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #7dffd4, #d4af37);
  color: #081018;
  font-weight: 800;
}
.mb-brand h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 750;
}
.mb-brand p {
  margin: 2px 0 0;
  font-size: 12px;
  opacity: 0.7;
}
.mb-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.mb-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.06);
  font-size: 12px;
}
.mb-pill strong {
  color: #7dffd4;
  font-weight: 700;
}
.mb-close {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 12px;
  background: rgba(255,255,255,0.08);
  color: #fff;
  cursor: pointer;
  font-size: 20px;
}
.mb-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  padding: 12px 20px 0;
}
.mb-stat {
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.05);
}
.mb-stat span {
  display: block;
  font-size: 12px;
  opacity: 0.65;
}
.mb-stat strong {
  display: block;
  margin-top: 4px;
  font-size: 16px;
  color: #fff;
}
.mb-criteria {
  margin: 12px 20px 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(78, 230, 235, 0.08);
  border: 1px solid rgba(78, 230, 235, 0.18);
  font-size: 13px;
}
.mb-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 20px;
}
.mb-toolbar button {
  border: 0;
  cursor: pointer;
  border-radius: 12px;
  padding: 10px 16px;
  font-weight: 700;
  font-size: 14px;
}
.mb-btn-start {
  background: linear-gradient(135deg, #10ac84, #7dffd4);
  color: #062018;
}
.mb-btn-pause {
  background: #ff9f43;
  color: #1a0f00;
}
.mb-btn-stop {
  background: #ee5253;
  color: #fff;
}
.mb-btn-ghost {
  background: rgba(255,255,255,0.08);
  color: #e8eef7;
}
.mb-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
  gap: 12px;
  padding: 0 20px 20px;
}
.mb-main,
.mb-logs {
  min-height: 0;
  border-radius: 18px;
  background: rgba(8, 12, 20, 0.55);
  border: 1px solid rgba(255,255,255,0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mb-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  overflow: visible;
  padding: 12px 12px 0;
  z-index: 2;
}
.mb-tab {
  border: 0;
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.82);
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  font-weight: 650;
  font-size: 14px;
  pointer-events: auto;
}
.mb-tab.is-active {
  background: rgba(125, 255, 212, 0.16);
  color: #7dffd4;
}
.mb-pages {
  flex: 1;
  overflow: auto;
  padding: 12px;
}
.mb-page {
  display: none !important;
}
.mb-page.is-active {
  display: block !important;
}
#mb-root .mb-page.is-active .buyer-settings-wrapper {
  display: grid !important;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  margin-top: 0;
  width: 100%;
}
#mb-root .price-filter,
#mb-root .buyer-settings-field {
  margin: 0 !important;
  padding: 12px;
  border-radius: 14px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.05);
  width: auto !important;
}
#mb-root .price-filter .info,
#mb-root .ut-toggle-cell-view--label {
  color: #d7deea;
}
#mb-root .price-filter small,
#mb-root .ut-toggle-cell-view--label small {
  color: rgba(255,255,255,0.55);
  white-space: normal;
}
#mb-root input,
#mb-root select,
#mb-root .numericInput {
  background: #0f1622 !important;
  border: 1px solid rgba(78, 230, 235, 0.35) !important;
  color: #7dffd4 !important;
  border-radius: 10px !important;
  height: 2.4em;
  width: 100%;
}
.mb-logs-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px 8px;
  font-size: 13px;
}
#mb-root .autoBuyerLog {
  flex: 1;
  overflow: auto;
  list-style: none;
  margin: 0;
  padding: 8px 10px 12px;
  height: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
#mb-root .cardPalyerLi,
#mb-root .cardPalyer,
#mb-root .typeContent,
#mb-root .typeContentText,
#mb-root .contentContainer {
  all: unset;
}
#mb-root .mb-log {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.06);
  border-left: 3px solid #5aa7ff;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif !important;
}
#mb-root .mb-log:has(.mb-log-portrait) {
  grid-template-columns: 62px 36px 1fr;
}
#mb-root .mb-log-info { border-left-color: #5aa7ff; }
#mb-root .mb-log-error { border-left-color: #ff5d6c; background: rgba(255,93,108,0.08); }
#mb-root .mb-log-success { border-left-color: #3ee0a0; background: rgba(62,224,160,0.08); }
#mb-root .mb-log-warning { border-left-color: #ffb020; background: rgba(255,176,32,0.08); }
#mb-root .mb-log-time {
  font-size: 11px;
  line-height: 1.3;
  color: rgba(255,255,255,0.42);
  font-variant-numeric: tabular-nums;
  padding-top: 1px;
}
#mb-root .mb-log-portrait {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
}
#mb-root .mb-log-body {
  min-width: 0;
}
#mb-root .mb-log-label {
  display: block;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.48);
  margin-bottom: 3px;
  font-weight: 700;
}
#mb-root .mb-log-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: #e8edf5;
  word-break: break-word;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif !important;
}
.mb-progress {
  height: 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  overflow: hidden;
  margin: 0 20px 8px;
}
.mb-progress > div {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #7dffd4, #d4af37);
}
@media (max-width: 980px) {
  .mb-shell {
    inset: 8px;
    border-radius: 16px;
  }
  .mb-layout {
    grid-template-columns: 1fr;
    padding-bottom: 12px;
  }
  .mb-logs {
    min-height: 240px;
  }
  #mb-fab {
    top: auto;
    right: 12px;
    bottom: 12px;
  }
}
.mb-futbin-price {
  display: inline-flex;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #081018;
  background: linear-gradient(135deg, #7dffd4, #4ee6eb);
  vertical-align: middle;
  white-space: nowrap;
  text-decoration: none;
}
a.mb-futbin-price[href] {
  cursor: pointer;
}
.mb-futbin-detail a {
  color: #7dffd4;
  margin-left: 6px;
}
.mb-futbin-price:not(.is-ready) {
  opacity: 0.55;
}
.mb-futbin-detail {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  color: #7dffd4;
  background: rgba(8, 16, 24, 0.72);
  border: 1px solid rgba(125, 255, 212, 0.28);
}
#mb-list-futbin,
.mb-list-futbin {
  width: 100%;
  margin-top: 10px;
  border: 0;
  cursor: pointer;
  border-radius: 10px;
  padding: 12px 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #081018;
  background: linear-gradient(135deg, #7dffd4 0%, #d4af37 100%);
}
#mb-list-futbin:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
#mb-toast {
  position: fixed;
  left: 50%;
  bottom: 88px;
  transform: translateX(-50%) translateY(12px);
  z-index: 2147483646;
  max-width: min(420px, calc(100vw - 24px));
  padding: 12px 16px;
  border-radius: 12px;
  background: rgba(8, 16, 24, 0.94);
  color: #7dffd4;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.03em;
  border: 1px solid rgba(125, 255, 212, 0.35);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
#mb-toast.is-visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
.listFUTItem .entityContainer > .name.mb-name-with-price {
  display: inline-flex !important;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  max-width: 100%;
}
.listFUTItem .entityContainer > .name .mb-futbin-price {
  position: static !important;
  display: inline-flex !important;
  margin: 0 !important;
  transform: none !important;
  float: none !important;
  vertical-align: middle;
  letter-spacing: 0 !important;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif !important;
  font-size: 10px;
  line-height: 1.2;
  padding: 2px 7px;
  flex: 0 0 auto;
}
.mb-target {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;
}
.mb-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: rgba(232, 238, 247, 0.8);
}
.mb-target-search {
  position: relative;
}
.mb-target-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
#mb-target-query,
.mb-field input {
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(78, 230, 235, 0.35);
  background: #0f1622;
  color: #7dffd4;
  font-size: 15px;
}
.mb-advanced {
  border-radius: 12px;
  background: rgba(255,255,255,0.03);
  padding: 8px 12px;
}
.mb-advanced summary {
  cursor: pointer;
  color: rgba(232, 238, 247, 0.7);
}
.mb-target-results {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 5;
  max-height: 280px;
  overflow: auto;
  border-radius: 12px;
  background: #101826;
  border: 1px solid rgba(125, 255, 212, 0.2);
  box-shadow: 0 16px 40px rgba(0,0,0,0.45);
}
.mb-target-hit {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: #e8eef7;
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
}
.mb-target-hit:hover {
  background: rgba(125, 255, 212, 0.1);
}
.mb-hit-rating {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #7dffd4, #d4af37);
  color: #081018;
  font-weight: 800;
}
.mb-hit-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mb-hit-meta small {
  opacity: 0.65;
}
.mb-target-selected {
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(125, 255, 212, 0.08);
  border: 1px solid rgba(125, 255, 212, 0.18);
  font-size: 14px;
}
.mb-target-prices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.mb-target-prices label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.8;
}
.mb-target-status {
  margin: 0;
  font-size: 12px;
  opacity: 0.6;
}
.mb-ea-player-search {
  margin-bottom: 10px;
}
.mb-market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.mb-tile {
  padding: 12px;
  border-radius: 16px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  min-height: 120px;
}
.mb-tile h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
}
.mb-tile-wide {
  grid-column: 1 / -1;
}
.mb-tile-value {
  margin-top: 8px;
  font-size: 13px;
  color: #7dffd4;
}
.mb-price-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
}
.mb-price-grid label,
.mb-tile label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  opacity: 0.85;
}
.mb-tile select,
.mb-tile input,
.mb-price-grid input {
  width: 100%;
  height: 40px;
}

`;
