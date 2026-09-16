const webpack = require("webpack");
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
    new webpack.ProvidePlugin({
      $: "jquery",
      jQuery: "jquery",
    }),
    new WebpackUserscript({
      ...headers,
    }),
  ],
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
};
