(function () {
  function bootEngravingPreview(host) {
    if (!host || host._booted) return;

    var input = host.querySelector(".engraving-preview__input");

    // Local storage persistence: remembers everything about this
    // customer's in-progress engraving for THIS product (keyed by
    // product id, so every product's own draft is kept separate) across
    // a refresh or coming back later, until they actually complete an
    // order with it. The draft is a single JSON object rather than just
    // the typed text — today that's { text, fontChoice }, and whatever
    // else this app grows to let a customer choose later (a color, a
    // symbol, anything) just becomes another key saved through the same
    // saveEngravingDraft(patch) below, merged in alongside what's
    // already there, with no changes needed to the load/merge/version
    // machinery itself.
    //
    // Drafts are wiped whenever this theme-app-extension JS asset is
    // republished. Shopify puts a new version fingerprint on asset_url
    // at deploy time, so we don't have to bump a number by hand.
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
        // Storage unavailable (private browsing, disabled, quota) —
        // persistence just won't work for this visitor; nothing to fix.
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

    // Merges patch into whatever draft is already stored (so saving the
    // text just now doesn't clobber a font choice saved a moment ago,
    // or vice versa) and writes the result back in one go. A draft with
    // no actual text isn't worth keeping — there's nothing meaningful to
    // restore — so that case clears the key instead of writing one.
    function saveEngravingDraft(patch) {
      try {
        var merged = Object.assign({}, loadEngravingDraft(), patch);
        if (!merged.text) {
          localStorage.removeItem(engravingStorageKey);
          return;
        }
        localStorage.setItem(engravingStorageKey, JSON.stringify(merged));
      } catch (e) {}
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

      // Zone coordinates are percentages of the FULL source photo. That
      // maps directly onto this canvas when nothing has transformed the
      // image (crop is undefined) — but a themed display box often uses
      // a different aspect ratio than the source, needing CSS to make it
      // fit. object-fit: cover scales both axes by the same factor and
      // crops whatever overflows; object-fit: fill (seen on this theme's
      // own zoom view) instead stretches each axis independently to
      // match the box exactly, cropping nothing. crop (built in
      // renderToTarget from the target's own computed object-fit) always
      // carries a scaleX/scaleY pair — equal for cover, independent for
      // fill — plus how much of each axis a cover-style crop removed (0
      // for fill, since it never crops). Applying the wrong one of these
      // two models is exactly what put the zoomed engraving in the wrong
      // spot: cover's crop-offset math doesn't apply to a fill image, so
      // subtracting an offset that shouldn't exist there shifted it.
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
        var midAngle = (((startDeg + arcDeg / 2) % 360) + 360) % 360;
        var isBottomHalf = midAngle > 0 && midAngle < 180;
        var chars = Array.from(text);
        ctx.font = fontPx2 + "px " + currentFontFamilyCss();

        var charWidths = chars.map(function (ch) {
          return ctx.measureText(ch).width;
        });
        var totalWidth = charWidths.reduce(function (a, b) {
          return a + b;
        }, 0);
        var totalAngleDeg = (totalWidth / r) * (180 / Math.PI);
        var directionSign = isBottomHalf ? -1 : 1;
        var centerAngle = startDeg + arcDeg / 2;
        var cursorAngle = centerAngle - directionSign * (totalAngleDeg / 2);

        chars.forEach(function (ch, i) {
          var halfCharAngle = (charWidths[i] / 2 / r) * (180 / Math.PI);
          var angle = cursorAngle + directionSign * halfCharAngle;
          var rad = (angle * Math.PI) / 180;
          var x = cx + r * Math.cos(rad);
          var y = cy + r * Math.sin(rad);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(((angle + 90) * Math.PI) / 180);
          ctx.fillText(ch, 0, 0);
          ctx.restore();
          cursorAngle +=
            directionSign * ((charWidths[i] / r) * (180 / Math.PI));
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

    // Filename only — Shopify serves the same photo from cdn.shopify.com
    // and the shop's /cdn/shop/ host, at different widths, sometimes with
    // an _800x / _1946x suffix baked into the file name. Comparing full
    // paths (or even path-without-query) misses all of those and is why
    // the overlay used to stick to the first gallery slide after a
    // variant switch: the JSON url and the theme's <img> src look
    // unrelated even though they are the same photo.
    function imageIdentity(src) {
      if (!src) return "";
      var path = src.split("?")[0];
      var slash = path.lastIndexOf("/");
      var filename = slash >= 0 ? path.slice(slash + 1) : path;
      try {
        filename = decodeURIComponent(filename);
      } catch (e) {}
      filename = filename.replace(
        /_\d+x(\d+)?(_crop_[a-z]+)?(?=\.[^.]+$)/i,
        "",
      );
      return filename.toLowerCase();
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

    // Every <img> currently known to show this same product photo, each
    // paired with its own overlay canvas — not just the one visible when
    // the page loads. Zoom/lightbox views typically clone the photo into
    // a new, larger <img> inserted well after this script's initial run,
    // so a single fixed reference wouldn't reach it; each is tracked and
    // rendered to independently, since a zoomed copy is usually a
    // completely separate element from the small one on the page itself.
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
      // A zoom view often positions its own <img> inside a container
      // that isn't itself position:relative — an absolutely-positioned
      // canvas would then place itself against some further ancestor
      // instead of directly over this image, so this guarantees the
      // immediate parent is a valid containing block first.
      var parent = img.parentNode;
      var parentPosition = parent && window.getComputedStyle(parent).position;
      if (parent && (parentPosition === "static" || !parentPosition)) {
        parent.style.position = "relative";
      }
      if (parent) parent.appendChild(canvas);
      var target = { img: img, canvas: canvas, resizeObserver: null };
      externalTargets.push(target);

      // Some zoom/lightbox views animate open (expanding from nothing to
      // full size) rather than appearing at final size immediately — the
      // <img> can already be "complete" (pixels loaded, naturalWidth
      // known) well before that animation settles, so the very first
      // render can measure a getBoundingClientRect() of 0x0 and draw
      // nothing visible. Watching the image's own rendered size, rather
      // than rendering once and hoping it's already final, re-runs the
      // same render whenever that size actually changes — covering the
      // end of an open animation, an orientation change, or anything
      // else that resizes it later, without needing to guess a delay.
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

    // Dawn prepends the newly selected variant slide and toggles
    // is-active rather than inserting a brand-new <img>. childList alone
    // misses that; watching class/src on the product section and the
    // product modal catches it. Body childList still covers lightboxes
    // that portal outside the section. Our own canvas inserts are ignored
    // so attaching an overlay cannot recurse back into this observer.
    if (window.MutationObserver) {
      var refreshScheduled = false;
      function scheduleOverlayRefresh() {
        if (!trackedIdentity || refreshScheduled) return;
        refreshScheduled = true;
        requestAnimationFrame(function () {
          refreshScheduled = false;
          refreshExternalTargets();
        });
      }

      function mutationLooksRelevant(mutation) {
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
      }

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

    function renderToTarget(target) {
      // Matches the canvas to the <img>'s own box exactly, rather than
      // stretching it across 100% of the parent — the two are only the
      // same when the parent has no padding. This zoom view's own
      // container does have padding around the image, so a 100%-sized
      // canvas previously covered that padding too, ending up both
      // larger than and offset from the actual photo.
      //
      // getBoundingClientRect (rather than offsetTop/Left/Width/Height)
      // is what keeps this precise: this theme's own layout uses
      // fractional-pixel sizing (padding like "31.328px" was seen on
      // this zoom view), and offsetTop and friends round to whole
      // pixels, which was enough rounding error — after multiplying
      // through the crop scale below — to leave the overlay just
      // slightly off. Both rects are read from the same viewport
      // coordinate space at the same moment, so subtracting one from the
      // other gives the image's exact position relative to its parent
      // regardless of that rounding, and reusing imgRect's own
      // width/height for the crop math too (rather than a separate
      // clientWidth/clientHeight read) means the size used to position
      // the canvas and the size used to compute the crop can never
      // quietly disagree with each other.
      if (!target.canvas || !target.canvas.parentElement) return;
      var imgRect = target.img.getBoundingClientRect();
      var parentRect = target.canvas.parentElement.getBoundingClientRect();
      var dW = imgRect.width;
      var dH = imgRect.height;
      target.canvas.style.top = imgRect.top - parentRect.top + "px";
      target.canvas.style.left = imgRect.left - parentRect.left + "px";
      target.canvas.style.width = dW + "px";
      target.canvas.style.height = dH + "px";

      var crop = null;
      if (target.img.naturalWidth && target.img.naturalHeight && dW && dH) {
        var naturalW = target.img.naturalWidth;
        var naturalH = target.img.naturalHeight;
        var fit = window.getComputedStyle(target.img).objectFit;
        if (fit === "fill") {
          crop = {
            naturalW: naturalW,
            naturalH: naturalH,
            scaleX: dW / naturalW,
            scaleY: dH / naturalH,
            offsetX: 0,
            offsetY: 0,
          };
        } else {
          var scale = Math.max(dW / naturalW, dH / naturalH);
          crop = {
            naturalW: naturalW,
            naturalH: naturalH,
            scaleX: scale,
            scaleY: scale,
            offsetX: (naturalW * scale - dW) / 2,
            offsetY: (naturalH * scale - dH) / 2,
          };
        }
      }
      renderToCanvas(target.canvas, dW, dH, crop);
    }

    function renderExternal() {
      externalTargets.forEach(renderToTarget);
    }

    function renderAllPreviews() {
      renderInternal();
      renderExternal();
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
        document.fonts
          .load('16px "' + family + '"')
          .then(renderAllPreviews)
          .catch(function () {});
      }

      if (family) {
        mirrorToCartForms("properties[Engraving Font]", family);
      }

      saveEngravingDraft({ fontChoice: choice });
    }

    if (fontPicker) {
      var radios = fontPicker.querySelectorAll('input[type="radio"]');
      radios.forEach(function (radio) {
        // Keeps the visible pill selection in sync with currentFontChoice
        // whichever way it was decided (the zone's own default, or a
        // choice restored from a saved draft) — the Liquid-rendered
        // checked attribute only ever matches the former.
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
      function h(n) {
        n = Math.max(0, Math.min(255, n));
        var s = n.toString(16);
        return s.length === 1 ? "0" + s : s;
      }
      return "#" + h(rgb.r) + h(rgb.g) + h(rgb.b);
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

    // Runs before the other input listeners below (canvas redraw, mirroring
    // to the cart form) so they all see the already-uppercased value — the
    // CSS text-transform on the input only changes how letters are drawn on
    // screen, not the actual characters, so without this the submitted
    // property and the canvas render would still get whatever case the
    // customer actually typed. Restoring the caret position afterward stops
    // the cursor jumping to the end on every keystroke, which re-setting
    // .value would otherwise cause if the customer edits mid-string rather
    // than only ever typing at the end.
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
      refreshExternalTargets();
      renderAllPreviews();
    });
    input.addEventListener("input", updateCharCounter);
    input.addEventListener("input", saveEngravingToStorage);
    updateCharCounter();

    // Variant color swatches (yellow/rose/white gold, say) each have their
    // own product photo, and the popup should follow whichever one the
    // customer currently has selected — the engraving's own position stays
    // the same (it's expressed as percentages of the image, and same-piece
    // variant photos share the same crop/composition), only the underlying
    // photo changes. Themes signal a variant change in different ways (a
    // custom event, a plain <select>, radio swatches, or just setting a
    // hidden field's value directly via JS with no event at all) — rather
    // than betting on one specific mechanism, this covers the common event
    // names AND polls the variant id field's value as a guaranteed fallback
    // that works regardless of how this theme happens to do it.
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

    // Variant picking lives on this component. Dawn hides behind
    // variant-radios (not variant-selects) with name="Color", and after
    // the first change it may replace those nodes — driving a cached
    // theme control is why only the first pill click used to work.
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

    function formatMoney(cents) {
      return "$" + (cents / 100).toFixed(2);
    }

    function findVariantData(variantId) {
      for (var i = 0; i < variantsData.length; i++) {
        if (String(variantsData[i].id) === String(variantId))
          return variantsData[i];
      }
      return null;
    }

    function findVariantByOptions(options) {
      for (var i = 0; i < variantsData.length; i++) {
        var candidate = variantsData[i];
        var match = true;
        for (var o = 0; o < options.length; o++) {
          if (String(candidate.options[o]) !== String(options[o])) {
            match = false;
            break;
          }
        }
        if (match) return candidate;
      }
      return null;
    }

    function optionValueHasStock(optionIndex, value, selectedOptions) {
      for (var i = 0; i < variantsData.length; i++) {
        var candidate = variantsData[i];
        if (!candidate.available) continue;
        if (String(candidate.options[optionIndex]) !== String(value)) continue;
        var matchesPrior = true;
        for (var o = 0; o < optionIndex; o++) {
          if (selectedOptions[o] == null) continue;
          if (String(candidate.options[o]) !== String(selectedOptions[o])) {
            matchesPrior = false;
            break;
          }
        }
        if (matchesPrior) return true;
      }
      return false;
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
          ? "Sold out"
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
      } catch (e) {}
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

      // Dawn hides variant photos with hide_variants until the slide is
      // prepended as :first-child. Do that ourselves so sold-out variants
      // still show their own image — Dawn's picker will not select them.
      if (mediaId) {
        document.querySelectorAll("media-gallery").forEach(function (gallery) {
          try {
            if (typeof gallery.setActiveMedia === "function")
              gallery.setActiveMedia(mediaId, true);
          } catch (e) {}
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
      var best = null;
      var bestScore = -1;
      for (var i = 0; i < variantsData.length; i++) {
        var candidate = variantsData[i];
        if (String(candidate.options[optionIndex]) !== String(value)) continue;
        var score = 0;
        for (var o = 0; o < selectedOptions.length; o++) {
          if (o === optionIndex || selectedOptions[o] == null) continue;
          if (String(candidate.options[o]) === String(selectedOptions[o]))
            score += 2;
        }
        if (candidate.featured_media_id) score += 1;
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      return best;
    }

    function applyVariant(variant) {
      if (!variant) return;
      lastSeenVariantId = String(variant.id);
      var field = liveVariantIdField();
      if (field) field.value = String(variant.id);

      swapToVariantImage(variant.id);

      // Dawn's picker treats unavailable options as unselectable and will
      // snap media/id back to an in-stock combo if we dispatch change into
      // it. Image swap must not depend on stock — only cart does.
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
      if (
        typeof subscribe === "function" &&
        typeof PUB_SUB_EVENTS !== "undefined" &&
        PUB_SUB_EVENTS.variantChange
      ) {
        subscribe(PUB_SUB_EVENTS.variantChange, function (event) {
          var variant = event && event.data && event.data.variant;
          if (!variant) return;
          var selected = findVariantData(lastSeenVariantId);
          if (selected && selected.available === false) return;
          lastSeenVariantId = String(variant.id);
          swapToVariantImage(variant.id);
        });
      }
      host._variantPoll = setInterval(checkVariantChange, 400);
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
        quickAddLabel.textContent = on ? "Adding to cart…" : baseQuickAddLabel;
    }

    // True for the whole upload + add-to-cart sequence, triggered from
    // either the popup's own confirm button or the quick-add button on
    // the main page — every other way of leaving the dialog (the ×
    // button, clicking the backdrop, pressing Escape) is blocked while
    // this is true, so a stray click can't abandon an upload that's
    // already in progress, and a second click on either add button
    // can't fire a second, overlapping upload/add-to-cart.
    var isProcessing = false;

    // Once there's something typed, the trigger reads "Edit" (reopening
    // the same dialog to change it) rather than "Personalize", picking
    // up the existing --filled styling a merchant may already have
    // configured — and a quick-add button appears right under it so
    // adding the already-personalized item to cart doesn't require
    // reopening the popup at all.
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
        clearFromCartForms("properties[_Engraved Preview]");
        renderInternal();
      });
      dialogEl.addEventListener("click", function (e) {
        if (isProcessing) return;
        if (e.target === dialogEl) dialogEl.close();
      });
      // <dialog> closes on Escape natively before any 'close' handler
      // runs — 'cancel' fires first and is cancelable, so this is the
      // hook that actually stops it mid-upload.
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

    // Shared by the dialog's own confirm button and the quick-add button
    // on the main page — both upload the current snapshot and add the
    // same way, differing only in which UI elements they toggle while
    // the request is in flight. isProcessing is owned entirely here:
    // callbacks.onStart only fires once a call has actually been
    // accepted, so a second, overlapping click (from either button)
    // simply does nothing rather than re-disabling an already-disabled
    // control and leaking a callback that would never get its matching
    // onFinish.
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
          // Adds directly through Shopify's own cart AJAX endpoint —
          // deliberately not dependent on locating or clicking any
          // button the theme provides, since this needs to keep
          // working even on a product page that has no separate add-
          // to-cart control of its own at all.
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
          finishProcessing();
          // The draft has served its purpose once the order actually
          // goes through — clearing the input itself (not just the
          // saved draft) so the trigger reverts to "Personalize" and
          // the quick-add button disappears again, rather than sitting
          // there inviting the exact same engraved item to be added a
          // second time by accident. The 'input' event cascades this
          // through every other listener (counter, confirm-button
          // state, storage) the same way the customer's own typing
          // already does, rather than repeating that reset by hand here.
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

    // Best-effort only: there's no single standard for "open the side
    // cart", so this tries the specific pattern this theme's own
    // cart-drawer.liquid uses (a <cart-drawer> element with an open()
    // method mirroring the close() its own close button calls), then
    // falls back to a handful of event names many themes listen for to
    // refresh or reveal their cart UI. Dispatching ones nobody listens
    // for costs nothing, so this stays harmless if none of it matches.
    // Best-effort: there's no single standard for "open the side cart",
    // so this tries progressively more generic approaches. Most specific
    // first — this theme's own <cart-drawer> exposes renderContents(),
    // which both swaps in the fresh cart-drawer/cart-icon-bubble HTML
    // (from the sections data requested in the /cart/add.js call above)
    // and opens itself afterward, so calling it alone does both jobs.
    // Only when that's not available does this fall back to a plain
    // open() (correct content, just not refreshed) or a handful of event
    // names other themes commonly listen for — dispatching ones nobody
    // listens for costs nothing, so this stays harmless either way.
    function openSideCartBestEffort(cartAddData) {
      var cartDrawer = document.querySelector("cart-drawer");
      if (
        cartDrawer &&
        typeof cartDrawer.renderContents === "function" &&
        cartAddData &&
        cartAddData.sections
      ) {
        // The theme's own renderContents() tries to clear "is-empty" but
        // checks .drawer__inner for it — the class actually lives on the
        // <cart-drawer> element itself (per its own cart-drawer.liquid),
        // so that check silently never matches and the class is left
        // behind after the very first add from an empty cart. Nothing
        // about the swapped-in HTML is wrong, but this stale class stays
        // on an element renderContents doesn't touch (it only replaces
        // #CartDrawer's innerHTML), and empty-state CSS keyed off it can
        // keep the drawer looking empty even though the item is really
        // there. Clearing it ourselves — safe once an add has actually
        // succeeded — works around that rather than depending on a fix
        // to the theme's own code.
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
      return [
        Math.min(1, base[0] * 0.35 + 0.65),
        Math.min(1, base[1] * 0.35 + 0.65),
        Math.min(1, base[2] * 0.35 + 0.65),
      ];
    }

    function hexToRgb01(hex) {
      var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
        hex || "#96731f",
      );
      return m
        ? [
            parseInt(m[1], 16) / 255,
            parseInt(m[2], 16) / 255,
            parseInt(m[3], 16) / 255,
          ]
        : [0.588, 0.451, 0.122];
    }

    function renderEngravedLighting(silhouette, baseColorHex) {
      var w = silhouette.width;
      var h = silhouette.height;
      var out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      var gl = out.getContext("webgl");
      if (!gl) return null;

      var vsSource =
        "attribute vec2 aPos; varying vec2 vUv;" +
        "void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }";
      var fsSource =
        "precision mediump float;" +
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

      function compile(type, src) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      }
      var vs = compile(gl.VERTEX_SHADER, vsSource);
      var fs = compile(gl.FRAGMENT_SHADER, fsSource);
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
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        silhouette,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

      var base = hexToRgb01(baseColorHex);
      var hi = highlightFromBase(base);
      gl.uniform1i(gl.getUniformLocation(prog, "uHeight"), 0);
      gl.uniform2f(gl.getUniformLocation(prog, "uTexel"), 1 / w, 1 / h);
      gl.uniform3f(gl.getUniformLocation(prog, "uLightDir"), -0.6, 0.6, 0.5);
      gl.uniform3f(
        gl.getUniformLocation(prog, "uBase"),
        base[0],
        base[1],
        base[2],
      );
      gl.uniform3f(gl.getUniformLocation(prog, "uHi"), hi[0], hi[1], hi[2]);

      gl.viewport(0, 0, w, h);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      return out;
    }

    function captureEngravingSnapshot() {
      return new Promise(function (resolve) {
        if (!imageEl || !imageEl.naturalWidth) return resolve(null);
        var maxDimension = 500;
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
            0.88,
          );
        };
        baseImg.onerror = function () {
          resolve(null);
        };
        baseImg.src = imageEl.src;
      });
    }

    function uploadEngravingImage() {
      var timeout = new Promise(function (resolve) {
        setTimeout(function () {
          resolve(null);
        }, 8000);
      });
      return Promise.race([captureEngravingSnapshot(), timeout])
        .then(function (blob) {
          if (!blob) return null;
          var uploadForm = new FormData();
          uploadForm.append("image", blob, "engraving.jpg");
          return Promise.race([
            fetch("/apps/engraving/upload-preview", {
              method: "POST",
              body: uploadForm,
            }).then(function (res) {
              return res.json();
            }),
            timeout,
          ]);
        })
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

    // Only a fallback now: if the customer closes via the × button or the
    // backdrop without ever using the popup's own "Add to Cart" (say,
    // planning to use the page's regular button instead), this is what
    // still gets the engraving image attached. When "Add to Cart" itself
    // was used, pendingUpload is already set by that point, so this is a
    // no-op rather than a second, redundant capture+upload.
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
        clearInterval(host._variantPoll);
        host._variantPoll = null;
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
