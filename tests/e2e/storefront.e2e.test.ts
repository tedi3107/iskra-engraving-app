/**
 * Storefront regression tests for the Engraving preview block, run in a real
 * Chromium (WebGL via SwiftShader). The page is a minimal stand-in for the
 * Liquid block's markup; the theme app extension's real JS assets are served
 * from the repo, and the app-proxy / cart endpoints are stubbed.
 *
 * Run: npm run test:e2e   (first time: npx playwright install chromium)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

const asset = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../extensions/engraving-preview/assets/${name}`, import.meta.url)),
    "utf8",
  );
const ASSETS: Record<string, string> = {
  "engraving-preview-core.js": asset("engraving-preview-core.js"),
  "engraving-preview.js": asset("engraving-preview.js"),
  "cart-engraving-images.js": asset("cart-engraving-images.js"),
};

function productPage(shape: "straight" | "curved") {
  return `<!doctype html><html><body>
<form action="/cart/add" method="post"><input name="id" value="11"><button type="submit" id="themebtn">Theme add</button></form>
<engraving-preview class="engraving-preview" data-product-id="1" data-storage-version="t"
  data-money-format="\${{amount}}" data-sold-out-label="Rasprodato" data-adding-label="Dodajem…">
  <button class="engraving-preview__trigger"><span class="engraving-preview__trigger-label">Personalize</span></button>
  <div class="engraving-preview__stage" data-shape="${shape}" data-font-choice="one" data-uppercase-only="false"
    data-font-one-family="" data-font-one-fallback="serif" data-font-two-family="" data-font-two-fallback="serif"
    data-one-font-size="60" data-one-x="20" data-one-y="40" data-one-width="60" data-one-height="18"
    data-one-center-x="50" data-one-center-y="50" data-one-radius="30" data-one-start-angle="200" data-one-arc-length="140"
    data-two-font-size="60" data-two-x="30" data-two-y="42" data-two-width="40" data-two-height="16"
    data-two-center-x="50" data-two-center-y="50" data-two-radius="30" data-two-start-angle="20" data-two-arc-length="140"
    style="width:400px;height:400px;position:relative">
    <img class="engraving-preview__image" id="pimg" width="400" height="400" style="width:400px;height:400px">
    <canvas class="engraving-preview__canvas"></canvas>
  </div>
  <dialog class="engraving-preview__dialog">
    <script type="application/json" class="engraving-preview__variants-data">[
      {"id":11,"options":["Yellow"],"price":120000,"available":true,"featured_media_id":null},
      {"id":12,"options":["Rose"],"price":125000,"available":false,"featured_media_id":null}]</script>
    <script type="application/json" class="engraving-preview__variant-images">{}</script>
    <div class="engraving-preview__variant-picker">
      <div class="engraving-preview__variant-pills" data-option-position="1" data-option-name="Material">
        <button type="button" class="engraving-preview__variant-pill" id="pYellow" data-option-position="1" data-option-name="Material" data-value="Yellow">Y</button>
        <button type="button" class="engraving-preview__variant-pill" id="pRose" data-option-position="1" data-option-name="Material" data-value="Rose">R</button>
      </div>
    </div>
    <span class="engraving-preview__confirm-price"></span>
    <input class="engraving-preview__input" maxlength="30" autocomplete="off">
    <span class="engraving-preview__char-counter"></span>
    <button class="engraving-preview__confirm"><span class="engraving-preview__confirm-label">Add</span></button>
    <button class="engraving-preview__close">x</button>
    <div class="engraving-preview__loading" hidden></div><div class="engraving-preview__error" hidden></div>
  </dialog>
</engraving-preview>
<script src="/assets/engraving-preview-core.js"></script>
<script src="/assets/engraving-preview.js"></script>
</body></html>`;
}

type Stub = { posts: number; gets: number; cartAdds: Array<Record<string, unknown>>; uploadMode: "ready" | "pending" };

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
});
afterAll(async () => {
  await browser?.close();
});

async function openProduct(shape: "straight" | "curved", uploadMode: Stub["uploadMode"] = "ready") {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const stub: Stub = { posts: 0, gets: 0, cartAdds: [], uploadMode };

  await page.addInitScript(() => {
    const w = window as unknown as { __webglContexts: number };
    w.__webglContexts = 0;
    type GetContext = (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown;
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: GetContext };
    const original = proto.getContext;
    proto.getContext = function (type, ...rest) {
      if (type === "webgl") w.__webglContexts++;
      return original.call(this, type, ...rest);
    };
    // product photo: a gold gradient, available before the block boots
    document.addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("canvas");
      c.width = c.height = 400;
      const x = c.getContext("2d")!;
      const g = x.createLinearGradient(0, 0, 400, 400);
      g.addColorStop(0, "#c9a24a");
      g.addColorStop(1, "#8a6a2a");
      x.fillStyle = g;
      x.fillRect(0, 0, 400, 400);
      (document.getElementById("pimg") as HTMLImageElement).src = c.toDataURL("image/png");
    });
  });

  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: productPage(shape) });
    if (url.pathname.startsWith("/assets/")) {
      return route.fulfill({ contentType: "text/javascript", body: ASSETS[url.pathname.slice(8)] ?? "" });
    }
    if (url.pathname === "/apps/engraving/upload-preview") {
      if (req.method() === "POST") {
        stub.posts++;
        if (stub.uploadMode === "pending") {
          return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ pending: true, id: "gid://shopify/MediaImage/9" }) });
        }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: `https://cdn.shopify.com/s/files/p${stub.posts}.jpg` }) });
      }
      stub.gets++;
      if (stub.gets < 3) {
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ pending: true, id: "gid://shopify/MediaImage/9" }) });
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: "https://cdn.shopify.com/s/files/polled.jpg" }) });
    }
    if (url.pathname === "/cart/add.js") {
      stub.cartAdds.push(JSON.parse(req.postData() || "{}"));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sections: {} }) });
    }
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("http://shop.test/");
  await page.waitForFunction(() => (document.getElementById("pimg") as HTMLImageElement).naturalWidth > 0);
  await page.waitForTimeout(300);
  return { page, errors, stub };
}

async function type(page: Page, text: string) {
  await page.click(".engraving-preview__trigger");
  await page.focus(".engraving-preview__input");
  await page.keyboard.type(text, { delay: 5 });
  await page.waitForTimeout(400);
}

const paintedPixels = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector(".engraving-preview__stage canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });

const previewField = (page: Page) =>
  page.evaluate(() => {
    const f = document.querySelector('input[name="properties[_Engraved Preview]"]') as HTMLInputElement | null;
    return f ? f.value : null;
  });

describe("engraving preview block", () => {
  it.each(["straight", "curved"] as const)("renders %s text with a single WebGL context", async (shape) => {
    const { page, errors } = await openProduct(shape);
    await type(page, "Marija & Nikola 2026");
    expect(await paintedPixels(page)).toBeGreaterThan(1000);
    expect(await page.evaluate(() => (window as unknown as { __webglContexts: number }).__webglContexts)).toBe(1);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("formats prices with the shop's money format and translated sold-out label", async () => {
    const { page } = await openProduct("curved");
    await type(page, "A");
    await page.evaluate(() => (document.getElementById("pRose") as HTMLButtonElement).click());
    await page.waitForTimeout(200);
    expect(await page.textContent(".engraving-preview__confirm-price")).toBe("Rasprodato");
    await page.evaluate(() => (document.getElementById("pYellow") as HTMLButtonElement).click());
    await page.waitForTimeout(200);
    expect(await page.textContent(".engraving-preview__confirm-price")).toBe("$1,200.00");
    await page.close();
  });

  it("adds to cart with the engraving and a fresh preview", async () => {
    const { page, stub } = await openProduct("curved");
    await type(page, "Zauvek");
    await page.evaluate(() => (document.querySelector(".engraving-preview__confirm") as HTMLButtonElement).click());
    await expect.poll(() => stub.cartAdds.length, { timeout: 8000 }).toBe(1);
    const item = (stub.cartAdds[0].items as Array<{ id: string; properties: Record<string, string> }>)[0];
    expect(item.id).toBe("11");
    expect(item.properties.Engraving).toBe("Zauvek");
    expect(item.properties["_Engraved Preview"]).toBe("https://cdn.shopify.com/s/files/p1.jpg");
    await page.close();
  });

  it("never reuses a stale preview after the text changes (regression)", async () => {
    const { page, stub } = await openProduct("curved");
    await type(page, "AB");
    await page.click(".engraving-preview__close");
    await expect.poll(() => stub.posts, { timeout: 8000 }).toBe(1);
    // reopen, edit, close → must upload again and expose the new preview
    await type(page, "C");
    await page.click(".engraving-preview__close");
    await expect.poll(() => stub.posts, { timeout: 8000 }).toBe(2);
    await expect.poll(() => previewField(page), { timeout: 8000 }).toBe("https://cdn.shopify.com/s/files/p2.jpg");
    await page.close();
  });

  it("polls a still-processing upload and attaches the final URL", async () => {
    const { page, stub } = await openProduct("curved", "pending");
    await type(page, "MN");
    await page.evaluate(() => (document.querySelector(".engraving-preview__confirm") as HTMLButtonElement).click());
    await expect.poll(() => stub.cartAdds.length, { timeout: 10000 }).toBe(1);
    expect(stub.gets).toBeGreaterThanOrEqual(3);
    const item = (stub.cartAdds[0].items as Array<{ properties: Record<string, string> }>)[0];
    expect(item.properties["_Engraved Preview"]).toBe("https://cdn.shopify.com/s/files/polled.jpg");
    await page.close();
  });
});

describe("cart images app embed", () => {
  it("swaps the photo of engraved lines in Dawn-style cart rows", async () => {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") {
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><body>
            <table><tr id="CartItem-1"><td><img class="cart-item__image" src="/a.jpg" srcset="/a.jpg 1x"></td></tr>
            <tr id="CartItem-2"><td><img class="cart-item__image" src="/b.jpg"></td></tr></table>
            <div id="CartDrawer-Item-1"><img class="cart-item__image" src="/a.jpg"></div>
            <script src="/assets/cart-engraving-images.js"></script></body>`,
        });
      }
      if (url.pathname.startsWith("/assets/")) {
        return route.fulfill({ contentType: "text/javascript", body: ASSETS[url.pathname.slice(8)] ?? "" });
      }
      if (url.pathname === "/cart.js") {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              { key: "k1", properties: { "_Engraved Preview": "https://cdn.shopify.com/s/files/e1.jpg" } },
              { key: "k2", properties: {} },
            ],
          }),
        });
      }
      return route.fulfill({ status: 204, body: "" });
    });
    await page.goto("http://shop.test/");
    await expect
      .poll(() => page.getAttribute("#CartItem-1 img", "src"), { timeout: 5000 })
      .toBe("https://cdn.shopify.com/s/files/e1.jpg");
    expect(await page.getAttribute("#CartItem-1 img", "srcset")).toBeNull();
    expect(await page.getAttribute("#CartDrawer-Item-1 img", "src")).toBe("https://cdn.shopify.com/s/files/e1.jpg");
    expect(await page.getAttribute("#CartItem-2 img", "src")).toBe("/b.jpg");
    await page.close();
  });
});
