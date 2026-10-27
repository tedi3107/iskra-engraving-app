/*
 * Engraving preview — rendering.
 *
 * Draws the engraving text (straight or curved) as a silhouette, lights it
 * with a WebGL emboss pass in the metal's sampled colour, and paints it onto
 * a canvas. Also produces the snapshot uploaded with the cart item.
 */
(function (root) {
  var ns = (root.IskraEngraving = root.IskraEngraving || {});

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

  ns.createRenderer = function (ctx) {
    var core = ctx.core;
    var input = ctx.input;
    var imageEl = ctx.imageEl;
    var internalCanvas = ctx.host.querySelector(
      ".engraving-preview__stage .engraving-preview__canvas",
    );

    function drawSilhouette(g, w, h, crop) {
      var text = input.value;
      if (!text) return;
      var fontSizePercent = ctx.geomAttr("font-size");

      // Zone coordinates are percentages of the full source photo. Without
      // crop they map straight onto this canvas; with crop (derived from the
      // target <img>'s object-fit and object-position) they go through its
      // per-axis scale and the offset that a cover/contain fit introduces.
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

      g.save();
      g.fillStyle = "#fff";
      g.textAlign = "center";
      g.textBaseline = "middle";

      if (ctx.shape === "straight") {
        var zx = ctx.geomAttr("x");
        var zy = ctx.geomAttr("y");
        var zw = ctx.geomAttr("width");
        var zh = ctx.geomAttr("height");
        var fontPx = (fontSizePercent / 100) * lenY(zh);
        g.font = fontPx + "px " + ctx.fontFamilyCss();
        g.fillText(text, pxX(zx + zw / 2), pxY(zy + zh / 2));
      } else {
        var r = lenX(ctx.geomAttr("radius"));
        var fontPx2 = (fontSizePercent / 100) * r;
        var cx = pxX(ctx.geomAttr("center-x"));
        var cy = pxY(ctx.geomAttr("center-y"));
        var startDeg = ctx.geomAttr("start-angle");
        var arcDeg = ctx.geomAttr("arc-length");
        var chars = Array.from(text);
        g.font = fontPx2 + "px " + ctx.fontFamilyCss();

        var charWidths = chars.map(function (ch) {
          return g.measureText(ch).width;
        });
        core
          .layoutCurvedText(charWidths, cx, cy, r, startDeg, arcDeg)
          .forEach(function (placement, i) {
            g.save();
            g.translate(placement.x, placement.y);
            g.rotate(((placement.angle + 90) * Math.PI) / 180);
            g.fillText(chars[i], 0, 0);
            g.restore();
          });
      }
      g.restore();
    }

    // One WebGL context per block, created on first use and reused (browsers
    // cap live contexts at roughly 16). The returned canvas is shared, so
    // callers must draw it right away.
    var lighting = null;

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

      var info = {
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
          if (lighting === info) lighting = null;
        },
        false,
      );
      return info;
    }

    function releaseLighting() {
      if (!lighting) return;
      try {
        var ext = lighting.gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch (e) {
        // already lost or unsupported — nothing to release
      }
      lighting = null;
    }

    function renderLighting(silhouette, baseColorHex) {
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
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, silhouette);

      var base = core.hexToRgb01(baseColorHex);
      var hi = core.highlightFromBase(base);
      gl.uniform2f(lighting.uTexel, 1 / w, 1 / h);
      gl.uniform3f(lighting.uBase, base[0], base[1], base[2]);
      gl.uniform3f(lighting.uHi, hi[0], hi[1], hi[2]);

      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      return out;
    }

    // Paints the lit engraving (or a flat-colour fallback without WebGL)
    // onto g, which must already hold whatever should sit underneath.
    function paintEngraving(g, w, h, crop) {
      var silhouette = document.createElement("canvas");
      silhouette.width = w;
      silhouette.height = h;
      drawSilhouette(silhouette.getContext("2d"), w, h, crop);

      var color = ctx.state.baseColorHex;
      var lit = renderLighting(silhouette, color);
      if (lit) {
        g.drawImage(lit, 0, 0);
      } else {
        g.drawImage(silhouette, 0, 0);
        g.globalCompositeOperation = "source-in";
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = "source-over";
      }
    }

    function renderToCanvas(canvasEl, w, h, crop) {
      if (!canvasEl || !w || !h) return;
      canvasEl.width = w;
      canvasEl.height = h;
      var g = canvasEl.getContext("2d");
      g.clearRect(0, 0, w, h);
      if (!input.value) return;
      paintEngraving(g, w, h, crop);
    }

    function renderInternal() {
      if (!imageEl) return;
      renderToCanvas(internalCanvas, imageEl.clientWidth, imageEl.clientHeight);
    }

    // The product photo with the engraving burned in, as a JPEG blob
    // (longest side at most 1400px), or null if it can't be produced.
    function captureSnapshot() {
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
        var g = canvas.getContext("2d");

        var baseImg = new Image();
        baseImg.crossOrigin = "anonymous";
        baseImg.onload = function () {
          g.drawImage(baseImg, 0, 0, naturalW, naturalH);
          paintEngraving(g, naturalW, naturalH);
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

    function averageColor(src, xPercent, yPercent, sizePercent) {
      return new Promise(function (resolve) {
        var probe = new Image();
        probe.crossOrigin = "anonymous";
        probe.onload = function () {
          try {
            var canvas = document.createElement("canvas");
            canvas.width = probe.naturalWidth;
            canvas.height = probe.naturalHeight;
            var g = canvas.getContext("2d");
            g.drawImage(probe, 0, 0);
            var sw = Math.max(4, Math.round((sizePercent / 100) * probe.naturalWidth));
            var sh = Math.max(4, Math.round((sizePercent / 100) * probe.naturalHeight));
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
            var data = g.getImageData(sx, sy, sw, sh).data;
            var r = 0,
              gr = 0,
              b = 0,
              n = 0;
            for (var i = 0; i < data.length; i += 4) {
              r += data[i];
              gr += data[i + 1];
              b += data[i + 2];
              n++;
            }
            resolve({ r: Math.round(r / n), g: Math.round(gr / n), b: Math.round(b / n) });
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

    // Samples the metal's colour where the engraving sits (zone centre, or
    // the arc's midpoint) and re-renders in it.
    function sampleAndApplyColor(imgOrUrl) {
      var src = typeof imgOrUrl === "string" ? imgOrUrl : imgOrUrl && imgOrUrl.src;
      if (!src) return Promise.resolve();
      var xPercent, yPercent;
      if (ctx.shape === "straight") {
        xPercent = ctx.geomAttr("x") + ctx.geomAttr("width") / 2;
        yPercent = ctx.geomAttr("y") + ctx.geomAttr("height") / 2;
      } else {
        var startDeg = ctx.geomAttr("start-angle");
        var arcDeg = ctx.geomAttr("arc-length");
        var midRad = ((startDeg + arcDeg / 2) * Math.PI) / 180;
        var radiusPercent = ctx.geomAttr("radius");
        xPercent = ctx.geomAttr("center-x") + radiusPercent * Math.cos(midRad);
        yPercent = ctx.geomAttr("center-y") + radiusPercent * Math.sin(midRad);
      }
      return averageColor(src, xPercent, yPercent, 8).then(function (rgb) {
        if (rgb) ctx.state.baseColorHex = core.toHex(rgb);
        ctx.renderAllPreviews();
      });
    }

    return {
      renderToCanvas: renderToCanvas,
      renderInternal: renderInternal,
      captureSnapshot: captureSnapshot,
      sampleAndApplyColor: sampleAndApplyColor,
      releaseLighting: releaseLighting,
    };
  };
})(typeof self !== "undefined" ? self : this);
