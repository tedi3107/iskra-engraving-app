/**
 * Storefront tests for how the Engraving preview block works with the
 * theme's product gallery and forms: overlays on gallery photos, variant
 * photo swaps, saved drafts, uppercase-only zones, the theme's own
 * add-to-cart button, and cleanup. Real Chromium; assets served from the repo.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

const BLOCK_SCRIPTS = [
  "engraving-preview-core.js",
  "engraving-preview-storage.js",
  "engraving-preview-render.js",
  "engraving-preview-overlay.js",
  "engraving-preview-variants.js",
  "engraving-preview-cart.js",
  "engraving-preview.js",
];
const ASSETS = Object.fromEntries(
  BLOCK_SCRIPTS.map((name) => [
    name,
    readFileSync(
      fileURLToPath(new URL(`../../extensions/engraving-preview/assets/${name}`, import.meta.url)),
      "utf8",
    ),
  ]),
);

// Minimal PNG encoder: a solid colour with a darker diagonal band.
function png(size: number, rgb: [number, number, number]): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const k = Math.abs(x - y) < 60 ? 0.7 : 1;
      raw[o] = rgb[0] * k;
      raw[o + 1] = rgb[1] * k;
      raw[o + 2] = rgb[2] * k;
      raw[o + 3] = 255;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const IMAGES: Record<string, Buffer> = {
  "yellow.png": png(400, [201, 162, 74]),
  "rose.png": png(400, [214, 150, 130]),
};

function productPage({ shape = "curved", uppercase = false } = {}) {
  return `<!doctype html><html><body>
<div id="shopify-section-main">
  <div class="product__media-list">
    <div class="product__media-item is-active" data-media-id="main-501"><img id="galY" src="/files/yellow.png?v=1&width=800" style="width:300px;height:300px"></div>
    <div class="product__media-item" data-media-id="main-502" hidden><img id="galR" src="/files/rose.png?v=1" style="width:300px;height:300px"></div>
  </div>
  <div class="thumbnail-list"><img id="thumbY" src="/files/yellow.png" style="width:50px;height:50px"></div>
  <form action="/cart/add" method="post" id="themeForm"><input name="id" value="11"><button type="submit" id="themebtn">Theme add</button></form>
  <engraving-preview class="engraving-preview" data-product-id="1" data-storage-version="v1" data-money-format="\${{amount}}">
    <button class="engraving-preview__trigger"><span class="engraving-preview__trigger-label">Personalize</span></button>
    <button type="button" class="engraving-preview__quick-add" hidden><span class="engraving-preview__quick-add-label">Add to Cart</span></button>
    <dialog class="engraving-preview__dialog">
      <div class="engraving-preview__stage" data-shape="${shape}" data-font-choice="one" data-uppercase-only="${uppercase}"
        data-font-one-family="" data-font-one-fallback="serif" data-font-two-family="" data-font-two-fallback="sans-serif"
        data-one-font-size="60" data-one-x="20" data-one-y="40" data-one-width="60" data-one-height="18"
        data-one-center-x="50" data-one-center-y="50" data-one-radius="30" data-one-start-angle="200" data-one-arc-length="140"
        data-two-font-size="50" data-two-x="25" data-two-y="45" data-two-width="50" data-two-height="14"
        data-two-center-x="50" data-two-center-y="52" data-two-radius="28" data-two-start-angle="20" data-two-arc-length="140"
        style="width:400px;height:400px;position:relative">
        <img class="engraving-preview__image" src="/files/yellow.png?v=1&width=800" width="400" height="400" style="width:400px;height:400px" crossorigin="anonymous">
        <canvas class="engraving-preview__canvas"></canvas>
      </div>
      <script type="application/json" class="engraving-preview__variant-images">{"11":"/files/yellow.png?v=1&width=800","12":"/files/rose.png?v=1&width=800"}</script>
      <script type="application/json" class="engraving-preview__variants-data">[
        {"id":11,"options":["Yellow"],"price":120000,"available":true,"featured_media_id":501},
        {"id":12,"options":["Rose"],"price":125000,"available":true,"featured_media_id":502}]</script>
      <div class="engraving-preview__variant-picker">
        <div class="engraving-preview__variant-option-group"><span>Material <strong data-selected-label>Yellow</strong></span>
        <div class="engraving-preview__variant-pills" data-option-position="1" data-option-name="Material">
          <button type="button" class="engraving-preview__variant-pill" id="pYellow" data-option-position="1" data-option-name="Material" data-value="Yellow"></button>
          <button type="button" class="engraving-preview__variant-pill" id="pRose" data-option-position="1" data-option-name="Material" data-value="Rose"></button>
        </div></div>
      </div>
      <span class="engraving-preview__confirm-price"></span>
      <div class="engraving-preview__font-picker"><input type="radio" name="f" value="one" checked><input type="radio" name="f" value="two" id="fontTwo"></div>
      <input class="engraving-preview__input" maxlength="20" autocomplete="off">
      <span class="engraving-preview__char-counter"></span>
      <button class="engraving-preview__confirm">Add</button>
      <button class="engraving-preview__close">x</button>
      <div class="engraving-preview__loading" hidden></div><div class="engraving-preview__error" hidden></div>
    </dialog>
  </engraving-preview>
</div>
${BLOCK_SCRIPTS.map((name) => `<script src="/assets/${name}"></script>`).join("\n")}
</body></html>`;
}

type Log = { errors: string[]; uploads: number; cartAdds: Array<Record<string, unknown>>; themeSubmits: Array<Record<string, string>> };

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
});
afterAll(async () => {
  await browser?.close();
});

async function open(opts: Parameters<typeof productPage>[0] = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const log: Log = { errors: [], uploads: 0, cartAdds: [], themeSubmits: [] };
  page.on("pageerror", (e) => log.errors.push(String(e)));
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: productPage(opts) });
    if (url.pathname.startsWith("/assets/")) {
      return route.fulfill({ contentType: "text/javascript", body: ASSETS[url.pathname.slice(8)] ?? "" });
    }
    if (url.pathname.startsWith("/files/")) {
      return route.fulfill({ contentType: "image/png", body: IMAGES[url.pathname.slice(7)] });
    }
    if (url.pathname === "/apps/engraving/upload-preview") {
      log.uploads++;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ url: `https://cdn.shopify.com/s/files/p${log.uploads}.jpg` }),
      });
    }
    if (url.pathname === "/cart/add.js") {
      log.cartAdds.push(JSON.parse(req.postData() || "{}").items[0]);
      return route.fulfill({ contentType: "application/json", body: '{"sections":{}}' });
    }
    if (url.pathname === "/cart/add") {
      log.themeSubmits.push(Object.fromEntries(new URLSearchParams(req.postData() || "")));
      return route.fulfill({ contentType: "text/html", body: "<p>added</p>" });
    }
    return route.fulfill({ status: 204, body: "" });
  });
  await page.goto("http://shop.test/");
  await page.waitForTimeout(900);
  return { context, page, log };
}

const click = (page: Page, selector: string) =>
  page.evaluate((s) => (document.querySelector(s) as HTMLElement).click(), selector);

async function typeEngraving(page: Page, text: string) {
  await click(page, ".engraving-preview__trigger");
  await page.focus(".engraving-preview__input");
  await page.keyboard.type(text, { delay: 5 });
  await page.waitForTimeout(700);
}

// For each gallery overlay canvas: the image it sits on and how many pixels it painted.
const overlays = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".engraving-preview__canvas")]
      .filter((c) => !c.closest(".engraving-preview"))
      .map((c) => {
        const canvas = c as HTMLCanvasElement;
        const d = canvas.width ? canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data : [];
        let painted = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]) painted++;
        return { on: (canvas.previousElementSibling as HTMLElement | null)?.id, painted };
      }),
  );

describe("gallery overlays and variant photos", () => {
  it("draws the engraving on the active gallery photo, never on thumbnails", async () => {
    const { context, page, log } = await open();
    await typeEngraving(page, "Marija & Nikola");
    const found = await overlays(page);
    expect(found).toHaveLength(1);
    expect(found[0].on).toBe("galY");
    expect(found[0].painted).toBeGreaterThan(500);
    expect(log.errors).toEqual([]);
    await context.close();
  });

  it("follows a variant switch to its own photo and back", async () => {
    const { context, page, log } = await open();
    await typeEngraving(page, "MN");

    await click(page, "#pRose");
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => [...document.querySelectorAll(".product__media-item")].map(
      (s) => `${(s as HTMLElement).dataset.mediaId}${s.classList.contains("is-active") ? "+active" : ""}${(s as HTMLElement).hidden ? "+hidden" : ""}`,
    ))).toEqual(["main-502+active", "main-501"]);
    expect((await overlays(page)).map((o) => o.on)).toEqual(["galR"]);
    expect(await page.getAttribute(".engraving-preview__image", "src")).toBe("/files/rose.png?v=1&width=800");
    expect(await page.inputValue("#themeForm [name=id]")).toBe("12");
    expect(await page.textContent(".engraving-preview__confirm-price")).toBe("$1,250.00");
    expect(await page.textContent("[data-selected-label]")).toBe("Rose");

    await click(page, "#pYellow");
    await page.waitForTimeout(1200);
    expect((await overlays(page)).map((o) => o.on)).toEqual(["galY"]);
    expect(await page.inputValue("#themeForm [name=id]")).toBe("11");
    expect(log.errors).toEqual([]);
    await context.close();
  });
});

describe("drafts, input rules and the theme's own button", () => {
  it("restores the engraving and font after a reload", async () => {
    const { context, page } = await open();
    await typeEngraving(page, "Zauvek");
    await page.evaluate(() => {
      const r = document.getElementById("fontTwo") as HTMLInputElement;
      r.checked = true;
      r.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForTimeout(900);
    expect(await page.inputValue(".engraving-preview__input")).toBe("Zauvek");
    expect(await page.isChecked("#fontTwo")).toBe(true);
    expect(await page.textContent(".engraving-preview__trigger-label")).toBe("Edit");
    await context.close();
  });

  it("forces capitals when the zone requires them, including in the cart", async () => {
    const { context, page, log } = await open({ shape: "straight", uppercase: true });
    await typeEngraving(page, "abc dé");
    expect(await page.inputValue(".engraving-preview__input")).toBe("ABC DÉ");
    await click(page, ".engraving-preview__confirm");
    await expect.poll(() => log.cartAdds.length, { timeout: 8000 }).toBe(1);
    expect((log.cartAdds[0].properties as Record<string, string>).Engraving).toBe("ABC DÉ");
    // the draft is cleared once the item is in the cart
    expect(await page.inputValue(".engraving-preview__input")).toBe("");
    await context.close();
  });

  it("makes the theme's own add-to-cart button wait for the preview", async () => {
    const { context, page, log } = await open();
    await typeEngraving(page, "Forever");
    await click(page, ".engraving-preview__close");
    await page.waitForTimeout(1500);
    await click(page, "#themebtn");
    await expect.poll(() => log.themeSubmits.length, { timeout: 8000 }).toBe(1);
    expect(log.themeSubmits[0]).toMatchObject({
      id: "11",
      "properties[Engraving]": "Forever",
      "properties[_Engraved Preview]": "https://cdn.shopify.com/s/files/p1.jpg",
    });
    await context.close();
  });

  it("stops working cleanly when the block is removed", async () => {
    const { context, page, log } = await open();
    await page.evaluate(() => document.querySelector("engraving-preview")!.remove());
    await page.evaluate(() => {
      (document.querySelector("#themeForm [name=id]") as HTMLInputElement).value = "12";
    });
    await page.waitForTimeout(2500); // longer than the variant poll interval
    expect(log.errors).toEqual([]);
    await context.close();
  });
});
