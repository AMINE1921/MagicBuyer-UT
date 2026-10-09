module.exports = {
  headers: {
    name: "MagicBuyer-UT",
    namespace: "http://tampermonkey.net/",
    version: "5.4.5",
    description: "Sniper / autobuyer pour le web app EA FC 27 Ultimate Team",
    author: "AMINE1921",
    match: [
      "https://www.ea.com/*/ea-sports-fc/ultimate-team/web-app*",
      "https://www.ea.com/ea-sports-fc/ultimate-team/web-app*",
      "https://www.futbin.com/*",
    ],
    "run-at": "document-start",
    sandbox: "JavaScript",
    "inject-into": "page",
    grant: ["GM_xmlhttpRequest", "GM_getValue", "GM_setValue", "unsafeWindow"],
    connect: [
      "ea.com",
      "futbin.com",
      "www.futbin.com",
      "futbin.org",
      "www.futbin.org",
      "discord.com",
      "discordapp.com",
      "api.telegram.org",
    ],
    updateURL:
      "https://github.com/AMINE1921/MagicBuyer-UT/releases/latest/download/fut-auto-buyer.user.js",
    downloadURL:
      "https://github.com/AMINE1921/MagicBuyer-UT/releases/latest/download/fut-auto-buyer.user.js",
  },
};
