/*
 * Engraving preview — cart.
 *
 * Gets the engraving onto the cart line: mirrors it into the theme's
 * add-to-cart forms as properties, uploads a snapshot of the engraved photo
 * (via the app proxy) for _Engraved Preview, and adds the item itself from
 * the dialog / quick-add buttons.
 */
(function (root) {
  var ns = (root.IskraEngraving = root.IskraEngraving || {});

  // Capture, upload and (if Shopify is still processing the image) status
  // polling share an 8s budget; after that the item is added without a
  // preview.
  var UPLOAD_DEADLINE_MS = 8000;
  var UPLOAD_ENDPOINT = "/apps/engraving/upload-preview";
  var PREVIEW_FIELD = "properties[_Engraved Preview]";

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pollPreviewStatus(id, deadline) {
    if (Date.now() + 700 >= deadline) return Promise.resolve(null);
    return delay(700)
      .then(function () {
        return fetch(UPLOAD_ENDPOINT + "?id=" + encodeURIComponent(id), {
          headers: { Accept: "application/json" },
        });
      })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data && data.url) return data;
        if (data && data.pending) return pollPreviewStatus(id, deadline);
        return null;
      });
  }

  // Best-effort side-cart refresh: the theme's <cart-drawer>.renderContents()
  // (swaps in the sections requested in /cart/add.js and opens the drawer),
  // else its open(), else common cart events (harmless if nothing listens).
  function openSideCartBestEffort(cartAddData) {
    var cartDrawer = document.querySelector("cart-drawer");
    if (
      cartDrawer &&
      typeof cartDrawer.renderContents === "function" &&
      cartAddData &&
      cartAddData.sections
    ) {
      // Dawn's renderContents() looks for "is-empty" on .drawer__inner, but
      // the class sits on <cart-drawer> itself, so after the first add from
      // an empty cart the drawer can still look empty. Removed here once the
      // add has succeeded.
      cartDrawer.classList.remove("is-empty");
      cartDrawer.renderContents(cartAddData);
      return;
    }
    if (cartDrawer && typeof cartDrawer.open === "function") {
      cartDrawer.open();
      return;
    }
    ["cart:updated", "cart:refresh", "cart:build", "cart:open"].forEach(function (name) {
      document.dispatchEvent(new CustomEvent(name, { bubbles: true }));
    });
  }

  ns.createCart = function (ctx) {
    var input = ctx.input;
    var state = ctx.state;

    function mirrorToCartForms(name, value) {
      document.querySelectorAll('form[action^="/cart/add"]').forEach(function (form) {
        if (form.contains(input) && name === "properties[Engraving]") return;
        var hidden = form.querySelector('input[name="' + name + '"]');
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = name;
          form.appendChild(hidden);
        }
        hidden.value = value;
      });
    }

    function clearFromCartForms(name) {
      document.querySelectorAll('form[action^="/cart/add"]').forEach(function (form) {
        var hidden = form.querySelector('input[name="' + name + '"]');
        if (hidden) hidden.remove();
      });
    }

    // A captured preview matches one text + font + photo combination. When
    // any of them changes it's dropped, so the next add (or closing the
    // dialog) captures a fresh one. An upload already in progress belongs to
    // that click and is left alone.
    function invalidatePendingUpload() {
      if (state.isProcessing) return;
      state.pendingUpload = null;
      clearFromCartForms(PREVIEW_FIELD);
    }

    // Resolves to the stored preview's URL (also mirrored into the theme's
    // forms), or null when it couldn't be produced in time.
    function uploadEngravingImage() {
      var deadline = Date.now() + UPLOAD_DEADLINE_MS;
      var timeout = delay(UPLOAD_DEADLINE_MS).then(function () {
        return null;
      });
      var work = ctx.render
        .captureSnapshot()
        .then(function (blob) {
          if (!blob) return null;
          var uploadForm = new FormData();
          uploadForm.append("image", blob, "engraving.jpg");
          return fetch(UPLOAD_ENDPOINT, { method: "POST", body: uploadForm }).then(function (res) {
            return res.json();
          });
        })
        .then(function (data) {
          if (data && !data.url && data.pending && data.id) {
            return pollPreviewStatus(data.id, deadline);
          }
          return data;
        })
        // Settle quietly even if this loses the race to the deadline, so a
        // late network error doesn't surface as an unhandled rejection.
        .catch(function () {
          return null;
        });
      return Promise.race([work, timeout])
        .then(function (data) {
          if (data && data.url) {
            mirrorToCartForms(PREVIEW_FIELD, data.url);
            return data.url;
          }
          return null;
        })
        .catch(function () {
          return null;
        });
    }

    // Shared by the dialog's confirm button and quick-add, which differ only
    // in the UI they toggle. Returns false and runs no callbacks when an add
    // is already in progress.
    function addEngravedItemToCart(callbacks) {
      if (state.isProcessing || !input.value || !ctx.variants.currentVariantIsAvailable())
        return false;
      state.isProcessing = true;
      if (callbacks.onStart) callbacks.onStart();

      function finishProcessing() {
        state.isProcessing = false;
        if (callbacks.onFinish) callbacks.onFinish();
      }

      state.pendingUpload = uploadEngravingImage();
      state.pendingUpload
        .then(function (previewUrl) {
          // Adds through the cart AJAX API, so this works even when the
          // product page has no add-to-cart button of its own.
          var properties = { Engraving: input.value };
          if (state.fontFamily) properties["Engraving Font"] = state.fontFamily;
          if (previewUrl) properties["_Engraved Preview"] = previewUrl;
          var idField = ctx.variants.liveVariantIdField();

          return fetch("/cart/add.js", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              items: [{ id: idField ? idField.value : null, quantity: 1, properties: properties }],
              sections: "cart-drawer,cart-icon-bubble",
              sections_url: window.location.pathname,
            }),
          });
        })
        .then(function (response) {
          if (!response.ok) throw new Error("cart add failed");
          return response.json();
        })
        .then(function (data) {
          openSideCartBestEffort(data);
          state.pendingUpload = null;
          finishProcessing();
          // Clear the input so the trigger reverts to "Personalize" and
          // quick-add hides. Dispatching 'input' resets the counter, buttons
          // and saved draft through their existing listeners.
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (ctx.dialogEl && ctx.dialogEl.open) ctx.dialogEl.close();
        })
        .catch(function () {
          finishProcessing();
          if (callbacks.onError) callbacks.onError();
        });
      return true;
    }

    // For customers who close the dialog without using its Add button (e.g.
    // to use the theme's own button): start the upload now. No-op if one is
    // already pending.
    function uploadOnDialogClose(dialogEl) {
      dialogEl.addEventListener("close", function () {
        if (!input.value || state.pendingUpload) return;
        state.pendingUpload = uploadEngravingImage();
      });
    }

    // The theme's own add-to-cart buttons wait for the preview upload, then
    // submit with it attached.
    function interceptThemeForms() {
      document.querySelectorAll('form[action^="/cart/add"]').forEach(function (form) {
        form
          .querySelectorAll('button[type="submit"], input[type="submit"]')
          .forEach(function (button) {
            button.addEventListener(
              "click",
              function (e) {
                if (button.dataset.engravingReady === "true") {
                  delete button.dataset.engravingReady;
                  return;
                }
                var engravingField = form.querySelector('input[name="properties[Engraving]"]');
                if (!engravingField || !engravingField.value) return;

                e.preventDefault();
                e.stopImmediatePropagation();

                var upload = state.pendingUpload || uploadEngravingImage();
                upload.then(function () {
                  button.dataset.engravingReady = "true";
                  button.click();
                });
              },
              true,
            );
          });
      });
    }

    return {
      mirrorToCartForms: mirrorToCartForms,
      invalidatePendingUpload: invalidatePendingUpload,
      addEngravedItemToCart: addEngravedItemToCart,
      uploadOnDialogClose: uploadOnDialogClose,
      interceptThemeForms: interceptThemeForms,
    };
  };
})(typeof self !== "undefined" ? self : this);
