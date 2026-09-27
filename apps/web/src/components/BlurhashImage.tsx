"use client";

/**
 * BlurhashImage.tsx
 *
 * Renders an image with a blurhash placeholder while loading.
 *
 * How it works:
 *  1. A <canvas> is painted immediately with a decoded blurhash (soft blurred
 *     preview) using the algorithm described at https://blurha.sh/.
 *  2. When the real <img> loads, it crossfades over the canvas placeholder.
 *  3. The canvas is then removed from the DOM to free memory.
 *
 * If no `blurhash` prop is provided the component degrades gracefully to a
 * solid muted background placeholder.
 *
 * Layout-shift prevention:
 *  - The container is sized via explicit `width`/`height` (or aspect-ratio
 *    via the `aspectRatio` prop) so the browser reserves space before the
 *    image arrives, yielding CLS = 0.
 */

import React, {
  CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ─── Blurhash decoder ────────────────────────────────────────────────────────
// A compact pure-TS implementation of the blurhash decode algorithm.
// Reference: https://github.com/woltapp/blurhash/blob/master/Algorithm.md

const digitCharacters =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function decode83(str: string): number {
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    const digit = digitCharacters.indexOf(str[i]);
    value = value * 83 + digit;
  }
  return value;
}

function sRGBToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSRGB(value: number): number {
  const clamp = Math.max(0, Math.min(1, value));
  return clamp <= 0.0031308
    ? Math.round(clamp * 12.92 * 255 + 0.5)
    : Math.round((1.055 * Math.pow(clamp, 1 / 2.4) - 0.055) * 255 + 0.5);
}

function sign(n: number): number {
  return n < 0 ? -1 : 1;
}

function signPow(val: number, exp: number): number {
  return sign(val) * Math.pow(Math.abs(val), exp);
}

interface DecodedBlurhash {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

function decodeBlurhash(
  hash: string,
  width: number,
  height: number,
  punch = 1
): DecodedBlurhash | null {
  if (!hash || hash.length < 6) return null;

  try {
    const sizeFlag = decode83(hash[0]);
    const numY = Math.floor(sizeFlag / 9) + 1;
    const numX = (sizeFlag % 9) + 1;

    const quantisedMaximumValue = decode83(hash[1]);
    const maximumValue = (quantisedMaximumValue + 1) / 166;

    const colors: [number, number, number][] = [];

    for (let i = 0; i < numX * numY; i++) {
      if (i === 0) {
        const int = decode83(hash.substring(2, 6));
        colors.push(decodeDC(int));
      } else {
        const int = decode83(hash.substring(4 + i * 2, 6 + i * 2));
        colors.push(decodeAC(int, maximumValue * punch));
      }
    }

    const pixels = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0,
          g = 0,
          b = 0;

        for (let j = 0; j < numY; j++) {
          for (let i = 0; i < numX; i++) {
            const basis =
              Math.cos((Math.PI * x * i) / width) *
              Math.cos((Math.PI * y * j) / height);
            const color = colors[j * numX + i];
            r += color[0] * basis;
            g += color[1] * basis;
            b += color[2] * basis;
          }
        }

        const idx = (y * width + x) * 4;
        pixels[idx] = linearToSRGB(r);
        pixels[idx + 1] = linearToSRGB(g);
        pixels[idx + 2] = linearToSRGB(b);
        pixels[idx + 3] = 255;
      }
    }

    return { width, height, pixels };
  } catch {
    return null;
  }
}

function decodeDC(value: number): [number, number, number] {
  const r = value >> 16;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return [sRGBToLinear(r), sRGBToLinear(g), sRGBToLinear(b)];
}

function decodeAC(value: number, maximumValue: number): [number, number, number] {
  const quant = Math.floor(value / (19 * 19));
  const r = signPow(((quant) - 9) / 9, 2) * maximumValue;
  const g =
    signPow(((Math.floor(value / 19) % 19) - 9) / 9, 2) * maximumValue;
  const b = signPow(((value % 19) - 9) / 9, 2) * maximumValue;
  return [r, g, b];
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface BlurhashImageProps {
  /** URL of the actual image to load. */
  src: string;
  /** Alt text for accessibility. */
  alt: string;
  /** Blurhash string. Falls back to a solid muted colour if absent. */
  blurhash?: string;
  /** Explicit pixel width (also used as the CSS width). */
  width?: number;
  /** Explicit pixel height (also used as the CSS height). */
  height?: number;
  /**
   * CSS aspect-ratio value (e.g. "16/9", "1/1"). Applied when width/height
   * are omitted so layout space is still reserved.
   */
  aspectRatio?: string;
  className?: string;
  style?: CSSProperties;
  /** img loading attribute – defaults to "lazy". */
  loading?: "lazy" | "eager";
}

// Low-resolution size used when painting the placeholder canvas (4×4 px gives
// a smooth gradient with minimal decode cost).
const DECODE_WIDTH = 32;
const DECODE_HEIGHT = 32;

export function BlurhashImage({
  src,
  alt,
  blurhash,
  width,
  height,
  aspectRatio,
  className,
  style,
  loading = "lazy",
}: BlurhashImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // Paint the blurhash placeholder onto the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !blurhash) return;

    const decoded = decodeBlurhash(blurhash, DECODE_WIDTH, DECODE_HEIGHT);
    if (!decoded) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const imageData = ctx.createImageData(decoded.width, decoded.height);
    imageData.data.set(decoded.pixels);
    ctx.putImageData(imageData, 0, 0);
  }, [blurhash]);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setError(true), []);

  const containerStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    display: "block",
    width: width ? `${width}px` : "100%",
    height: height ? `${height}px` : undefined,
    aspectRatio: !height ? (aspectRatio ?? "16/9") : undefined,
    backgroundColor: "var(--color-surface-2, #1f2937)",
    ...style,
  };

  const placeholderStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    // imageRendering: "pixelated" makes the upscaled 32px canvas look blurry
    // rather than blocky — the browser's bilinear upscaling smooths it out.
    transition: "opacity 0.4s ease",
    opacity: loaded ? 0 : 1,
    pointerEvents: "none",
  };

  const imgStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transition: "opacity 0.4s ease",
    opacity: loaded ? 1 : 0,
  };

  return (
    <div style={containerStyle} className={className}>
      {/* Blurhash canvas placeholder */}
      {!loaded && !error && blurhash && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={placeholderStyle}
        />
      )}

      {/* Solid-colour fallback when no blurhash is provided */}
      {!loaded && !error && !blurhash && (
        <div
          aria-hidden="true"
          style={{ ...placeholderStyle, background: "var(--color-surface-2, #1f2937)" }}
        />
      )}

      {/* Actual image */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        style={imgStyle}
      />
    </div>
  );
}
