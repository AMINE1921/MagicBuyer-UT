// Tests du solveur DCE seuls (bundle écrit dans test/build-solver, n'interfère pas avec `npm test`).
const path = require("path");
const base = require("./webpack.config");

module.exports = Object.assign({}, base, {
  entry: { solver: path.resolve(__dirname, "solver.test.js") },
  output: { path: path.resolve(__dirname, "build-solver"), filename: "[name].test.bundle.js" },
});
