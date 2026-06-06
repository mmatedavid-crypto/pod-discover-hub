type ImageOptions = {
  width?: number;
  height?: number;
  quality?: number;
};

const APPLE_ARTWORK_RX = /\/(\d+)x(\d+)(bb|bf|cc)?\.(jpg|jpeg|png|webp)(\?.*)?$/i;

export function optimizedImageUrl(src?: string | null, opts: ImageOptions = {}) {
  if (!src) return null;
  const normalizedSrc = src.replace(/&amp;/g, "&");
  const width = Math.max(32, Math.round(opts.width || 160));
  const height = Math.max(32, Math.round(opts.height || width));
  const quality = Math.min(95, Math.max(35, Math.round(opts.quality || 78)));

  try {
    const url = new URL(normalizedSrc);

    if (url.hostname.includes("mzstatic.com") || url.hostname.includes("itunes.apple.com")) {
      url.pathname = url.pathname.replace(APPLE_ARTWORK_RX, `/${width}x${height}bb.$4`);
      return url.toString();
    }

    if (url.pathname.includes("/storage/v1/object/public/")) {
      url.pathname = url.pathname.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
      url.searchParams.set("width", String(width));
      url.searchParams.set("height", String(height));
      url.searchParams.set("resize", "cover");
      url.searchParams.set("quality", String(quality));
      return url.toString();
    }

    if (url.hostname.includes("ytimg.com")) {
      url.pathname = url.pathname.replace(/\/(maxresdefault|sddefault|hqdefault)\.jpg$/i, "/mqdefault.jpg");
      return url.toString();
    }

    if (url.hostname.includes("omnycontent.com")) {
      url.searchParams.set("size", width <= 160 ? "Small" : width <= 360 ? "Medium" : "Large");
      return url.toString();
    }
  } catch {
    return normalizedSrc;
  }

  return normalizedSrc;
}

export function imageSrcSet(src?: string | null, widths: number[] = [96, 160, 240]) {
  if (!src) return undefined;
  const entries = widths
    .map((w) => {
      const url = optimizedImageUrl(src, { width: w, height: w });
      return url ? `${url} ${w}w` : null;
    })
    .filter(Boolean);
  return entries.length ? entries.join(", ") : undefined;
}
