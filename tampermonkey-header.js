module.exports = {
  headers: {
    name: "MagicBuyer-UT",
    namespace: "http://tampermonkey.net/",
    version: "4.0.0",
    description: "UT Auto Buyer - EA FC 27",
    author: "AMINE1921",
    match: [
      "https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app*",
      "https://www.ea.com/ea-sports-fc/ultimate-team/web-app*",
      "https://www.futbin.com/*",
    ],
    "run-at": "document-start",
    grant: ["GM_xmlhttpRequest", "unsafeWindow"],
    connect: [
      "ea.com",
      "ea2.com",
      "futbin.com",
      "www.futbin.com",
      "futwiz.com",
      "discordapp.com",
      "futbin.org",
      "exp.host",
    ],
    updateURL:
      "https://github.com/AMINE1921/MagicBuyer-UT/releases/latest/download/fut-auto-buyer.user.js",
    downloadURL:
      "https://github.com/AMINE1921/MagicBuyer-UT/releases/latest/download/fut-auto-buyer.user.js",
  },
};
