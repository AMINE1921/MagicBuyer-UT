import jq from "jquery";

const $ = jq;
try {
  window.$ = window.jQuery = $;
} catch (e) {}

export default $;
export { $ };
