(function () {
  // Pure helpers (geometry, crop, colors, money, variant matching) live in
  // engraving-preview-core.js, loaded just before this file.
  var core = window.IskraEngravingCore;

  function bootEngravingPreview(host) {
    if (!host || host._booted) return;
    if (!core) {
      console.error("[engraving-preview] engraving-preview-core.js is not loaded");
      return;
    }

    var input = host.querySelector(".engraving-preview__input");

    // Draft persistence: the customer's in-progress engraving for this
    // product (keyed by product id) is kept in localStorage until it's added
    // to cart. The draft is one JSON object, so a new kind of choice is just
    // another key passed to saveEngravingDraft(patch).
    //
    // Drafts are cleared whenever this asset is republished: asset_url
    // carries a new fingerprint on every deploy.
    var ENGRAVING_STORAGE_PREFIX = "iskra-engraving:";
    var ENGRAVING_STORAGE_VERSION =
      host.getAttribute("data-storage-version") || "";

    (function invalidateEngravingStorageIfVersionChanged() {
      try {
        var versionKey = ENGRAVING_STORAGE_PREFIX + "version";
        if (localStorage.getItem(versionKey) === ENGRAVING_STORAGE_VERSION)
          return;
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = localStorage.key(i);
          if (key && key.indexOf(ENGRAVING_STORAGE_PREFIX) === 0)
            toRemove.push(key);
        }
        toRemove.forEach(function (key) {
          localStorage.removeItem(key);
        });
        localStorage.setItem(versionKey, ENGRAVING_STORAGE_VERSION);
      } catch (e) {
        // Storage unavailable (private mode, disabled, quota): no persistence
        // for this visitor.
      }
    })();

    var engravingStorageKey =
      ENGRAVING_STORAGE_PREFIX +
      "draft:" +
      (host.getAttribute("data-product-id") || "");

    function loadEngravingDraft() {
      try {
        var raw = localStorage.getItem(engravingStorageKey);
        var parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (e) {
        return {};
      }
    }

    // Merges patch into the stored draft. A draft without text is removed
    // rather than saved.
    function saveEngravingDraft(patch) {
      try {
        var merged = Object.assign({}, loadEngravingDraft(), patch);
        if (!merged.text) {
          localStorage.removeItem(engravingStorageKey);
          return;
        }
        localStorage.setItem(engravingStorageKey, JSON.stringify(merged));
      } catch (e) {
        // localStorage can throw in private mode or when quota is full
      }
    }

    var savedEngravingDraft = loadEngravingDraft();

    if (savedEngravingDraft.text) {
      var savedCap = input.maxLength;
      input.value =
        savedCap > 0
          ? savedEngravingDraft.text.slice(0, savedCap)
          : savedEngravingDraft.text;
    }

    function saveEngravingToStorage() {
      saveEngravingDraft({ text: input.value });
    }

    function mirrorToCartForms(name, value) {
      var forms = document.querySelectorAll('form[action^="/cart/add"]');
      forms.forEach(function (form) {
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
      document
        .querySelectorAll('form[action^="/cart/add"]')
        .forEach(function (form) {
          var hidden = form.querySelector('input[name="' + name + '"]');
          if (hidden) hidden.remove();
        });
    }
    var stage = host.querySelector(".engraving-preview__stage");
    if (!input || !stage) return;
    host._booted = true;

    var shape = stage.getAttribute("data-shape");
    var uppercaseOnly = stage.getAttribute("data-uppercase-only") === "true";
    var imageEl = stage.querySelector(".engraving-preview__image");
    var currentFontChoice =
      savedEngravingDraft.fontChoice === "one" ||
      savedEngravingDraft.fontChoice === "two"
        ? savedEngravingDraft.fontChoice
        : stage.getAttribute("data-font-choice") || "one";

    function geomAttr(name) {
      return parseFloat(
        stage.getAttribute("data-" + currentFontChoice + "-" + name),
      );
    }

    var currentFontFamily = null;
    var currentFontFallback = "serif";
    var currentBaseColorHex = "#96731f";

    function currentFontFamilyCss() {
      return currentFontFamily
        ? "'" + currentFontFamily + "', " + currentFontFallback
        : currentFontFallback;
    }

    function drawEngravingSilhouette(ctx, w, h, crop) {
      var text = input.value;
      if (!text) return;
      var fontSizePercent = geomAttr("font-size");

      // Zone coordinates are percentages of the full source photo. Without
      // crop they map straight onto this canvas; with crop (derived from the
      // target <img>'s object-fit and object-position, see
      // cropFromRenderedImage) they go through its per-axis scale and the
      // offset that a cover/contain fit introduces.
      function pxX(percent) {
        return crop
          ? (percent / 100) * crop.naturalW * crop.scaleX - crop.offsetX
          : (percent / 100) * w;
      }
      function pxY(percent) {
        return crop
          ? (percent / 100) * crop.naturalH * crop.scaleY - crop.offsetY
          : (percent / 100) * h;
      }
      function lenX(percent) {
        return crop
          ? (percent / 100) * crop.naturalW * crop.scaleX
          : (percent / 100) * w;
      }
      function lenY(percent) {
        return crop
          ? (percent / 100) * crop.naturalH * crop.scaleY
          : (percent / 100) * h;
      }

      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (shape === "straight") {
        var zx = geomAttr("x");
        var zy = geomAttr("y");
        var zw = geomAttr("width");
        var zh = geomAttr("height");
        var fontPx = (fontSizePercent / 100) * lenY(zh);
        ctx.font = fontPx + "px " + currentFontFamilyCss();
        ctx.fillText(text, pxX(zx + zw / 2), pxY(zy + zh / 2));
      } else {
        var r = lenX(geomAttr("radius"));
        var fontPx2 = (fontSizePercent / 100) * r;
        var cx = pxX(geomAttr("center-x"));
        var cy = pxY(geomAttr("center-y"));
        var startDeg = geomAttr("start-angle");
        var arcDeg = geomAttr("arc-length");
        var chars = Array.from(text);
        ctx.font = fontPx2 + "px " + currentFontFamilyCss();

        var charWidths = chars.map(function (ch) {
          return ctx.measureText(ch).width;
        });
        core
          .layoutCurvedText(charWidths, cx, cy, r, startDeg, arcDeg)
          .forEach(function (placement, i) {
            ctx.save();
            ctx.translate(placement.x, placement.y);
            ctx.rotate(((placement.angle + 90) * Math.PI) / 180);
            ctx.fillText(chars[i], 0, 0);
            ctx.restore();
          });
      }
      ctx.restore();
    }

    function renderToCanvas(canvasEl, w, h, crop) {
      if (!canvasEl || !w || !h) return;
      canvasEl.width = w;
      canvasEl.height = h;
      var ctx = canvasEl.getContext("2d");
      ctx.clearRect(0, 0, w, h);
      if (!input.value) return;

      var silhouette = document.createElement("canvas");
      silhouette.width = w;
      silhouette.height = h;
      drawEngravingSilhouette(silhouette.getContext("2d"), w, h, crop);

      var lit = renderEngravedLighting(silhouette, currentBaseColorHex);
      if (lit) {
        ctx.drawImage(lit, 0, 0);
      } else {
        ctx.drawImage(silhouette, 0, 0);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = currentBaseColorHex;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
      }
    }

    var internalCanvas = host.querySelector(
      ".engraving-preview__stage .engraving-preview__canvas",
    );

    function renderInternal() {
      if (!imageEl) return;
      renderToCanvas(internalCanvas, imageEl.clientWidth, imageEl.clientHeight);
    }

    var ownBlock = host;
    var sectionEl = ownBlock
      ? ownBlock.closest('[id^="shopify-section-"]')
      : null;
    var firstExternalImage = document.querySelector("[data-engraving-target]");
    if (!firstExternalImage && sectionEl) {
      var candidates = sectionEl.querySelectorAll("img");
      for (var i = 0; i < candidates.length; i++) {
        if (!candidates[i].closest(".engraving-preview")) {
          firstExternalImage = candidates[i];
          break;
        }
      }
    }

    // The same photo regardless of CDN host, rendered width or size suffix
    // (see core.imageIdentity).
    function imageIdentity(src) {
      return core.imageIdentity(src);
    }

    function collectImageUrls(img) {
      var urls = [];
      if (!img) return urls;
      function add(value) {
        if (!value) return;
        String(value)
          .split(",")
          .forEach(function (part) {
            var url = part.trim().split(/\s+/)[0];
            if (url && urls.indexOf(url) === -1) urls.push(url);
          });
      }
      add(img.currentSrc);
      add(img.src);
      add(img.getAttribute("src"));
      add(img.getAttribute("srcset"));
      add(img.getAttribute("data-src"));
      add(img.getAttribute("data-srcset"));
      add(img.getAttribute("data-zoom"));
      add(img.getAttribute("data-zoom-src"));
      return urls;
    }

    function imgMatchesIdentity(img, identity) {
      if (!identity || !img) return false;
      var urls = collectImageUrls(img);
      for (var i = 0; i < urls.length; i++) {
        if (imageIdentity(urls[i]) === identity) return true;
      }
      return false;
    }

    function imgMatchesTracked(img) {
      return imgMatchesIdentity(img, trackedIdentity);
    }

    function isThumbnailImage(img) {
      return !!img.closest(
        '.thumbnail-list, [id^="GalleryThumbnails"], .thumbnail-list__item, button.thumbnail, [class*="thumbnail"]',
      );
    }

    function closestGallerySlide(img) {
      if (!img) return null;
      return (
        img.closest(".product__media-item") ||
        img.closest("[data-media-id]") ||
        img.closest(".product-media-modal__content > *") ||
        img.closest(".swiper-slide") ||
        img.closest(
          'li.slider__slide, li[data-media-id], li[class*="media"]',
        ) ||
        null
      );
    }

    function isVisiblyHidden(el) {
      if (!el) return true;
      if (el.hidden || el.hasAttribute("hidden")) return true;
      if (
        el.classList.contains("hidden") ||
        el.classList.contains("visually-hidden")
      )
        return true;
      var style = window.getComputedStyle(el);
      return style.display === "none" || style.visibility === "hidden";
    }

    function shouldOverlay(img) {
      if (!img || img.closest(".engraving-preview")) return false;
      if (isThumbnailImage(img)) return false;
      if (!imgMatchesTracked(img)) return false;
      if (isVisiblyHidden(img)) return false;
      var slide = closestGallerySlide(img);
      if (slide && isVisiblyHidden(slide)) return false;
      if (slide) return true;
      if (sectionEl && sectionEl.contains(img)) return true;
      if (
        img.closest(
          '.product-media-modal, [id^="ProductModal-"], product-modal, media-gallery',
        )
      )
        return true;
      if (img.closest("dialog")) return true;
      return false;
    }

    function overlayCandidateImages() {
      var imgs = [];
      function collect(root) {
        if (!root) return;
        var list = root.querySelectorAll("img");
        for (var i = 0; i < list.length; i++) {
          if (imgs.indexOf(list[i]) === -1) imgs.push(list[i]);
        }
      }
      collect(sectionEl);
      collect(
        document.querySelector(
          'main, #MainContent, .product, [id^="MainProduct"]',
        ),
      );
      document
        .querySelectorAll(
          'media-gallery, .product__media-list, [id^="MediaGallery"], [class*="product-gallery"], [class*="product__media"]',
        )
        .forEach(collect);
      document
        .querySelectorAll(
          '.product-media-modal, [id^="ProductModal-"], product-modal',
        )
        .forEach(collect);
      return imgs;
    }

    var trackedIdentity = firstExternalImage
      ? imageIdentity(firstExternalImage.src)
      : null;

    // Every <img> currently showing this product photo, each with its own
    // overlay canvas. Zoom and lightbox views insert their own copies later,
    // so every copy is tracked and rendered independently.
    var externalTargets = [];

    function detachOverlay(target) {
      if (target.resizeObserver) {
        target.resizeObserver.disconnect();
        target.resizeObserver = null;
      }
      if (target.canvas && target.canvas.parentNode) {
        target.canvas.parentNode.removeChild(target.canvas);
      }
    }

    function attachOverlay(img) {
      for (var t = 0; t < externalTargets.length; t++) {
        if (externalTargets[t].img === img) return;
      }
      var canvas = document.createElement("canvas");
      canvas.className = "engraving-preview__canvas";
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";
      // The overlay is position:absolute, so the image's parent has to be its
      // containing block.
      var parent = img.parentNode;
      var parentPosition = parent && window.getComputedStyle(parent).position;
      if (parent && (parentPosition === "static" || !parentPosition)) {
        parent.style.position = "relative";
      }
      if (parent) parent.appendChild(canvas);
      var target = { img: img, canvas: canvas, resizeObserver: null };
      externalTargets.push(target);

      // Zoom views can animate open, so the first measurement may be 0x0.
      // Re-render whenever the image's rendered size changes instead of
      // guessing a delay.
      if (window.ResizeObserver) {
        target.resizeObserver = new ResizeObserver(function () {
          renderToTarget(target);
        });
        target.resizeObserver.observe(img);
      }
      renderToTarget(target);
    }

    function attachWhenReady(img) {
      if (img.complete && img.naturalWidth) {
        attachOverlay(img);
        return;
      }
      img.addEventListener(
        "load",
        function () {
          if (shouldOverlay(img)) attachOverlay(img);
        },
        { once: true },
      );
    }

    // Drops overlays that no longer belong (inactive variant slide, a
    // node that left the document) then attaches to whatever currently
    // should show the engraving: Dawn's .is-active gallery slide plus
    // zoom/modal copies of the same photo.
    function refreshExternalTargets() {
      externalTargets = externalTargets.filter(function (target) {
        if (target.img.isConnected && shouldOverlay(target.img)) return true;
        detachOverlay(target);
        return false;
      });

      overlayCandidateImages().forEach(function (candidate) {
        if (!shouldOverlay(candidate)) return;
        attachWhenReady(candidate);
      });
    }

    refreshExternalTargets();

    // Dawn switches variants by prepending a slide and toggling is-active
    // rather than inserting a new <img>, so class/src changes are watched as
    // well as added nodes. The body observer covers lightboxes rendered
    // outside the section. Our own canvases are ignored so attaching an
    // overlay can't retrigger this observer.
    if (window.MutationObserver) {
      var refreshScheduled = false;
      var scheduleOverlayRefresh = function () {
        if (!trackedIdentity || refreshScheduled) return;
        refreshScheduled = true;
        requestAnimationFrame(function () {
          refreshScheduled = false;
          refreshExternalTargets();
        });
      };

      var mutationLooksRelevant = function (mutation) {
        if (mutation.type === "attributes") {
          var attrTarget = mutation.target;
          if (!attrTarget || attrTarget.nodeType !== 1) return false;
          if (
            attrTarget.classList &&
            attrTarget.classList.contains("engraving-preview__canvas")
          )
            return false;
          return (
            attrTarget.nodeName === "IMG" ||
            (attrTarget.classList &&
              (attrTarget.classList.contains("product__media-item") ||
                attrTarget.classList.contains("is-active") ||
                attrTarget.classList.contains("swiper-slide") ||
                attrTarget.hasAttribute("data-media-id")))
          );
        }
        var nodes = [];
        mutation.addedNodes.forEach(function (node) {
          nodes.push(node);
        });
        mutation.removedNodes.forEach(function (node) {
          nodes.push(node);
        });
        for (var n = 0; n < nodes.length; n++) {
          var node = nodes[n];
          if (node.nodeType !== 1) continue;
          if (
            node.classList &&
            node.classList.contains("engraving-preview__canvas")
          )
            continue;
          if (node.closest && node.closest(".engraving-preview")) continue;
          if (
            node.nodeName === "IMG" ||
            (node.querySelector && node.querySelector("img"))
          )
            return true;
          if (node.classList && node.classList.contains("product__media-item"))
            return true;
        }
        return false;
      };

      host._overlayObserver = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          if (mutationLooksRelevant(mutations[m])) {
            scheduleOverlayRefresh();
            return;
          }
        }
      });
      var attrOpts = {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "src",
          "class",
          "srcset",
          "data-src",
          "data-srcset",
          "hidden",
          "style",
        ],
      };
      if (sectionEl) host._overlayObserver.observe(sectionEl, attrOpts);
      document
        .querySelectorAll(
          '.product-media-modal, [id^="ProductModal-"], product-modal',
        )
        .forEach(function (modal) {
          host._overlayObserver.observe(modal, attrOpts);
        });
      host._overlayObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }

    function objectPositionFactors(img) {
      var raw = "";
      try {
        raw = window.getComputedStyle(img).objectPosition || "";
      } catch (e) {
        raw = "";
      }
      return core.parseObjectPosition(raw);
    }

    // Same source-photo UV for every overlay. Zone percents are of the
    // full file; this is how CSS actually paints that file into THIS
    // <img> box (object-fit + object-position).
    function cropFromRenderedImage(img, boxW, boxH) {
      var naturalW = img && img.naturalWidth;
      var naturalH = img && img.naturalHeight;
      if (!naturalW || !naturalH || !boxW || !boxH) return null;
      var fit = "fill";
      try {
        fit = window.getComputedStyle(img).objectFit || "fill";
      } catch (e) {
        fit = "fill";
      }
      return core.computeCrop(
        naturalW,
        naturalH,
        boxW,
        boxH,
        fit,
        objectPositionFactors(img),
      );
    }

    function renderToTarget(target) {
      // Sizes and positions the canvas to the <img>'s own box, not its
      // parent's (which may have padding). getBoundingClientRect keeps
      // fractional pixels, which matter once scaled by the crop, and the same
      // rect feeds the crop math so positioning and crop always agree.
      if (!target.canvas || !target.canvas.parentElement) return;
      var imgRect = target.img.getBoundingClientRect();
      var canvasParent = target.canvas.parentElement;
      var parentRect = canvasParent.getBoundingClientRect();
      var dW = imgRect.width;
      var dH = imgRect.height;
      // top/left are relative to the parent's scrolled content: add the
      // parent's scroll offset and subtract its border (both 0 for ordinary
      // parents).
      target.canvas.style.top =
        imgRect.top -
        parentRect.top -
        canvasParent.clientTop +
        canvasParent.scrollTop +
        "px";
      target.canvas.style.left =
        imgRect.left -
        parentRect.left -
        canvasParent.clientLeft +
        canvasParent.scrollLeft +
        "px";
      target.canvas.style.width = dW + "px";
      target.canvas.style.height = dH + "px";

      var crop = cropFromRenderedImage(target.img, dW, dH);
      renderToCanvas(target.canvas, dW, dH, crop);
    }

    function renderExternal() {
      externalTargets.forEach(renderToTarget);
    }

    // Coalesces re-render requests (keystrokes, font loads, variant swaps,
    // resizes) into one per animation frame.
    var renderAllQueued = false;
    function renderAllPreviews() {
      if (renderAllQueued) return;
      renderAllQueued = true;
      requestAnimationFrame(function () {
        renderAllQueued = false;
        renderInternal();
        renderExternal();
      });
    }

    var fontPicker = host.querySelector(".engraving-preview__font-picker");

    function applyFontChoice(choice) {
      currentFontChoice = choice;
      var family = stage.getAttribute("data-font-" + choice + "-family");
      var fallback = stage.getAttribute("data-font-" + choice + "-fallback");
      currentFontFamily = family;
      currentFontFallback = fallback || "serif";

      sampleAndApplyColor(imageEl && imageEl.src);

      if (family && document.fonts && document.fonts.load) {
        var fontSizePercent = geomAttr("font-size");
        var boxW = (imageEl && imageEl.clientWidth) || 400;
        var boxH = (imageEl && imageEl.clientHeight) || 400;
        var fontPx =
          shape === "straight"
            ? (fontSizePercent / 100) * (geomAttr("height") / 100) * boxH
            : (fontSizePercent / 100) * (geomAttr("radius") / 100) * boxW;
        var loadPx = Math.max(16, Math.round(fontPx));
        document.fonts
          .load(loadPx + 'px "' + family + '"')
          .then(renderAllPreviews)
          .catch(function () {
            // face may already be cached or the load may be blocked
          });
      }

      if (family) {
        mirrorToCartForms("properties[Engraving Font]", family);
      }

      invalidatePendingUpload();
      saveEngravingDraft({ fontChoice: choice });
    }

    if (fontPicker) {
      var radios = fontPicker.querySelectorAll('input[type="radio"]');
      radios.forEach(function (radio) {
        // Sync the pills with currentFontChoice, which may come from a saved
        // draft rather than the Liquid-rendered default.
        radio.checked = radio.value === currentFontChoice;
        radio.addEventListener("change", function () {
          if (radio.checked) applyFontChoice(radio.value);
        });
      });
    }
    applyFontChoice(currentFontChoice);

    function averageColor(src, xPercent, yPercent, sizePercent) {
      return new Promise(function (resolve) {
        var probe = new Image();
        probe.crossOrigin = "anonymous";
        probe.onload = function () {
          try {
            var canvas = document.createElement("canvas");
            canvas.width = probe.naturalWidth;
            canvas.height = probe.naturalHeight;
            var ctx = canvas.getContext("2d");
            ctx.drawImage(probe, 0, 0);
            var sw = Math.max(
              4,
              Math.round((sizePercent / 100) * probe.naturalWidth),
            );
            var sh = Math.max(
              4,
              Math.round((sizePercent / 100) * probe.naturalHeight),
            );
            var sx = Math.max(
              0,
              Math.min(
                probe.naturalWidth - sw,
                Math.round((xPercent / 100) * probe.naturalWidth - sw / 2),
              ),
            );
            var sy = Math.max(
              0,
              Math.min(
                probe.naturalHeight - sh,
                Math.round((yPercent / 100) * probe.naturalHeight - sh / 2),
              ),
            );
            var data = ctx.getImageData(sx, sy, sw, sh).data;
            var r = 0,
              g = 0,
              b = 0,
              n = 0;
            for (var i = 0; i < data.length; i += 4) {
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              n++;
            }
            resolve({
              r: Math.round(r / n),
              g: Math.round(g / n),
              b: Math.round(b / n),
            });
          } catch (e) {
            resolve(null);
          }
        };
        probe.onerror = function () {
          resolve(null);
        };
        probe.src = src;
      });
    }

    function toHex(rgb) {
      return core.toHex(rgb);
    }

    function sampleAndApplyColor(imgOrUrl) {
      var src =
        typeof imgOrUrl === "string" ? imgOrUrl : imgOrUrl && imgOrUrl.src;
      if (!src) return Promise.resolve();
      var xPercent, yPercent;
      if (shape === "straight") {
        xPercent = geomAttr("x") + geomAttr("width") / 2;
        yPercent = geomAttr("y") + geomAttr("height") / 2;
      } else {
        var startDeg = geomAttr("start-angle");
        var arcDeg = geomAttr("arc-length");
        var midRad = ((startDeg + arcDeg / 2) * Math.PI) / 180;
        var radiusPercent = geomAttr("radius");
        xPercent = geomAttr("center-x") + radiusPercent * Math.cos(midRad);
        yPercent = geomAttr("center-y") + radiusPercent * Math.sin(midRad);
      }
      return averageColor(src, xPercent, yPercent, 8).then(function (rgb) {
        if (rgb) currentBaseColorHex = toHex(rgb);
        renderAllPreviews();
      });
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

    whenImageReady(imageEl, function () {
      sampleAndApplyColor(imageEl && imageEl.src);
    });
    if (firstExternalImage) {
      whenImageReady(firstExternalImage, renderExternal);
    }
    host._onResize = renderAllPreviews;
    window.addEventListener("resize", host._onResize);

    // Uppercases the actual value (CSS text-transform only changes how it
    // looks) before the other input listeners run, keeping the caret where it
    // was.
    if (uppercaseOnly) {
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
      charCounterEl.textContent = maxLength
        ? len + "/" + maxLength
        : String(len);
      charCounterEl.classList.toggle(
        "engraving-preview__char-counter--limit",
        !!maxLength && len >= maxLength,
      );
    }

    input.addEventListener("input", function () {
      invalidatePendingUpload();
      refreshExternalTargets();
      renderAllPreviews();
    });
    input.addEventListener("input", updateCharCounter);
    input.addEventListener("input", saveEngravingToStorage);
    updateCharCounter();

    // The preview follows the selected variant's photo; the zone stays put
    // because it's expressed as percentages of the image. Themes announce
    // variant changes differently (events, selects, radios, or silently
    // setting the id field), so the common events are handled and the id
    // field is polled as a fallback.
    var variantImagesScript = host.querySelector(
      ".engraving-preview__variant-images",
    );
    var variantImages = {};
    if (variantImagesScript) {
      try {
        variantImages = JSON.parse(variantImagesScript.textContent);
      } catch (e) {
        variantImages = {};
      }
    }

    var variantsDataScript = host.querySelector(
      ".engraving-preview__variants-data",
    );
    var variantsData = [];
    if (variantsDataScript) {
      try {
        variantsData = JSON.parse(variantsDataScript.textContent);
      } catch (e) {
        variantsData = [];
      }
    }

    // Variant picking lives on this component. The theme's own picker is
    // hidden and looked up again on every use, because Dawn may replace its
    // nodes after a change.
    var variantPicker = host.querySelector(
      ".engraving-preview__variant-picker",
    );
    var variantPriceEl = host.querySelector(
      ".engraving-preview__confirm-price",
    );

    function liveThemePicker() {
      return sectionEl
        ? sectionEl.querySelector("variant-radios, variant-selects")
        : document.querySelector("variant-radios, variant-selects");
    }

    function hideThemePicker() {
      var picker = liveThemePicker();
      if (picker) picker.style.display = "none";
    }
    hideThemePicker();

    function liveVariantIdField() {
      var form =
        host.closest("form") ||
        (sectionEl && sectionEl.querySelector('form[action^="/cart/add"]'));
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

    var moneyFormat = host.getAttribute("data-money-format") || "";
    var soldOutLabel = host.getAttribute("data-sold-out-label") || "Sold out";

    function formatMoney(cents) {
      return core.formatMoney(cents, moneyFormat);
    }

    function findVariantData(variantId) {
      for (var i = 0; i < variantsData.length; i++) {
        if (String(variantsData[i].id) === String(variantId))
          return variantsData[i];
      }
      return null;
    }

    function findVariantByOptions(options) {
      return core.findVariantByOptions(variantsData, options);
    }

    function optionValueHasStock(optionIndex, value, selectedOptions) {
      return core.optionValueHasStock(
        variantsData,
        optionIndex,
        value,
        selectedOptions,
      );
    }

    function currentVariantIsAvailable() {
      var current = findVariantData(lastSeenVariantId);
      return !current || current.available !== false;
    }

    function updateSoldOutState() {
      var current = findVariantData(lastSeenVariantId);
      var soldOut = !!(current && current.available === false);
      if (variantPriceEl && current) {
        variantPriceEl.textContent = soldOut
          ? soldOutLabel
          : formatMoney(current.price);
      }
      host.classList.toggle("engraving-preview--sold-out", soldOut);
      if (typeof updateConfirmButtonState === "function")
        updateConfirmButtonState();
      if (typeof updateTriggerLabel === "function") updateTriggerLabel();
    }

    function updatePillAvailability() {
      if (!variantPicker) return;
      var selected = readSelectedOptions();
      variantPicker
        .querySelectorAll(".engraving-preview__variant-pill")
        .forEach(function (pill) {
          var index =
            parseInt(pill.getAttribute("data-option-position"), 10) - 1;
          var inStock = optionValueHasStock(
            index,
            pill.getAttribute("data-value"),
            selected,
          );
          pill.classList.toggle(
            "engraving-preview__variant-pill--unavailable",
            !inStock,
          );
          pill.setAttribute("aria-disabled", inStock ? "false" : "true");
        });
      updateSoldOutState();
    }

    function syncVariantPicker(variantId) {
      if (!variantPicker) return;
      var current = findVariantData(variantId);
      variantPicker
        .querySelectorAll(".engraving-preview__variant-pill")
        .forEach(function (pill) {
          var position =
            parseInt(pill.getAttribute("data-option-position"), 10) - 1;
          var isSelected =
            !!current &&
            String(current.options[position]) ===
              pill.getAttribute("data-value");
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
          var selected = group.querySelector(
            '.engraving-preview__variant-pill[data-selected="true"]',
          );
          if (selected) label.textContent = selected.getAttribute("data-value");
        });
      updatePillAvailability();
    }

    function optionControlNames(optionName, optionPosition) {
      return [
        optionName,
        optionName + "-" + optionPosition,
        "options[" + optionName + "]",
      ];
    }

    function syncThemePickerToVariant(variant) {
      var picker = liveThemePicker();
      hideThemePicker();
      if (!picker || !variant) return;
      variant.options.forEach(function (value, index) {
        var position = String(index + 1);
        var group = variantPicker
          ? variantPicker.querySelector(
              '.engraving-preview__variant-pills[data-option-position="' +
                position +
                '"]',
            )
          : null;
        var optionName = group ? group.getAttribute("data-option-name") : null;
        if (!optionName) return;
        var names = optionControlNames(optionName, position);
        picker
          .querySelectorAll('input[type="radio"]')
          .forEach(function (radio) {
            if (
              names.indexOf(radio.name.trim()) !== -1 &&
              radio.value === value
            )
              radio.checked = true;
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
      var gallery = document.querySelector(
        'media-gallery[id^="MediaGallery-"]',
      );
      if (gallery && gallery.id) {
        return gallery.id
          .replace(/^MediaGallery-/, "")
          .replace(/-duplicate$/, "");
      }
      if (sectionEl && sectionEl.id)
        return sectionEl.id.replace(/^shopify-section-/, "");
      return "";
    }

    function isGallerySlide(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.closest && el.closest(".engraving-preview")) return false;
      if (el.classList.contains("product__media-item")) return true;
      if (el.hasAttribute("data-media-id")) return true;
      if (el.classList.contains("swiper-slide") && el.querySelector("img"))
        return true;
      if (el.classList.contains("slider__slide") && el.querySelector("img"))
        return true;
      return !!(
        el.parentElement &&
        el.parentElement.classList.contains("product-media-modal__content")
      );
    }

    function slidesForVariant(variant) {
      var found = [];
      var sid = themeSectionId();
      var mediaId =
        variant.featured_media_id && sid
          ? sid + "-" + variant.featured_media_id
          : "";
      var rawMediaId = variant.featured_media_id
        ? String(variant.featured_media_id)
        : "";
      var url = variantImages[String(variant.id)];
      var identity = url ? imageIdentity(url) : "";

      function addSlide(el) {
        if (!el || found.indexOf(el) !== -1) return;
        if (
          !isGallerySlide(el) &&
          !(el.querySelector && el.querySelector("img"))
        )
          return;
        found.push(el);
      }

      if (mediaId || rawMediaId) {
        document.querySelectorAll("[data-media-id]").forEach(function (el) {
          var id = String(el.getAttribute("data-media-id") || "");
          if (
            id === mediaId ||
            id === rawMediaId ||
            id.slice(id.lastIndexOf("-") + 1) === rawMediaId
          ) {
            addSlide(el);
          }
        });
      }

      if (identity) {
        overlayCandidateImages().forEach(function (img) {
          if (isThumbnailImage(img) || !imgMatchesIdentity(img, identity))
            return;
          addSlide(closestGallerySlide(img) || img.parentElement);
        });
      }

      return found;
    }

    function activateVariantMedia(variant) {
      if (!variant) return;
      var sid = themeSectionId();
      var mediaId =
        variant.featured_media_id && sid
          ? sid + "-" + variant.featured_media_id
          : "";

      // Dawn hides variant photos until their slide is first in the list. Do
      // the same here so sold-out variants, which Dawn's picker won't select,
      // still show their photo.
      if (mediaId) {
        document.querySelectorAll("media-gallery").forEach(function (gallery) {
          try {
            if (typeof gallery.setActiveMedia === "function")
              gallery.setActiveMedia(mediaId, true);
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

      refreshExternalTargets();
    }

    function findVariantWithOption(optionIndex, value, selectedOptions) {
      return core.findVariantWithOption(
        variantsData,
        optionIndex,
        value,
        selectedOptions,
      );
    }

    function applyVariant(variant) {
      if (!variant) return;
      lastSeenVariantId = String(variant.id);
      var field = liveVariantIdField();
      if (field) field.value = String(variant.id);

      swapToVariantImage(variant.id);

      // Dawn's picker snaps unavailable combinations back to an in-stock one,
      // so it's only notified for available variants. The image swap above
      // doesn't depend on stock.
      if (variant.available !== false) {
        if (field) field.dispatchEvent(new Event("change", { bubbles: true }));
        syncThemePickerToVariant(variant);
        lastSeenVariantId = String(variant.id);
        if (field) field.value = String(variant.id);
        swapToVariantImage(variant.id);
      }
    }

    function readSelectedOptions() {
      var options = [];
      if (!variantPicker) return options;
      variantPicker
        .querySelectorAll(".engraving-preview__variant-pills")
        .forEach(function (group) {
          var selected = group.querySelector(
            '.engraving-preview__variant-pill[data-selected="true"]',
          );
          options.push(selected ? selected.getAttribute("data-value") : null);
        });
      return options;
    }

    if (variantPicker) {
      variantPicker
        .querySelectorAll(".engraving-preview__variant-pill")
        .forEach(function (pill) {
          pill.addEventListener("click", function () {
            if (pill.disabled) return;
            var position = pill.getAttribute("data-option-position");
            var group = variantPicker.querySelector(
              '.engraving-preview__variant-pills[data-option-position="' +
                position +
                '"]',
            );
            if (group) {
              group
                .querySelectorAll(".engraving-preview__variant-pill")
                .forEach(function (p) {
                  p.removeAttribute("data-selected");
                });
            }
            pill.setAttribute("data-selected", "true");
            var options = readSelectedOptions();
            var optionIndex = parseInt(position, 10) - 1;
            applyVariant(
              findVariantByOptions(options) ||
                findVariantWithOption(
                  optionIndex,
                  pill.getAttribute("data-value"),
                  options,
                ),
            );
          });
        });
    }

    var variantIdField = liveVariantIdField();
    var lastSeenVariantId = variantIdField ? variantIdField.value : null;

    function scheduleOverlayRefreshBurst() {
      if (!host._overlayRefreshTimers) host._overlayRefreshTimers = [];
      host._overlayRefreshTimers.forEach(function (id) {
        clearTimeout(id);
      });
      host._overlayRefreshTimers = [0, 80, 250, 600].map(function (ms) {
        return setTimeout(function () {
          refreshExternalTargets();
          renderAllPreviews();
        }, ms);
      });
    }

    function ensureGalleryShowsVariantImage(url) {
      if (!url) return;
      var identity = imageIdentity(url);
      var hasMatch = overlayCandidateImages().some(function (img) {
        return (
          !isThumbnailImage(img) &&
          imgMatchesIdentity(img, identity) &&
          !isVisiblyHidden(img)
        );
      });
      if (hasMatch) return;

      var fallback = null;
      overlayCandidateImages().some(function (img) {
        if (isThumbnailImage(img) || img.closest(".engraving-preview"))
          return false;
        if (isVisiblyHidden(img)) return false;
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
      invalidatePendingUpload();
      syncVariantPicker(variantId);

      var url = variantImages[String(variantId)];
      var variant = findVariantData(variantId);
      if (url) trackedIdentity = imageIdentity(url);
      if (variant) activateVariantMedia(variant);
      if (url) ensureGalleryShowsVariantImage(url);
      refreshExternalTargets();

      function finishPreview() {
        refreshExternalTargets();
        if (!url) {
          renderAllPreviews();
          return;
        }
        sampleAndApplyColor(url).then(function () {
          refreshExternalTargets();
          renderAllPreviews();
        });
      }

      scheduleOverlayRefreshBurst();

      if (!imageEl) {
        finishPreview();
        return;
      }

      if (!url) {
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

    if (lastSeenVariantId) {
      swapToVariantImage(lastSeenVariantId);
    }

    function checkVariantChange() {
      var field = liveVariantIdField();
      if (!field) return;
      var current = field.value;
      if (!current || current === lastSeenVariantId) return;
      var selected = findVariantData(lastSeenVariantId);
      if (selected && selected.available === false) return;
      lastSeenVariantId = current;
      swapToVariantImage(current);
    }

    if (Object.keys(variantImages).length > 0) {
      document.addEventListener("variant:change", function (e) {
        var variant = e.detail && e.detail.variant;
        if (!variant) return;
        var selected = findVariantData(lastSeenVariantId);
        if (selected && selected.available === false) return;
        lastSeenVariantId = String(variant.id);
        swapToVariantImage(variant.id);
      });
      var subscribeToVariantChange = window.subscribe;
      var pubSubEvents = window.PUB_SUB_EVENTS;
      if (
        typeof subscribeToVariantChange === "function" &&
        pubSubEvents &&
        pubSubEvents.variantChange
      ) {
        subscribeToVariantChange(pubSubEvents.variantChange, function (event) {
          var variant = event && event.data && event.data.variant;
          if (!variant) return;
          var selected = findVariantData(lastSeenVariantId);
          if (selected && selected.available === false) return;
          lastSeenVariantId = String(variant.id);
          swapToVariantImage(variant.id);
        });
      }
      // Fallback for themes that change the id field without any event: poll
      // it every 400ms for 5s after an interaction, every 2s otherwise, and
      // not at all while the tab is hidden.
      var lastInteraction = Date.now();
      host._markInteraction = function () {
        lastInteraction = Date.now();
      };
      ["click", "change", "input", "keyup", "touchend"].forEach(function (type) {
        document.addEventListener(type, host._markInteraction, true);
      });
      var variantPollTick = function () {
        if (!document.hidden) checkVariantChange();
        var idle = Date.now() - lastInteraction > 5000;
        host._variantPoll = setTimeout(variantPollTick, idle ? 2000 : 400);
      };
      host._variantPoll = setTimeout(variantPollTick, 400);
    }

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

    function setQuickAddLoading(on) {
      if (!quickAddBtn) return;
      quickAddBtn.classList.toggle("engraving-preview__quick-add--loading", on);
      if (quickAddLabel)
        quickAddLabel.textContent = on
          ? host.getAttribute("data-adding-label") || "Adding to cart…"
          : baseQuickAddLabel;
    }

    // True during upload + add-to-cart, from either button. Blocks closing
    // the dialog and starting a second, overlapping add.
    var isProcessing = false;

    // A captured preview matches one text + font + photo combination. When
    // any of them changes it's dropped, so the next add (or closing the
    // dialog) captures a fresh one. An upload already in progress belongs to
    // that click and is left alone.
    function invalidatePendingUpload() {
      if (isProcessing) return;
      pendingUpload = null;
      clearFromCartForms("properties[_Engraved Preview]");
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
        quickAddBtn.disabled = !hasValue || !currentVariantIsAvailable();
      }
    }

    function updateConfirmButtonState() {
      if (!confirmBtn) return;
      confirmBtn.disabled = !input.value || !currentVariantIsAvailable();
    }

    if (trigger && dialogEl) {
      trigger.addEventListener("click", function () {
        dialogEl.showModal();
        invalidatePendingUpload();
        renderInternal();
      });
      dialogEl.addEventListener("click", function (e) {
        if (isProcessing) return;
        if (e.target === dialogEl) dialogEl.close();
      });
      // Escape closes a <dialog> natively; 'cancel' fires first and is
      // cancelable, so it's blocked here while processing.
      dialogEl.addEventListener("cancel", function (e) {
        if (isProcessing) e.preventDefault();
      });
    }
    if (closeBtn && dialogEl) {
      closeBtn.addEventListener("click", function () {
        if (isProcessing) return;
        dialogEl.close();
      });
    }

    // Shared by the dialog's confirm button and quick-add, which differ only
    // in the UI they toggle. Returns false and runs no callbacks when an add
    // is already in progress.
    function addEngravedItemToCart(callbacks) {
      if (isProcessing || !input.value || !currentVariantIsAvailable())
        return false;
      isProcessing = true;
      if (callbacks.onStart) callbacks.onStart();

      function finishProcessing() {
        isProcessing = false;
        if (callbacks.onFinish) callbacks.onFinish();
      }

      pendingUpload = uploadEngravingImage();
      pendingUpload
        .then(function (previewUrl) {
          // Adds through the cart AJAX API, so this works even when the
          // product page has no add-to-cart button of its own.
          var properties = { Engraving: input.value };
          if (currentFontFamily)
            properties["Engraving Font"] = currentFontFamily;
          if (previewUrl) properties["_Engraved Preview"] = previewUrl;
          var idField = liveVariantIdField();

          return fetch("/cart/add.js", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              items: [
                {
                  id: idField ? idField.value : null,
                  quantity: 1,
                  properties: properties,
                },
              ],
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
          pendingUpload = null;
          finishProcessing();
          // Clear the input so the trigger reverts to "Personalize" and
          // quick-add hides. Dispatching 'input' resets the counter, buttons
          // and saved draft through their existing listeners.
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (dialogEl.open) dialogEl.close();
        })
        .catch(function () {
          finishProcessing();
          if (callbacks.onError) callbacks.onError();
        });
      return true;
    }

    if (confirmBtn && dialogEl) {
      confirmBtn.addEventListener("click", function () {
        if (!input.value) {
          dialogEl.close();
          return;
        }
        addEngravedItemToCart({
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
        addEngravedItemToCart({
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
      mirrorToCartForms("properties[Engraving]", input.value);
    });
    mirrorToCartForms("properties[Engraving]", input.value);

    // Best-effort side-cart refresh: the theme's
    // <cart-drawer>.renderContents() (swaps in the sections requested in
    // /cart/add.js and opens the drawer), else its open(), else common cart
    // events (harmless if nothing listens).
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
        // an empty cart the drawer can still look empty. Removed here once
        // the add has succeeded.
        cartDrawer.classList.remove("is-empty");
        cartDrawer.renderContents(cartAddData);
        return;
      }
      if (cartDrawer && typeof cartDrawer.open === "function") {
        cartDrawer.open();
        return;
      }
      ["cart:updated", "cart:refresh", "cart:build", "cart:open"].forEach(
        function (name) {
          document.dispatchEvent(new CustomEvent(name, { bubbles: true }));
        },
      );
    }

    function highlightFromBase(base) {
      return core.highlightFromBase(base);
    }

    function hexToRgb01(hex) {
      return core.hexToRgb01(hex);
    }

    // One WebGL context per block, created on first use and reused (browsers
    // cap live contexts at roughly 16). The returned canvas is shared, so
    // callers must draw it right away.
    var lighting = null;

    var LIGHTING_VS =
      "attribute vec2 aPos; varying vec2 vUv;" +
      "void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }";
    var LIGHTING_FS =
      "precision highp float;" +
      "uniform sampler2D uHeight; uniform vec2 uTexel;" +
      "uniform vec3 uLightDir; uniform vec3 uBase; uniform vec3 uHi;" +
      "varying vec2 vUv;" +
      "void main() {" +
      "  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);" +
      "  float h = texture2D(uHeight, uv).a;" +
      "  float hL = texture2D(uHeight, uv - vec2(uTexel.x, 0.0)).a;" +
      "  float hR = texture2D(uHeight, uv + vec2(uTexel.x, 0.0)).a;" +
      "  float hD = texture2D(uHeight, uv - vec2(0.0, uTexel.y)).a;" +
      "  float hU = texture2D(uHeight, uv + vec2(0.0, uTexel.y)).a;" +
      "  float strength = 14.0;" +
      "  vec3 normal = normalize(vec3((hL - hR) * strength, (hD - hU) * strength, 1.0));" +
      "  vec3 lightDir = normalize(uLightDir);" +
      "  float diffuse = max(dot(normal, lightDir), 0.0);" +
      "  vec3 viewDir = vec3(0.0, 0.0, 1.0);" +
      "  vec3 halfDir = normalize(lightDir + viewDir);" +
      "  float specular = pow(max(dot(normal, halfDir), 0.0), 24.0);" +
      "  vec3 color = uBase * (0.35 + 0.75 * diffuse) + uHi * specular * 1.1;" +
      "  gl_FragColor = vec4(color, h);" +
      "}";

    function createLightingContext() {
      var out = document.createElement("canvas");
      var gl = out.getContext("webgl");
      if (!gl) return null;

      function compile(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
      }
      var vs = compile(gl.VERTEX_SHADER, LIGHTING_VS);
      var fs = compile(gl.FRAGMENT_SHADER, LIGHTING_FS);
      if (!vs || !fs) return null;
      var prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);

      var quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      var posLoc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      gl.uniform1i(gl.getUniformLocation(prog, "uHeight"), 0);
      gl.uniform3f(gl.getUniformLocation(prog, "uLightDir"), -0.6, 0.6, 0.5);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);

      var ctxInfo = {
        out: out,
        gl: gl,
        tex: tex,
        uTexel: gl.getUniformLocation(prog, "uTexel"),
        uBase: gl.getUniformLocation(prog, "uBase"),
        uHi: gl.getUniformLocation(prog, "uHi"),
      };
      // If the browser reclaims the context, rebuild it on the next render;
      // that one frame falls back to a flat colour.
      out.addEventListener(
        "webglcontextlost",
        function (e) {
          e.preventDefault();
          if (lighting === ctxInfo) lighting = null;
        },
        false,
      );
      return ctxInfo;
    }

    function releaseLightingContext() {
      if (!lighting) return;
      try {
        var ext = lighting.gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch (e) {
        // already lost or unsupported — nothing to release
      }
      lighting = null;
    }

    function renderEngravedLighting(silhouette, baseColorHex) {
      var w = silhouette.width;
      var h = silhouette.height;
      if (!lighting || lighting.gl.isContextLost()) {
        lighting = createLightingContext();
      }
      if (!lighting) return null;

      var out = lighting.out;
      var gl = lighting.gl;
      // Resizing also clears the drawing buffer.
      out.width = w;
      out.height = h;

      gl.bindTexture(gl.TEXTURE_2D, lighting.tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        silhouette,
      );

      var base = hexToRgb01(baseColorHex);
      var hi = highlightFromBase(base);
      gl.uniform2f(lighting.uTexel, 1 / w, 1 / h);
      gl.uniform3f(lighting.uBase, base[0], base[1], base[2]);
      gl.uniform3f(lighting.uHi, hi[0], hi[1], hi[2]);

      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      return out;
    }

    function captureEngravingSnapshot() {
      return new Promise(function (resolve) {
        if (!imageEl || !imageEl.naturalWidth) return resolve(null);
        var maxDimension = 1400;
        var scale = Math.min(
          1,
          maxDimension / Math.max(imageEl.naturalWidth, imageEl.naturalHeight),
        );
        var naturalW = Math.round(imageEl.naturalWidth * scale);
        var naturalH = Math.round(imageEl.naturalHeight * scale);

        var canvas = document.createElement("canvas");
        canvas.width = naturalW;
        canvas.height = naturalH;
        var ctx = canvas.getContext("2d");

        var baseImg = new Image();
        baseImg.crossOrigin = "anonymous";
        baseImg.onload = function () {
          ctx.drawImage(baseImg, 0, 0, naturalW, naturalH);

          var silhouette = document.createElement("canvas");
          silhouette.width = naturalW;
          silhouette.height = naturalH;
          drawEngravingSilhouette(
            silhouette.getContext("2d"),
            naturalW,
            naturalH,
          );

          var lit = renderEngravedLighting(silhouette, currentBaseColorHex);
          if (lit) {
            ctx.drawImage(lit, 0, 0);
          } else {
            ctx.drawImage(silhouette, 0, 0);
            ctx.globalCompositeOperation = "source-in";
            ctx.fillStyle = currentBaseColorHex;
            ctx.fillRect(0, 0, naturalW, naturalH);
            ctx.globalCompositeOperation = "source-over";
          }

          canvas.toBlob(
            function (blob) {
              resolve(blob);
            },
            "image/jpeg",
            0.92,
          );
        };
        baseImg.onerror = function () {
          resolve(null);
        };
        baseImg.src = imageEl.src;
      });
    }

    // Capture, upload and (if Shopify is still processing the image) status
    // polling share an 8s budget; after that the item is added without a
    // preview.
    var UPLOAD_DEADLINE_MS = 8000;
    var UPLOAD_ENDPOINT = "/apps/engraving/upload-preview";

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

    function uploadEngravingImage() {
      var deadline = Date.now() + UPLOAD_DEADLINE_MS;
      var timeout = delay(UPLOAD_DEADLINE_MS).then(function () {
        return null;
      });
      var work = captureEngravingSnapshot()
        .then(function (blob) {
          if (!blob) return null;
          var uploadForm = new FormData();
          uploadForm.append("image", blob, "engraving.jpg");
          return fetch(UPLOAD_ENDPOINT, {
            method: "POST",
            body: uploadForm,
          }).then(function (res) {
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
            mirrorToCartForms("properties[_Engraved Preview]", data.url);
            return data.url;
          }
          return null;
        })
        .catch(function () {
          return null;
        });
    }

    var pendingUpload = null;

    // For customers who close the dialog without using its Add button (e.g.
    // to use the theme's own button): start the upload now. No-op if one is
    // already pending.
    dialogEl.addEventListener("close", function () {
      if (!input.value || pendingUpload) return;
      pendingUpload = uploadEngravingImage();
    });

    document
      .querySelectorAll('form[action^="/cart/add"]')
      .forEach(function (form) {
        var buttons = form.querySelectorAll(
          'button[type="submit"], input[type="submit"]',
        );
        buttons.forEach(function (button) {
          button.addEventListener(
            "click",
            function (e) {
              if (button.dataset.engravingReady === "true") {
                delete button.dataset.engravingReady;
                return;
              }
              var engravingField = form.querySelector(
                'input[name="properties[Engraving]"]',
              );
              if (!engravingField || !engravingField.value) return;

              e.preventDefault();
              e.stopImmediatePropagation();

              var upload = pendingUpload || uploadEngravingImage();
              upload.then(function () {
                button.dataset.engravingReady = "true";
                button.click();
              });
            },
            true,
          );
        });
      });

    host._cleanup = function () {
      if (host._variantPoll) {
        clearTimeout(host._variantPoll);
        host._variantPoll = null;
      }
      if (host._markInteraction) {
        ["click", "change", "input", "keyup", "touchend"].forEach(function (type) {
          document.removeEventListener(type, host._markInteraction, true);
        });
        host._markInteraction = null;
      }
      if (host._overlayObserver) {
        host._overlayObserver.disconnect();
        host._overlayObserver = null;
      }
      if (host._overlayRefreshTimers) {
        host._overlayRefreshTimers.forEach(function (id) {
          clearTimeout(id);
        });
        host._overlayRefreshTimers = [];
      }
      if (host._onResize) {
        window.removeEventListener("resize", host._onResize);
        host._onResize = null;
      }
      releaseLightingContext();
    };
  }

  if (!window.customElements) {
    document
      .querySelectorAll("engraving-preview")
      .forEach(bootEngravingPreview);
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
