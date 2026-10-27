/*
 * Engraving preview — draft persistence.
 *
 * The customer's in-progress engraving for a product (keyed by product id)
 * is kept in localStorage until it's added to cart. A draft is one JSON
 * object, so a new kind of choice is just another key passed to save(patch).
 */
(function (root) {
  var ns = (root.IskraEngraving = root.IskraEngraving || {});
  var PREFIX = "iskra-engraving:";

  // Drafts are cleared whenever this extension is republished: the version
  // is the block's asset_url, which carries a new fingerprint on every deploy.
  function invalidateIfVersionChanged(version) {
    try {
      var versionKey = PREFIX + "version";
      if (localStorage.getItem(versionKey) === version) return;
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0) toRemove.push(key);
      }
      toRemove.forEach(function (key) {
        localStorage.removeItem(key);
      });
      localStorage.setItem(versionKey, version);
    } catch (e) {
      // Storage unavailable (private mode, disabled, quota): no persistence
      // for this visitor.
    }
  }

  ns.createDraftStorage = function (host) {
    invalidateIfVersionChanged(host.getAttribute("data-storage-version") || "");
    var draftKey = PREFIX + "draft:" + (host.getAttribute("data-product-id") || "");

    function load() {
      try {
        var raw = localStorage.getItem(draftKey);
        var parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    // Merges patch into the stored draft. A draft without text is removed
    // rather than saved.
    function save(patch) {
      try {
        var merged = Object.assign({}, load(), patch);
        if (!merged.text) {
          localStorage.removeItem(draftKey);
          return;
        }
        localStorage.setItem(draftKey, JSON.stringify(merged));
      } catch (e) {
        // localStorage can throw in private mode or when quota is full
      }
    }

    return { load: load, save: save };
  };
})(typeof self !== "undefined" ? self : this);
