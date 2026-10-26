/*
 * Pure, DOM-free helpers for the engraving preview block.
 *
 * Loaded on the storefront before engraving-preview.js (exposed as
 * window.IskraEngravingCore) and loaded in unit tests through the
 * CommonJS branch below. Everything here takes plain values and returns
 * plain values, so it can be tested without a browser and so the admin
 * Position designer can be checked against the exact same math the
 * storefront uses.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.IskraEngravingCore = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  var RAD_TO_DEG = 180 / Math.PI;

  // ---------------------------------------------------------------
  // Image identity: Shopify serves the same photo from cdn.shopify.com
  // and the shop's /cdn/shop/ host, at different widths, sometimes with
  // an _800x / _1946x suffix baked into the file name. Comparing only the
  // normalized filename treats all of those as the same photo.
  // ---------------------------------------------------------------
  function imageIdentity(src) {
    if (!src) return "";
    var path = src.split("?")[0];
    var slash = path.lastIndexOf("/");
    var filename = slash >= 0 ? path.slice(slash + 1) : path;
    try {
      filename = decodeURIComponent(filename);
    } catch (e) {
      // keep the raw filename if it isn't valid URI encoding
    }
    filename = filename.replace(/_\d+x(\d+)?(_crop_[a-z]+)?(?=\.[^.]+$)/i, "");
    return filename.toLowerCase();
  }

  // ---------------------------------------------------------------
  // object-position / object-fit → how a source photo is painted into an
  // <img> box. Zone coordinates are percentages of the FULL source photo.
  // ---------------------------------------------------------------
  function objectPositionAxis(part, fallback) {
    if (!part) return fallback;
    if (part === "left" || part === "top") return 0;
    if (part === "center") return 0.5;
    if (part === "right" || part === "bottom") return 1;
    if (/%$/.test(part)) {
      var pct = parseFloat(part);
      return isNaN(pct) ? fallback : pct / 100;
    }
    return fallback;
  }

  function parseObjectPosition(raw) {
    var parts = String(raw || "").trim().split(/\s+/);
    if (parts.length === 1) {
      var only = parts[0];
      if (only === "top" || only === "bottom")
        return { x: 0.5, y: objectPositionAxis(only, 0.5) };
      return { x: objectPositionAxis(only, 0.5), y: 0.5 };
    }
    return {
      x: objectPositionAxis(parts[0], 0.5),
      y: objectPositionAxis(parts[1], 0.5),
    };
  }

  function computeCrop(naturalW, naturalH, boxW, boxH, fit, pos) {
    if (!naturalW || !naturalH || !boxW || !boxH) return null;
    var scaleX;
    var scaleY;
    if (fit === "contain") {
      var contain = Math.min(boxW / naturalW, boxH / naturalH);
      scaleX = contain;
      scaleY = contain;
    } else if (fit === "scale-down") {
      var down = Math.min(1, boxW / naturalW, boxH / naturalH);
      scaleX = down;
      scaleY = down;
    } else if (fit === "none") {
      scaleX = 1;
      scaleY = 1;
    } else if (fit === "cover") {
      var cover = Math.max(boxW / naturalW, boxH / naturalH);
      scaleX = cover;
      scaleY = cover;
    } else {
      scaleX = boxW / naturalW;
      scaleY = boxH / naturalH;
    }
    return {
      naturalW: naturalW,
      naturalH: naturalH,
      scaleX: scaleX,
      scaleY: scaleY,
      offsetX: (naturalW * scaleX - boxW) * pos.x,
      offsetY: (naturalH * scaleY - boxH) * pos.y,
    };
  }

  // ---------------------------------------------------------------
  // Curved text. Angles: 0° is 3 o'clock, increasing clockwise. Text is
  // centered on the arc's midpoint and laid out by each character's real
  // advance width. On the bottom half the direction of travel is reversed
  // so letters stay upright and outward-facing.
  // ---------------------------------------------------------------
  function isBottomHalfArc(startDeg, arcDeg) {
    var midAngle = (((startDeg + arcDeg / 2) % 360) + 360) % 360;
    return midAngle > 0 && midAngle < 180;
  }

  function layoutCurvedText(charWidths, cx, cy, r, startDeg, arcDeg) {
    var totalWidth = charWidths.reduce(function (a, b) {
      return a + b;
    }, 0);
    var totalAngleDeg = (totalWidth / r) * RAD_TO_DEG;
    var directionSign = isBottomHalfArc(startDeg, arcDeg) ? -1 : 1;
    var centerAngle = startDeg + arcDeg / 2;
    var cursorAngle = centerAngle - directionSign * (totalAngleDeg / 2);

    return charWidths.map(function (width) {
      var halfCharAngle = (width / 2 / r) * RAD_TO_DEG;
      var angle = cursorAngle + directionSign * halfCharAngle;
      var rad = (angle * Math.PI) / 180;
      var placement = {
        x: cx + r * Math.cos(rad),
        y: cy + r * Math.sin(rad),
        angle: angle,
      };
      cursorAngle += directionSign * ((width / r) * RAD_TO_DEG);
      return placement;
    });
  }

  // ---------------------------------------------------------------
  // Colors
  // ---------------------------------------------------------------
  function toHex(rgb) {
    function h(n) {
      n = Math.max(0, Math.min(255, n));
      var s = n.toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    return "#" + h(rgb.r) + h(rgb.g) + h(rgb.b);
  }

  function hexToRgb01(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "#96731f");
    return m
      ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
      : [0.588, 0.451, 0.122];
  }

  function highlightFromBase(base) {
    return [
      Math.min(1, base[0] * 0.35 + 0.65),
      Math.min(1, base[1] * 0.35 + 0.65),
      Math.min(1, base[2] * 0.35 + 0.65),
    ];
  }

  // ---------------------------------------------------------------
  // Money — Shopify's standard money_format placeholders, so prices read
  // exactly like the rest of the theme (currency, separators, decimals).
  // ---------------------------------------------------------------
  function formatWithDelimiters(cents, precision, thousands, decimal) {
    if (cents == null || isNaN(cents)) return "0";
    var fixed = (cents / 100).toFixed(precision);
    var parts = fixed.split(".");
    var whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + thousands);
    return whole + (parts[1] ? decimal + parts[1] : "");
  }

  function formatMoney(cents, format) {
    var template = format || "${{amount}}";
    var match = /\{\{\s*(\w+)\s*\}\}/.exec(template);
    if (!match) return template;
    var value;
    switch (match[1]) {
      case "amount_no_decimals":
        value = formatWithDelimiters(cents, 0, ",", ".");
        break;
      case "amount_with_comma_separator":
        value = formatWithDelimiters(cents, 2, ".", ",");
        break;
      case "amount_no_decimals_with_comma_separator":
        value = formatWithDelimiters(cents, 0, ".", ",");
        break;
      case "amount_with_apostrophe_separator":
        value = formatWithDelimiters(cents, 2, "'", ".");
        break;
      case "amount_no_decimals_with_space_separator":
        value = formatWithDelimiters(cents, 0, " ", ",");
        break;
      case "amount_with_space_separator":
        value = formatWithDelimiters(cents, 2, " ", ",");
        break;
      case "amount_with_period_and_space_separator":
        value = formatWithDelimiters(cents, 2, " ", ".");
        break;
      default:
        value = formatWithDelimiters(cents, 2, ",", ".");
    }
    return template.replace(match[0], value);
  }

  // ---------------------------------------------------------------
  // Variants (variants: [{ id, options: [...], available, featured_media_id }])
  // ---------------------------------------------------------------
  function findVariantByOptions(variants, options) {
    for (var i = 0; i < variants.length; i++) {
      var candidate = variants[i];
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

  function optionValueHasStock(variants, optionIndex, value, selectedOptions) {
    for (var i = 0; i < variants.length; i++) {
      var candidate = variants[i];
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

  function findVariantWithOption(variants, optionIndex, value, selectedOptions) {
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < variants.length; i++) {
      var candidate = variants[i];
      if (String(candidate.options[optionIndex]) !== String(value)) continue;
      var score = 0;
      for (var o = 0; o < selectedOptions.length; o++) {
        if (o === optionIndex || selectedOptions[o] == null) continue;
        if (String(candidate.options[o]) === String(selectedOptions[o])) score += 2;
      }
      if (candidate.featured_media_id) score += 1;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  return {
    imageIdentity: imageIdentity,
    objectPositionAxis: objectPositionAxis,
    parseObjectPosition: parseObjectPosition,
    computeCrop: computeCrop,
    isBottomHalfArc: isBottomHalfArc,
    layoutCurvedText: layoutCurvedText,
    toHex: toHex,
    hexToRgb01: hexToRgb01,
    highlightFromBase: highlightFromBase,
    formatMoney: formatMoney,
    findVariantByOptions: findVariantByOptions,
    optionValueHasStock: optionValueHasStock,
    findVariantWithOption: findVariantWithOption,
  };
});
