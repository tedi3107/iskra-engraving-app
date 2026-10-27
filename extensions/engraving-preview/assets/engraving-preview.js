/*
 * Engraving preview — entry point.
 *
 * Defines <engraving-preview> and wires the block together. The pieces live
 * in separate assets, loaded in this order by the block's Liquid:
 *
 *   engraving-preview-core.js      pure helpers (geometry, crop, money, …)
 *   engraving-preview-storage.js   draft persistence
 *   engraving-preview-render.js    drawing, WebGL lighting, snapshot
 *   engraving-preview-overlay.js   overlays on the theme's product photos
 *   engraving-preview-variants.js  variant pills and theme sync
 *   engraving-preview-cart.js      upload + add to cart
 *   engraving-preview.js           this file
 *
 * They share one context object (ctx) per block; mutable values live in
 * ctx.state. The boot order below matters — e.g. the font is applied before
 * variants initialise, and the dialog controls register their input
 * listeners after the preview's own.
 */
(function () {
  var core = window.IskraEngravingCore;
  var ns = window.IskraEngraving || {};
  var MODULES = [
    "createDraftStorage",
    "createRenderer",
    "createOverlay",
    "createVariants",
    "createCart",
  ];

  function modulesLoaded() {
    if (!core) {
      console.error("[engraving-preview] engraving-preview-core.js is not loaded");
      return false;
    }
    for (var i = 0; i < MODULES.length; i++) {
      if (typeof ns[MODULES[i]] !== "function") {
        console.error("[engraving-preview] missing " + MODULES[i] + " (an engraving-preview-*.js asset is not loaded)");
        return false;
      }
    }
    return true;
  }

  function whenImageReady(imgEl, cb) {
    if (!imgEl) {
      cb();
      return;
    }
    var called = false;
    function done() {
      if (called) return;
      called = true;
      imgEl.removeEventListener("load", done);
      cb();
    }
    imgEl.addEventListener("load", done);
    if (imgEl.complete && imgEl.naturalWidth) done();
  }

  // The first photo of this product outside the block: an explicit
  // [data-engraving-target], else the section's first image.
  function findFirstExternalImage(sectionEl) {
    var explicit = document.querySelector("[data-engraving-target]");
    if (explicit || !sectionEl) return explicit;
    var candidates = sectionEl.querySelectorAll("img");
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i].closest(".engraving-preview")) return candidates[i];
    }
    return null;
  }

  function bootEngravingPreview(host) {
    if (!host || host._booted) return;
    if (!modulesLoaded()) return;

    var input = host.querySelector(".engraving-preview__input");
    var storage = ns.createDraftStorage(host);
    var savedDraft = storage.load();
    if (input && savedDraft.text) {
      input.value = input.maxLength > 0 ? savedDraft.text.slice(0, input.maxLength) : savedDraft.text;
    }

    var stage = host.querySelector(".engraving-preview__stage");
    if (!input || !stage) return;
    host._booted = true;

    var sectionEl = host.closest('[id^="shopify-section-"]');
    var ctx = {
      core: core,
      host: host,
      input: input,
      stage: stage,
      shape: stage.getAttribute("data-shape"),
      imageEl: stage.querySelector(".engraving-preview__image"),
      sectionEl: sectionEl,
      firstExternalImage: findFirstExternalImage(sectionEl),
      dialogEl: null,
      ui: null,
      state: {
        fontChoice:
          savedDraft.fontChoice === "one" || savedDraft.fontChoice === "two"
            ? savedDraft.fontChoice
            : stage.getAttribute("data-font-choice") || "one",
        fontFamily: null,
        fontFallback: "serif",
        baseColorHex: "#96731f",
        trackedIdentity: null,
        lastSeenVariantId: null,
        pendingUpload: null,
        isProcessing: false,
      },
      geomAttr: function (name) {
        return parseFloat(stage.getAttribute("data-" + ctx.state.fontChoice + "-" + name));
      },
      fontFamilyCss: function () {
        return ctx.state.fontFamily
          ? "'" + ctx.state.fontFamily + "', " + ctx.state.fontFallback
          : ctx.state.fontFallback;
      },
    };
    var state = ctx.state;
    var imageEl = ctx.imageEl;

    ctx.cart = ns.createCart(ctx);
    ctx.render = ns.createRenderer(ctx);
    ctx.overlay = ns.createOverlay(ctx);
    ctx.overlay.refresh();
    ctx.overlay.observe();

    // Coalesces re-render requests (keystrokes, font loads, variant swaps,
    // resizes) into one per animation frame.
    var renderQueued = false;
    ctx.renderAllPreviews = function () {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(function () {
        renderQueued = false;
        ctx.render.renderInternal();
        ctx.overlay.renderAll();
      });
    };

    // ---- Font ----------------------------------------------------------
    function applyFontChoice(choice) {
      state.fontChoice = choice;
      var family = stage.getAttribute("data-font-" + choice + "-family");
      var fallback = stage.getAttribute("data-font-" + choice + "-fallback");
      state.fontFamily = family;
      state.fontFallback = fallback || "serif";

      ctx.render.sampleAndApplyColor(imageEl && imageEl.src);

      if (family && document.fonts && document.fonts.load) {
        var fontSizePercent = ctx.geomAttr("font-size");
        var boxW = (imageEl && imageEl.clientWidth) || 400;
        var boxH = (imageEl && imageEl.clientHeight) || 400;
        var fontPx =
          ctx.shape === "straight"
            ? (fontSizePercent / 100) * (ctx.geomAttr("height") / 100) * boxH
            : (fontSizePercent / 100) * (ctx.geomAttr("radius") / 100) * boxW;
        var loadPx = Math.max(16, Math.round(fontPx));
        document.fonts
          .load(loadPx + 'px "' + family + '"')
          .then(ctx.renderAllPreviews)
          .catch(function () {
            // face may already be cached or the load may be blocked
          });
      }

      if (family) ctx.cart.mirrorToCartForms("properties[Engraving Font]", family);

      ctx.cart.invalidatePendingUpload();
      storage.save({ fontChoice: choice });
    }

    var fontPicker = host.querySelector(".engraving-preview__font-picker");
    if (fontPicker) {
      fontPicker.querySelectorAll('input[type="radio"]').forEach(function (radio) {
        // Sync the pills with the current choice, which may come from a saved
        // draft rather than the Liquid-rendered default.
        radio.checked = radio.value === state.fontChoice;
        radio.addEventListener("change", function () {
          if (radio.checked) applyFontChoice(radio.value);
        });
      });
    }
    applyFontChoice(state.fontChoice);

    whenImageReady(imageEl, function () {
      ctx.render.sampleAndApplyColor(imageEl && imageEl.src);
    });
    if (ctx.firstExternalImage) whenImageReady(ctx.firstExternalImage, ctx.overlay.renderAll);
    host._onResize = ctx.renderAllPreviews;
    window.addEventListener("resize", host._onResize);

    // ---- Text input (listener order matters) ----------------------------
    // Uppercases the actual value (CSS text-transform only changes how it
    // looks) before the other input listeners run, keeping the caret.
    if (stage.getAttribute("data-uppercase-only") === "true") {
      input.addEventListener("input", function () {
        var caret = input.selectionStart;
        input.value = input.value.toUpperCase();
        input.setSelectionRange(caret, caret);
      });
    }

    var charCounterEl = host.querySelector(".engraving-preview__char-counter");
    var maxLength = input.maxLength > 0 ? input.maxLength : null;
    function updateCharCounter() {
      if (!charCounterEl) return;
      var len = input.value.length;
      charCounterEl.textContent = maxLength ? len + "/" + maxLength : String(len);
      charCounterEl.classList.toggle(
        "engraving-preview__char-counter--limit",
        !!maxLength && len >= maxLength,
      );
    }

    input.addEventListener("input", function () {
      ctx.cart.invalidatePendingUpload();
      ctx.overlay.refresh();
      ctx.renderAllPreviews();
    });
    input.addEventListener("input", updateCharCounter);
    input.addEventListener("input", function () {
      storage.save({ text: input.value });
    });
    updateCharCounter();

    // ---- Variants ------------------------------------------------------
    ctx.variants = ns.createVariants(ctx);
    ctx.variants.init();

    // ---- Dialog and buttons --------------------------------------------
    var trigger = host.querySelector(".engraving-preview__trigger");
    var triggerLabel = host.querySelector(".engraving-preview__trigger-label");
    var quickAddBtn = host.querySelector(".engraving-preview__quick-add");
    var dialogEl = host.querySelector(".engraving-preview__dialog");
    var closeBtn = host.querySelector(".engraving-preview__close");
    var confirmBtn = host.querySelector(".engraving-preview__confirm");
    var loadingEl = host.querySelector(".engraving-preview__loading");
    var errorEl = host.querySelector(".engraving-preview__error");
    var baseTriggerLabel = triggerLabel ? triggerLabel.textContent.trim() : "";
    var editTriggerLabel = host.getAttribute("data-edit-label") || "Edit";
    var quickAddLabel = quickAddBtn
      ? quickAddBtn.querySelector(".engraving-preview__quick-add-label")
      : null;
    var baseQuickAddLabel = quickAddLabel
      ? quickAddLabel.textContent.trim()
      : quickAddBtn
        ? quickAddBtn.textContent.trim()
        : "";
    ctx.dialogEl = dialogEl;

    function setQuickAddLoading(on) {
      if (!quickAddBtn) return;
      quickAddBtn.classList.toggle("engraving-preview__quick-add--loading", on);
      if (quickAddLabel)
        quickAddLabel.textContent = on
          ? host.getAttribute("data-adding-label") || "Adding to cart…"
          : baseQuickAddLabel;
    }

    // With text entered the trigger reads "Edit" and gets the --filled style,
    // and the quick-add button appears so the item can be added without
    // reopening the dialog.
    function updateTriggerLabel() {
      if (!trigger || !triggerLabel) return;
      var hasValue = !!input.value;
      triggerLabel.textContent = hasValue ? editTriggerLabel : baseTriggerLabel;
      trigger.classList.toggle("engraving-preview__trigger--filled", hasValue);
      if (quickAddBtn) {
        quickAddBtn.hidden = !hasValue;
        quickAddBtn.disabled = !hasValue || !ctx.variants.currentVariantIsAvailable();
      }
    }

    function updateConfirmButtonState() {
      if (!confirmBtn) return;
      confirmBtn.disabled = !input.value || !ctx.variants.currentVariantIsAvailable();
    }

    ctx.ui = {
      updateTriggerLabel: updateTriggerLabel,
      updateConfirmButtonState: updateConfirmButtonState,
    };

    if (trigger && dialogEl) {
      trigger.addEventListener("click", function () {
        dialogEl.showModal();
        ctx.cart.invalidatePendingUpload();
        ctx.render.renderInternal();
      });
      dialogEl.addEventListener("click", function (e) {
        if (state.isProcessing) return;
        if (e.target === dialogEl) dialogEl.close();
      });
      // Escape closes a <dialog> natively; 'cancel' fires first and is
      // cancelable, so it's blocked here while processing.
      dialogEl.addEventListener("cancel", function (e) {
        if (state.isProcessing) e.preventDefault();
      });
    }
    if (closeBtn && dialogEl) {
      closeBtn.addEventListener("click", function () {
        if (state.isProcessing) return;
        dialogEl.close();
      });
    }

    if (confirmBtn && dialogEl) {
      confirmBtn.addEventListener("click", function () {
        if (!input.value) {
          dialogEl.close();
          return;
        }
        ctx.cart.addEngravedItemToCart({
          onStart: function () {
            confirmBtn.disabled = true;
            if (closeBtn) closeBtn.disabled = true;
            if (loadingEl) loadingEl.hidden = false;
            if (errorEl) errorEl.hidden = true;
          },
          onFinish: function () {
            updateConfirmButtonState();
            if (closeBtn) closeBtn.disabled = false;
            if (loadingEl) loadingEl.hidden = true;
          },
          onError: function () {
            if (errorEl) errorEl.hidden = false;
          },
        });
      });
    }

    if (quickAddBtn) {
      quickAddBtn.addEventListener("click", function () {
        ctx.cart.addEngravedItemToCart({
          onStart: function () {
            quickAddBtn.disabled = true;
            setQuickAddLoading(true);
          },
          onFinish: function () {
            setQuickAddLoading(false);
            updateTriggerLabel();
          },
          onError: function () {
            if (errorEl) errorEl.hidden = false;
          },
        });
      });
    }
    input.addEventListener("input", updateTriggerLabel);
    updateTriggerLabel();
    input.addEventListener("input", updateConfirmButtonState);
    updateConfirmButtonState();

    input.addEventListener("input", function () {
      ctx.cart.mirrorToCartForms("properties[Engraving]", input.value);
    });
    ctx.cart.mirrorToCartForms("properties[Engraving]", input.value);

    if (dialogEl) ctx.cart.uploadOnDialogClose(dialogEl);
    ctx.cart.interceptThemeForms();

    host._cleanup = function () {
      ctx.variants.cleanup();
      if (host._overlayObserver) {
        host._overlayObserver.disconnect();
        host._overlayObserver = null;
      }
      if (host._onResize) {
        window.removeEventListener("resize", host._onResize);
        host._onResize = null;
      }
      ctx.render.releaseLighting();
    };
  }

  if (!window.customElements) {
    document.querySelectorAll("engraving-preview").forEach(bootEngravingPreview);
    return;
  }

  if (!customElements.get("engraving-preview")) {
    customElements.define(
      "engraving-preview",
      class extends HTMLElement {
        connectedCallback() {
          var host = this;
          requestAnimationFrame(function () {
            bootEngravingPreview(host);
          });
        }
        disconnectedCallback() {
          if (this._cleanup) this._cleanup();
        }
      },
    );
  }
})();
