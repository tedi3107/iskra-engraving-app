/*
 * App embed: show the engraved preview instead of the product photo for
 * engraved lines on the cart page and in the cart drawer.
 *
 * Replaces the manual per-theme Liquid edit described on the app's Setup
 * page (that edit keeps working; both set the same image). Works with
 * Dawn-style markup (#CartItem-N / #CartDrawer-Item-N rows) and with rows
 * that carry the line key in a data attribute. Pure mapping logic is
 * exposed for unit tests through the CommonJS branch.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.IskraCartEngravingImages = api;
    api.start();
  }
})(typeof self !== "undefined" ? self : this, function () {
  var PROPERTY = "_Engraved Preview";
  var SHOPIFY_CDN_PREFIX = "https://cdn.shopify.com/";

  // cart.js → [{ index (1-based, as themes number rows), key, url }]
  function previewsFromCart(cart) {
    var out = [];
    var items = (cart && cart.items) || [];
    for (var i = 0; i < items.length; i++) {
      var props = items[i].properties || {};
      var url = props[PROPERTY];
      if (typeof url === "string" && url.indexOf(SHOPIFY_CDN_PREFIX) === 0) {
        out.push({ index: i + 1, key: items[i].key, url: url });
      }
    }
    return out;
  }

  function rowsFor(preview, doc) {
    var selectors = [
      "#CartItem-" + preview.index,
      "#CartDrawer-Item-" + preview.index,
    ];
    if (preview.key) {
      var key = String(preview.key).replace(/"/g, '\\"');
      selectors.push(
        '[data-line-key="' + key + '"]',
        '[data-cart-item-key="' + key + '"]',
        '[data-key="' + key + '"]',
      );
    }
    return doc.querySelectorAll(selectors.join(","));
  }

  function applyPreviews(previews, doc) {
    var changed = 0;
    previews.forEach(function (preview) {
      var rows = rowsFor(preview, doc);
      for (var r = 0; r < rows.length; r++) {
        var img =
          rows[r].querySelector("img.cart-item__image") ||
          rows[r].querySelector(".cart-item__media img, .cart-item__image-container img") ||
          rows[r].querySelector("img");
        if (!img || img.getAttribute("src") === preview.url) continue;
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        img.setAttribute("src", preview.url);
        changed++;
      }
    });
    return changed;
  }

  function hasCartRows(doc) {
    return !!doc.querySelector(
      '[id^="CartItem-"], [id^="CartDrawer-Item-"], [data-line-key], [data-cart-item-key]',
    );
  }

  function start() {
    var scheduled = null;
    var inFlight = false;

    function refresh() {
      scheduled = null;
      if (inFlight || !hasCartRows(document)) return;
      inFlight = true;
      fetch("/cart.js", { headers: { Accept: "application/json" } })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (cart) {
          if (cart) applyPreviews(previewsFromCart(cart), document);
        })
        .catch(function () {
          // best-effort: the theme's own image simply stays
        })
        .then(function () {
          inFlight = false;
        });
    }

    function schedule() {
      if (scheduled) clearTimeout(scheduled);
      scheduled = setTimeout(refresh, 150);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedule);
    } else {
      schedule();
    }

    // Themes re-render cart rows after quantity changes / adds; watch for
    // new rows (childList only, so our own src swaps don't loop back).
    if (window.MutationObserver) {
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].addedNodes.length) {
            schedule();
            return;
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    }
    ["cart:updated", "cart:refresh"].forEach(function (name) {
      document.addEventListener(name, schedule);
    });
  }

  return {
    previewsFromCart: previewsFromCart,
    applyPreviews: applyPreviews,
    hasCartRows: hasCartRows,
    start: start,
  };
});
