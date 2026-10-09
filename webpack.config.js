const headers = require("./tampermonkey-header");
const WebpackUserscript = require("webpack-userscript");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  entry: "./app/index.js",
  output: {
    filename: "./fut-auto-buyer.user.js",
  },
  devServer: {
    contentBase: "./dist/",
  },
  plugins: [
    new WebpackUserscript({
      ...headers,
    }),
  ],
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        // ascii_only : tout caractère non ASCII écrit en \uXXXX (accents, symboles), le script ne
        // dépend plus de l'encodage choisi par Tampermonkey ou le navigateur pour le lire.
        terserOptions: { format: { comments: false, ascii_only: true } },
      }),
    ],
  },
};
