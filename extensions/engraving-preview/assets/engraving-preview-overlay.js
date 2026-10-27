/*
 * Engraving preview — overlays on the theme's own product photos.
 *
 * Besides its own dialog preview, the block draws the engraving on top of
 * every <img> on the page that shows the same product photo: the gallery's
 * active slide and zoom/lightbox copies that themes insert later. Each copy
 * gets its own absolutely-positioned canvas, kept in sync as the page
 * changes.
 */
(function (root) {
  var ns = (root.IskraEngraving = root.IskraEngraving || {});

  ns.createOverlay = function (ctx) {
    var core = ctx.core;
    var host = ctx.host;
    var sectionEl = ctx.sectionEl;
    var state = ctx.state;

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

    // Matches the same photo regardless of CDN host, rendered width or size
    // suffix (see core.imageIdentity).
    function imgMatchesIdentity(img, identity) {
      if (!identity || !img) return false;
      var urls = collectImageUrls(img);
      for (var i = 0; i < urls.length; i++) {
        if (core.imageIdentity(urls[i]) === identity) return true;
      }
      return false;
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
        img.closest('li.slider__slide, li[data-media-id], li[class*="media"]') ||
        null
      );
    }

    function isVisiblyHidden(el) {
      if (!el) return true;
      if (el.hidden || el.hasAttribute("hidden")) return true;
      if (el.classList.contains("hidden") || el.classList.contains("visually-hidden"))
        return true;
      var style = window.getComputedStyle(el);
      return style.display === "none" || style.visibility === "hidden";
    }

    function shouldOverlay(img) {
      if (!img || img.closest(".engraving-preview")) return false;
      if (isThumbnailImage(img)) return false;
      if (!imgMatchesIdentity(img, state.trackedIdentity)) return false;
      if (isVisiblyHidden(img)) return false;
      var slide = closestGallerySlide(img);
      if (slide && isVisiblyHidden(slide)) return false;
      if (slide) return true;
      if (sectionEl && sectionEl.contains(img)) return true;
      if (
        img.closest('.product-media-modal, [id^="ProductModal-"], product-modal, media-gallery')
      )
        return true;
      if (img.closest("dialog")) return true;
      return false;
    }

    function candidateImages() {
      var imgs = [];
      function collect(rootEl) {
        if (!rootEl) return;
        var list = rootEl.querySelectorAll("img");
        for (var i = 0; i < list.length; i++) {
          if (imgs.indexOf(list[i]) === -1) imgs.push(list[i]);
        }
      }
      collect(sectionEl);
      collect(document.querySelector('main, #MainContent, .product, [id^="MainProduct"]'));
      document
        .querySelectorAll(
          'media-gallery, .product__media-list, [id^="MediaGallery"], [class*="product-gallery"], [class*="product__media"]',
        )
        .forEach(collect);
      document
        .querySelectorAll('.product-media-modal, [id^="ProductModal-"], product-modal')
        .forEach(collect);
      return imgs;
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

    // How CSS paints the full source photo into THIS <img> box
    // (object-fit + object-position); zone percents are of the full file.
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
      return core.computeCrop(naturalW, naturalH, boxW, boxH, fit, objectPositionFactors(img));
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
        imgRect.top - parentRect.top - canvasParent.clientTop + canvasParent.scrollTop + "px";
      target.canvas.style.left =
        imgRect.left - parentRect.left - canvasParent.clientLeft + canvasParent.scrollLeft + "px";
      target.canvas.style.width = dW + "px";
      target.canvas.style.height = dH + "px";

      ctx.render.renderToCanvas(target.canvas, dW, dH, cropFromRenderedImage(target.img, dW, dH));
    }

    var targets = [];

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
      for (var t = 0; t < targets.length; t++) {
        if (targets[t].img === img) return;
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
      targets.push(target);

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

    // Drops overlays that no longer belong (inactive variant slide, a node
    // that left the document), then attaches to whatever currently should
    // show the engraving: the active gallery slide plus zoom/modal copies.
    function refresh() {
      targets = targets.filter(function (target) {
        if (target.img.isConnected && shouldOverlay(target.img)) return true;
        detachOverlay(target);
        return false;
      });
      candidateImages().forEach(function (candidate) {
        if (!shouldOverlay(candidate)) return;
        attachWhenReady(candidate);
      });
    }

    function renderAll() {
      targets.forEach(renderToTarget);
    }

    // Dawn switches variants by prepending a slide and toggling is-active
    // rather than inserting a new <img>, so class/src changes are watched as
    // well as added nodes. The body observer covers lightboxes rendered
    // outside the section. Our own canvases are ignored so attaching an
    // overlay can't retrigger this observer.
    function observe() {
      if (!window.MutationObserver) return;
      var refreshScheduled = false;
      var scheduleRefresh = function () {
        if (!state.trackedIdentity || refreshScheduled) return;
        refreshScheduled = true;
        requestAnimationFrame(function () {
          refreshScheduled = false;
          refresh();
        });
      };

      var looksRelevant = function (mutation) {
        if (mutation.type === "attributes") {
          var attrTarget = mutation.target;
          if (!attrTarget || attrTarget.nodeType !== 1) return false;
          if (attrTarget.classList && attrTarget.classList.contains("engraving-preview__canvas"))
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
          if (node.classList && node.classList.contains("engraving-preview__canvas")) continue;
          if (node.closest && node.closest(".engraving-preview")) continue;
          if (node.nodeName === "IMG" || (node.querySelector && node.querySelector("img")))
            return true;
          if (node.classList && node.classList.contains("product__media-item")) return true;
        }
        return false;
      };

      host._overlayObserver = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          if (looksRelevant(mutations[m])) {
            scheduleRefresh();
            return;
          }
        }
      });
      var attrOpts = {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "class", "srcset", "data-src", "data-srcset", "hidden", "style"],
      };
      if (sectionEl) host._overlayObserver.observe(sectionEl, attrOpts);
      document
        .querySelectorAll('.product-media-modal, [id^="ProductModal-"], product-modal')
        .forEach(function (modal) {
          host._overlayObserver.observe(modal, attrOpts);
        });
      host._overlayObserver.observe(document.body, { childList: true, subtree: true });
    }

    state.trackedIdentity = ctx.firstExternalImage
      ? core.imageIdentity(ctx.firstExternalImage.src)
      : null;

    return {
      refresh: refresh,
      renderAll: renderAll,
      observe: observe,
      candidateImages: candidateImages,
      imgMatchesIdentity: imgMatchesIdentity,
      isThumbnailImage: isThumbnailImage,
      closestGallerySlide: closestGallerySlide,
      isVisiblyHidden: isVisiblyHidden,
    };
  };
})(typeof self !== "undefined" ? self : this);
