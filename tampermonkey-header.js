module.exports = {
  headers: {
    name: "MagicBuyer-UT",
    namespace: "http://tampermonkey.net/",
    version: "1.0.0",
    description: "UT Auto Buyer - French version",
    author: "AMINE1921",
    match: [
      "https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app/*",
      "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/*",
    ],
    grant: ["GM_xmlhttpRequest"],
    connect: [
      "ea.com",
      "ea2.com",
      "futbin.com",
      "futwiz.com",
      "discordapp.com",
      "futbin.org",
      "exp.host",
    ],
    require: [
      "https://code.jquery.com/jquery-3.6.1.min.js",
      // "https://raw.githubusercontent.com/ckalgos/FUT-Auto-Buyer/main/external/discord.11.4.2.min.js",
      // "https://github.com/ckalgos/fut-trade-enhancer/releases/latest/download/fut-trade-enhancer.user.js",
    ],
    // updateURL:
    //   "https://github.com/ckalgos/fut-auto-buyer/releases/latest/download/fut-auto-buyer.user.js",
    // downloadURL:
    //   "https://github.com/ckalgos/fut-auto-buyer/releases/latest/download/fut-auto-buyer.user.js",
    noFrame: true,
  },
};
