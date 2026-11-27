"use client";

/**
 * MediaGallery.tsx
 *
 * Displays one or more media attachments on a post with the following layouts:
 *   - 1 image  : full-width
 *   - 2 images : side-by-side grid
 *   - 3+ images: masonry-style 2×2 grid showing the first four; a "+N" badge
 *                overlays the fourth cell for any items beyond the first four.
 *
 * Clicking any image opens a native <dialog> lightbox with arrow navigation
 * and Escape-to-close. Each image uses BlurhashImage for lazy loading with a
 * blurhash placeholder (no CLS).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { BlurhashImage } from "@/components/BlurhashImage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MediaItem {
  url: string;
  blurhash?: string;
}

export interface MediaGalleryProps {
  items: MediaItem[];
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps {
  items: MediaItem[];
  initialIndex: number;
  onClose: () => void;
}

function Lightbox({ items, initialIndex, onClose }: LightboxProps) {
  const [current, setCurrent] = useState(initialIndex);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Open the native dialog on mount.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Close when clicking the backdrop (outside the inner panel).
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) onClose();
    },
    [onClose],
  );

  // Keyboard navigation.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        setCurrent((c) => (c + 1) % items.length);
      } else if (e.key === "ArrowLeft") {
        setCurrent((c) => (c - 1 + items.length) % items.length);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items.length, onClose]);

  const item = items[current];

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      onClick={handleBackdropClick}
      className="fixed inset-0 m-auto max-h-screen max-w-screen-lg w-full bg-transparent p-0 backdrop:bg-black/80"
      aria-label="Image lightbox"
    >
      {/* Inner panel — clicks here do NOT close the dialog */}
      <div
        className="relative flex h-full max-h-[90vh] w-full items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
          aria-label="Close lightbox"
        >
          ✕
        </button>

        {/* Previous */}
        {items.length > 1 && (
          <button
            onClick={() => setCurrent((c) => (c - 1 + items.length) % items.length)}
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            aria-label="Previous image"
          >
            ‹
          </button>
        )}

        {/* Image */}
        <BlurhashImage
          src={item.url}
          alt={`Image ${current + 1} of ${items.length}`}
          blurhash={item.blurhash}
          width={1200}
          height={800}
          wrapperClassName="max-h-[85vh] max-w-full rounded-lg overflow-hidden"
          className="rounded-lg"
        />

        {/* Next */}
        {items.length > 1 && (
          <button
            onClick={() => setCurrent((c) => (c + 1) % items.length)}
            className="absolute right-3 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            aria-label="Next image"
          >
            ›
          </button>
        )}

        {/* Counter */}
        {items.length > 1 && (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {current + 1} / {items.length}
          </span>
        )}
      </div>
    </dialog>
  );
}

// ─── Gallery cell ─────────────────────────────────────────────────────────────

interface GalleryCellProps {
  item: MediaItem;
  index: number;
  overflowCount?: number;
  onOpen: (index: number) => void;
  wrapperClassName?: string;
}

function GalleryCell({ item, index, overflowCount, onOpen, wrapperClassName }: GalleryCellProps) {
  return (
    <button
      type="button"
      className={`relative overflow-hidden rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${wrapperClassName ?? ""}`}
      onClick={() => onOpen(index)}
      aria-label={`Open image ${index + 1}`}
    >
      <BlurhashImage
        src={item.url}
        alt={`Post image ${index + 1}`}
        blurhash={item.blurhash}
        width={800}
        height={600}
        wrapperClassName="w-full h-full"
        className="rounded-lg object-cover transition-opacity duration-200 hover:opacity-90"
      />
      {/* Overflow badge on the last visible cell */}
      {overflowCount !== undefined && overflowCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/55">
          <span className="text-2xl font-bold text-white">+{overflowCount}</span>
        </div>
      )}
    </button>
  );
}

// ─── MediaGallery ─────────────────────────────────────────────────────────────

/**
 * Renders a responsive image gallery for post media attachments.
 *
 * @example
 * <MediaGallery items={[{ url: "/img1.jpg", blurhash: "LGFFaXYk^6#M" }, { url: "/img2.jpg" }]} />
 */
export function MediaGallery({ items }: MediaGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!items || items.length === 0) return null;

  const openLightbox = (index: number) => setLightboxIndex(index);
  const closeLightbox = () => setLightboxIndex(null);

  // ── Single image ───────────────────────────────────────────────────────────
  if (items.length === 1) {
    return (
      <>
        <GalleryCell
          item={items[0]}
          index={0}
          onOpen={openLightbox}
          wrapperClassName="w-full"
        />
        {lightboxIndex !== null && (
          <Lightbox items={items} initialIndex={lightboxIndex} onClose={closeLightbox} />
        )}
      </>
    );
  }

  // ── Two images: side-by-side ───────────────────────────────────────────────
  if (items.length === 2) {
    return (
      <>
        <div className="grid grid-cols-2 gap-1">
          {items.map((item, i) => (
            <GalleryCell key={item.url + i} item={item} index={i} onOpen={openLightbox} />
          ))}
        </div>
        {lightboxIndex !== null && (
          <Lightbox items={items} initialIndex={lightboxIndex} onClose={closeLightbox} />
        )}
      </>
    );
  }

  // ── Three or more images: masonry-style 2×2, overflow badge on 4th ────────
  const visibleItems = items.slice(0, 4);
  const overflowCount = items.length > 4 ? items.length - 4 : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        {visibleItems.map((item, i) => (
          <GalleryCell
            key={item.url + i}
            item={item}
            index={i}
            onOpen={openLightbox}
            overflowCount={i === 3 ? overflowCount : undefined}
          />
        ))}
      </div>
      {lightboxIndex !== null && (
        <Lightbox items={items} initialIndex={lightboxIndex} onClose={closeLightbox} />
      )}
    </>
  );
}

export default MediaGallery;
