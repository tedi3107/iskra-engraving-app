/*
 * Engraving preview — variants.
 *
 * Variant picking lives on this block (pills in the dialog). The preview
 * follows the selected variant's photo; the zone stays put because it's
 * expressed as percentages of the image. The theme's own picker is hidden
 * but kept in sync, and its variant changes (events, selects, radios, or a
 * silently changed id field) are followed too.
 */
(function (root) {
  var ns = (root.IskraEngraving = root.IskraEngraving || {});
  var INTERACTION_EVENTS = ["click", "change", "input", "keyup", "touchend"];

  ns.createVariants = function (ctx) {
    var core = ctx.core;
    var host = ctx.host;
    var sectionEl = ctx.sectionEl;
    var imageEl = ctx.imageEl;
    var state = ctx.state;
    var overlay = ctx.overlay;

    function parseJsonScript(selector, fallback) {
      var el = host.querySelector(selector);
      if (!el) return fallback;
      try {
        return JSON.parse(el.textContent);
      } catch (e) {
        return fallback;
      }
    }

    var variantImages = parseJsonScript(".engraving-preview__variant-images", {});
    var variantsData = parseJsonScript(".engraving-preview__variants-data", []);
    var variantPicker = host.querySelector(".engraving-preview__variant-picker");
    var variantPriceEl = host.querySelector(".engraving-preview__confirm-price");
    var moneyFormat = host.getAttribute("data-money-format") || "";
    var soldOutLabel = host.getAttribute("data-sold-out-label") || "Sold out";

    // The theme's picker is looked up again on every use, because Dawn may
    // replace its nodes after a change.
    function liveThemePicker() {
      return sectionEl
        ? sectionEl.querySelector("variant-radios, variant-selects")
        : document.querySelector("variant-radios, variant-selects");
    }

    function hideThemePicker() {
      var picker = liveThemePicker();
      if (picker) picker.style.display = "none";
    }

    function liveVariantIdField() {
      var form =
        host.closest("form") || (sectionEl && sectionEl.querySelector('form[action^="/cart/add"]'));
      if (form) {
        var field = form.querySelector('[name="id"]');
        if (field) return field;
      }
      var forms = document.querySelectorAll('form[action^="/cart/add"]');
      for (var vf = 0; vf < forms.length; vf++) {
        var candidate = forms[vf].querySelector('[name="id"]');
        if (candidate) return candidate;
      }
      return null;
    }

    function findVariantData(variantId) {
      for (var i = 0; i < variantsData.length; i++) {
        if (String(variantsData[i].id) === String(variantId)) return variantsData[i];
      }
      return null;
    }

    function currentVariantIsAvailable() {
      var current = findVariantData(state.lastSeenVariantId);
      return !current || current.available !== false;
    }

    function updateSoldOutState() {
      var current = findVariantData(state.lastSeenVariantId);
      var soldOut = !!(current && current.available === false);
      if (variantPriceEl && current) {
        variantPriceEl.textContent = soldOut
          ? soldOutLabel
          : core.formatMoney(current.price, moneyFormat);
      }
      host.classList.toggle("engraving-preview--sold-out", soldOut);
      // ctx.ui exists once the dialog controls are wired up.
      if (ctx.ui) {
        ctx.ui.updateConfirmButtonState();
        ctx.ui.updateTriggerLabel();
      }
    }

    function readSelectedOptions() {
      var options = [];
      if (!variantPicker) return options;
      variantPicker.querySelectorAll(".engraving-preview__variant-pills").forEach(function (group) {
        var selected = group.querySelector('.engraving-preview__variant-pill[data-selected="true"]');
        options.push(selected ? selected.getAttribute("data-value") : null);
      });
      return options;
    }

    function updatePillAvailability() {
      if (!variantPicker) return;
      var selected = readSelectedOptions();
      variantPicker.querySelectorAll(".engraving-preview__variant-pill").forEach(function (pill) {
        var index = parseInt(pill.getAttribute("data-option-position"), 10) - 1;
        var inStock = core.optionValueHasStock(
          variantsData,
          index,
          pill.getAttribute("data-value"),
          selected,
        );
        pill.classList.toggle("engraving-preview__variant-pill--unavailable", !inStock);
        pill.setAttribute("aria-disabled", inStock ? "false" : "true");
      });
      updateSoldOutState();
    }

    function syncVariantPicker(variantId) {
      if (!variantPicker) return;
      var current = findVariantData(variantId);
      variantPicker.querySelectorAll(".engraving-preview__variant-pill").forEach(function (pill) {
        var position = parseInt(pill.getAttribute("data-option-position"), 10) - 1;
        var isSelected =
          !!current && String(current.options[position]) === pill.getAttribute("data-value");
        if (isSelected) {
          pill.setAttribute("data-selected", "true");
        } else {
          pill.removeAttribute("data-selected");
        }
      });
      variantPicker
        .querySelectorAll(".engraving-preview__variant-option-group")
        .forEach(function (group) {
          var label = group.querySelector("[data-selected-label]");
          if (!label) return;
          var selected = group.querySelector('.engraving-preview__variant-pill[data-selected="true"]');
          if (selected) label.textContent = selected.getAttribute("data-value");
        });
      updatePillAvailability();
    }

    function syncThemePickerToVariant(variant) {
      var picker = liveThemePicker();
      hideThemePicker();
      if (!picker || !variant) return;
      variant.options.forEach(function (value, index) {
        var position = String(index + 1);
        var group = variantPicker
          ? variantPicker.querySelector(
              '.engraving-preview__variant-pills[data-option-position="' + position + '"]',
            )
          : null;
        var optionName = group ? group.getAttribute("data-option-name") : null;
        if (!optionName) return;
        var names = [optionName, optionName + "-" + position, "options[" + optionName + "]"];
        picker.querySelectorAll('input[type="radio"]').forEach(function (radio) {
          if (names.indexOf(radio.name.trim()) !== -1 && radio.value === value) radio.checked = true;
        });
        picker.querySelectorAll("select").forEach(function (select) {
          if (names.indexOf(select.name.trim()) !== -1) select.value = value;
        });
      });
      try {
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        // Event constructor can throw in older WebViews
      }
    }

    function themeSectionId() {
      var picker = liveThemePicker();
      if (picker && picker.dataset.section) return picker.dataset.section;
      var gallery = document.querySelector('media-gallery[id^="MediaGallery-"]');
      if (gallery && gallery.id) {
        return gallery.id.replace(/^MediaGallery-/, "").replace(/-duplicate$/, "");
      }
      if (sectionEl && sectionEl.id) return sectionEl.id.replace(/^shopify-section-/, "");
      return "";
    }

    function isGallerySlide(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.closest && el.closest(".engraving-preview")) return false;
      if (el.classList.contains("product__media-item")) return true;
      if (el.hasAttribute("data-media-id")) return true;
      if (el.classList.contains("swiper-slide") && el.querySelector("img")) return true;
      if (el.classList.contains("slider__slide") && el.querySelector("img")) return true;
      return !!(
        el.parentElement && el.parentElement.classList.contains("product-media-modal__content")
      );
    }

    function slidesForVariant(variant) {
      var found = [];
      var sid = themeSectionId();
      var mediaId = variant.featured_media_id && sid ? sid + "-" + variant.featured_media_id : "";
      var rawMediaId = variant.featured_media_id ? String(variant.featured_media_id) : "";
      var url = variantImages[String(variant.id)];
      var identity = url ? core.imageIdentity(url) : "";

      function addSlide(el) {
        if (!el || found.indexOf(el) !== -1) return;
        if (!isGallerySlide(el) && !(el.querySelector && el.querySelector("img"))) return;
        found.push(el);
      }

      if (mediaId || rawMediaId) {
        document.querySelectorAll("[data-media-id]").forEach(function (el) {
          var id = String(el.getAttribute("data-media-id") || "");
          if (id === mediaId || id === rawMediaId || id.slice(id.lastIndexOf("-") + 1) === rawMediaId) {
            addSlide(el);
          }
        });
      }

      if (identity) {
        overlay.candidateImages().forEach(function (img) {
          if (overlay.isThumbnailImage(img) || !overlay.imgMatchesIdentity(img, identity)) return;
          addSlide(overlay.closestGallerySlide(img) || img.parentElement);
        });
      }

      return found;
    }

    function activateVariantMedia(variant) {
      if (!variant) return;
      var sid = themeSectionId();
      var mediaId = variant.featured_media_id && sid ? sid + "-" + variant.featured_media_id : "";

      // Dawn hides variant photos until their slide is first in the list. Do
      // the same here so sold-out variants, which Dawn's picker won't select,
      // still show their photo.
      if (mediaId) {
        document.querySelectorAll("media-gallery").forEach(function (gallery) {
          try {
            if (typeof gallery.setActiveMedia === "function") gallery.setActiveMedia(mediaId, true);
          } catch (e) {
            // custom galleries may not implement Dawn's setActiveMedia
          }
        });
      }

      slidesForVariant(variant).forEach(function (slide) {
        var list = slide.parentElement;
        if (list) {
          Array.prototype.forEach.call(list.children, function (el) {
            if (isGallerySlide(el)) el.classList.remove("is-active");
          });
          if (isGallerySlide(slide)) list.prepend(slide);
        }
        slide.classList.add("is-active");
        slide.removeAttribute("hidden");
        slide.hidden = false;
      });

      overlay.refresh();
    }

    function scheduleOverlayRefreshBurst() {
      if (!host._overlayRefreshTimers) host._overlayRefreshTimers = [];
      host._overlayRefreshTimers.forEach(function (id) {
        clearTimeout(id);
      });
      host._overlayRefreshTimers = [0, 80, 250, 600].map(function (ms) {
        return setTimeout(function () {
          overlay.refresh();
          ctx.renderAllPreviews();
        }, ms);
      });
    }

    // If no visible gallery image shows the variant's photo, point the first
    // visible one at it.
    function ensureGalleryShowsVariantImage(url) {
      if (!url) return;
      var identity = core.imageIdentity(url);
      var hasMatch = overlay.candidateImages().some(function (img) {
        return (
          !overlay.isThumbnailImage(img) &&
          overlay.imgMatchesIdentity(img, identity) &&
          !overlay.isVisiblyHidden(img)
        );
      });
      if (hasMatch) return;

      var fallback = null;
      overlay.candidateImages().some(function (img) {
        if (overlay.isThumbnailImage(img) || img.closest(".engraving-preview")) return false;
        if (overlay.isVisiblyHidden(img)) return false;
        fallback = img;
        return true;
      });
      if (!fallback) return;
      fallback.removeAttribute("srcset");
      fallback.removeAttribute("sizes");
      fallback.removeAttribute("data-srcset");
      fallback.src = url;
    }

    function swapToVariantImage(variantId) {
      ctx.cart.invalidatePendingUpload();
      syncVariantPicker(variantId);

      var url = variantImages[String(variantId)];
      var variant = findVariantData(variantId);
      if (url) state.trackedIdentity = core.imageIdentity(url);
      if (variant) activateVariantMedia(variant);
      if (url) ensureGalleryShowsVariantImage(url);
      overlay.refresh();

      function finishPreview() {
        overlay.refresh();
        if (!url) {
          ctx.renderAllPreviews();
          return;
        }
        ctx.render.sampleAndApplyColor(url).then(function () {
          overlay.refresh();
          ctx.renderAllPreviews();
        });
      }

      scheduleOverlayRefreshBurst();

      if (!imageEl || !url) {
        finishPreview();
        return;
      }

      var previewReady = false;
      function onPreviewReady() {
        if (previewReady) return;
        previewReady = true;
        imageEl.removeEventListener("load", onPreviewReady);
        finishPreview();
      }
      imageEl.addEventListener("load", onPreviewReady);
      imageEl.removeAttribute("srcset");
      imageEl.removeAttribute("sizes");
      imageEl.src = url;
      if (imageEl.complete && imageEl.naturalWidth) onPreviewReady();
    }

    function applyVariant(variant) {
      if (!variant) return;
      state.lastSeenVariantId = String(variant.id);
      var field = liveVariantIdField();
      if (field) field.value = String(variant.id);

      swapToVariantImage(variant.id);

      // Dawn's picker snaps unavailable combinations back to an in-stock one,
      // so it's only notified for available variants. The image swap above
      // doesn't depend on stock.
      if (variant.available !== false) {
        if (field) field.dispatchEvent(new Event("change", { bubbles: true }));
        syncThemePickerToVariant(variant);
        state.lastSeenVariantId = String(variant.id);
        if (field) field.value = String(variant.id);
        swapToVariantImage(variant.id);
      }
    }

    // A variant change announced by the theme. Ignored while a sold-out
    // variant is selected here, because the theme would snap it back.
    function followThemeVariant(variantId) {
      var selected = findVariantData(state.lastSeenVariantId);
      if (selected && selected.available === false) return;
      state.lastSeenVariantId = String(variantId);
      swapToVariantImage(variantId);
    }

    function checkVariantChange() {
      var field = liveVariantIdField();
      if (!field) return;
      var current = field.value;
      if (!current || current === state.lastSeenVariantId) return;
      followThemeVariant(current);
    }

    function bindPills() {
      if (!variantPicker) return;
      variantPicker.querySelectorAll(".engraving-preview__variant-pill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          if (pill.disabled) return;
          var position = pill.getAttribute("data-option-position");
          var group = variantPicker.querySelector(
            '.engraving-preview__variant-pills[data-option-position="' + position + '"]',
          );
          if (group) {
            group.querySelectorAll(".engraving-preview__variant-pill").forEach(function (p) {
              p.removeAttribute("data-selected");
            });
          }
          pill.setAttribute("data-selected", "true");
          var options = readSelectedOptions();
          var optionIndex = parseInt(position, 10) - 1;
          applyVariant(
            core.findVariantByOptions(variantsData, options) ||
              core.findVariantWithOption(
                variantsData,
                optionIndex,
                pill.getAttribute("data-value"),
                options,
              ),
          );
        });
      });
    }

    function followThemeChanges() {
      if (Object.keys(variantImages).length === 0) return;
      document.addEventListener("variant:change", function (e) {
        var variant = e.detail && e.detail.variant;
        if (variant) followThemeVariant(variant.id);
      });
      var subscribe = window.subscribe;
      var pubSubEvents = window.PUB_SUB_EVENTS;
      if (typeof subscribe === "function" && pubSubEvents && pubSubEvents.variantChange) {
        subscribe(pubSubEvents.variantChange, function (event) {
          var variant = event && event.data && event.data.variant;
          if (variant) followThemeVariant(variant.id);
        });
      }
      // Fallback for themes that change the id field without any event: poll
      // it every 400ms for 5s after an interaction, every 2s otherwise, and
      // not at all while the tab is hidden.
      var lastInteraction = Date.now();
      host._markInteraction = function () {
        lastInteraction = Date.now();
      };
      INTERACTION_EVENTS.forEach(function (type) {
        document.addEventListener(type, host._markInteraction, true);
      });
      var tick = function () {
        if (!document.hidden) checkVariantChange();
        var idle = Date.now() - lastInteraction > 5000;
        host._variantPoll = setTimeout(tick, idle ? 2000 : 400);
      };
      host._variantPoll = setTimeout(tick, 400);
    }

    function init() {
      hideThemePicker();
      bindPills();
      var idField = liveVariantIdField();
      state.lastSeenVariantId = idField ? idField.value : null;
      if (state.lastSeenVariantId) swapToVariantImage(state.lastSeenVariantId);
      followThemeChanges();
    }

    function cleanup() {
      if (host._variantPoll) {
        clearTimeout(host._variantPoll);
        host._variantPoll = null;
      }
      if (host._markInteraction) {
        INTERACTION_EVENTS.forEach(function (type) {
          document.removeEventListener(type, host._markInteraction, true);
        });
        host._markInteraction = null;
      }
      if (host._overlayRefreshTimers) {
        host._overlayRefreshTimers.forEach(function (id) {
          clearTimeout(id);
        });
        host._overlayRefreshTimers = [];
      }
    }

    return {
      init: init,
      cleanup: cleanup,
      liveVariantIdField: liveVariantIdField,
      currentVariantIsAvailable: currentVariantIsAvailable,
    };
  };
})(typeof self !== "undefined" ? self : this);
