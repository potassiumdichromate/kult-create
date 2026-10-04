/*
 * Kult Create — embed for Kult World.
 *
 * Opens the Kult Create office over the page and hands it the player's Privy
 * session, so players walk in already signed in.
 *
 *   <script src="https://YOUR-KULT-CREATE-HOST/embed.js"></script>
 *   KultCreate.open({
 *     getSession: async () => ({ accessToken, identityToken }),  // from Privy
 *     login: async () => { await privyLogin(); },                 // optional
 *     onExit: () => {},                                           // optional
 *   });
 *
 * getSession must resolve to the player's current Privy access token and/or
 * identity token (the identity token carries their linked wallets), or null
 * when they are signed out. When signed out, the office asks Kult World to
 * log in by calling `login`, then calls getSession again.
 */
(function () {
  var script = document.currentScript;
  var HOST = script ? new URL(script.src).origin : location.origin;
  var frame = null, opts = null;

  function post(msg) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(msg, HOST); }

  function sendSession() {
    return Promise.resolve()
      .then(function () { return opts.getSession(); })
      .then(function (s) {
        if (s && (s.accessToken || s.identityToken)) {
          post({ type: "kultcreate:session", accessToken: s.accessToken || null, identityToken: s.identityToken || null });
          return true;
        }
        return false;
      })
      .catch(function (e) { console.warn("[kult-create] could not read the Privy session", e); return false; });
  }

  function onMessage(e) {
    if (!frame || e.source !== frame.contentWindow || e.origin !== HOST) return;
    var type = e.data && e.data.type;
    if (type === "kultcreate:ready") sendSession();
    else if (type === "kultcreate:login") {
      Promise.resolve(opts.login ? opts.login() : null).then(sendSession).catch(function () {});
    } else if (type === "kultcreate:exit") close();
  }

  function open(options) {
    if (frame) return frame;
    opts = options || {};
    if (typeof opts.getSession !== "function") throw new Error("KultCreate.open needs getSession()");
    frame = document.createElement("iframe");
    frame.src = HOST + "/office/?embed=1";
    frame.title = "Kult Create";
    frame.allow = "autoplay; fullscreen; clipboard-write";
    frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483000;background:#0b0717";
    window.addEventListener("message", onMessage);
    (opts.container || document.body).appendChild(frame);
    return frame;
  }

  function close() {
    if (!frame) return;
    window.removeEventListener("message", onMessage);
    frame.remove();
    frame = null;
    var done = opts && opts.onExit;
    opts = null;
    if (done) done();
  }

  // Call after the player signs in/out of Kult World while the office is open.
  function sessionChanged(signedIn) {
    if (!frame) return;
    if (signedIn === false) post({ type: "kultcreate:logout" });
    else sendSession();
  }

  window.KultCreate = { open: open, close: close, sessionChanged: sessionChanged };
})();
