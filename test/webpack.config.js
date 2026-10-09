// Tests hors navigateur : `npm test` (bundles écrits dans test/build).
const path = require("path");

module.exports = {
  mode: "development",
  target: "node",
  devtool: false,
  entry: {
    engine: path.resolve(__dirname, "engine.test.js"),
    futbin: path.resolve(__dirname, "futbin.test.js"),
    tools: path.resolve(__dirname, "tools.test.js"),
  },
  output: { path: path.resolve(__dirname, "build"), filename: "[name].test.bundle.js" },
  resolve: {
    conditionNames: ["require", "node", "default"],
    // "node_modules" d'abord (recherche hiérarchique) : chaque paquet garde ses propres dépendances
    // (linkedom → htmlparser2 → entities), puis les dossiers du dépôt et des tests.
    modules: ["node_modules", path.resolve(__dirname, "../node_modules"), path.resolve(__dirname, "node_modules")],
  },
  externals: { canvas: "commonjs canvas" },
};
