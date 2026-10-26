import { describe, expect, it } from "vitest";
import { detectImageType, extensionFor, isMediaImageGid } from "./image-upload";

const bytes = (...b: number[]) => new Uint8Array(b);

describe("detectImageType", () => {
  it("recognises JPEG, PNG and WebP by magic bytes", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(
      detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)),
    ).toBe("image/webp");
  });

  it("rejects everything else, whatever the client claims", () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(detectImageType(text("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImageType(text("<!doctype html>"))).toBeNull();
    expect(detectImageType(text("GIF89a"))).toBeNull();
    expect(detectImageType(bytes())).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull(); // truncated
    expect(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull(); // RIFF WAVE
  });
});

describe("extensionFor", () => {
  it("maps types to file extensions", () => {
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/webp")).toBe("webp");
  });
});

describe("isMediaImageGid", () => {
  it("accepts only MediaImage GIDs", () => {
    expect(isMediaImageGid("gid://shopify/MediaImage/123")).toBe(true);
    expect(isMediaImageGid("gid://shopify/Product/123")).toBe(false);
    expect(isMediaImageGid("gid://shopify/MediaImage/12x")).toBe(false);
    expect(isMediaImageGid(undefined)).toBe(false);
  });
});
