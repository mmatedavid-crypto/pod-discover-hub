type ImageOptions = {
  width?: number;
  height?: number;
  quality?: number;
};

const APPLE_ARTWORK_RX = /\/(\d+)x(\d+)(bb|bf|cc)?\.(jpg|jpeg|png|webp)(\?.*)?$/i;
const SIMPLECAST_SIZE_RX = /\/\d+x\d+\//i;
const SOUNDCLOUD_SIZE_RX = /-(original|t500x500|t300x300|large|crop|badge)\.(jpg|jpeg|png|webp)$/i;
const IMAGE_PROXY_HOSTS = new Set([
  "d3t3ozftmdmh3i.cloudfront.net",
  "d3wo5wojvuv7l.cloudfront.net",
  "storage.buzzsprout.com",
  "media.rss.com",
  "pbcdn1.podbean.com",
  "artwork.captivate.fm",
  "static.libsyn.com",
  "episodes.castos.com",
  "media.redcircle.com",
  "i.ibb.co",
]);

function proxiedImageUrl(url: URL, width: number, height: number, quality: number) {
  const proxy = new URL("https://images.weserv.nl/");
  proxy.searchParams.set("url", url.toString());
  proxy.searchParams.set("w", String(width));
  proxy.searchParams.set("h", String(height));
  proxy.searchParams.set("fit", "cover");
  proxy.searchParams.set("q", String(quality));
  return proxy.toString();
}

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

    if (url.hostname.includes("sndcdn.com")) {
      const soundCloudSize = width <= 160 ? "t300x300" : "t500x500";
      url.pathname = url.pathname.replace(SOUNDCLOUD_SIZE_RX, `-${soundCloudSize}.$2`);
      return url.toString();
    }

    if (url.hostname.endsWith(".imgix.net") || url.hostname === "megaphone.imgix.net") {
      url.searchParams.delete("max-w");
      url.searchParams.delete("max-h");
      url.searchParams.set("w", String(width));
      url.searchParams.set("h", String(height));
      url.searchParams.set("fit", "crop");
      url.searchParams.set("auto", "format,compress");
      url.searchParams.set("q", String(quality));
      return url.toString();
    }

    if (url.hostname === "image.simplecastcdn.com" && SIMPLECAST_SIZE_RX.test(url.pathname)) {
      url.pathname = url.pathname.replace(SIMPLECAST_SIZE_RX, `/${width}x${height}/`);
      return url.toString();
    }

    if (url.hostname === "img.transistorcdn.com") {
      url.pathname = url.pathname
        .replace(/\/w:\d+\//i, `/w:${width}/`)
        .replace(/\/h:\d+\//i, `/h:${height}/`)
        .replace(/\/q:\d+\//i, `/q:${quality}/`);
      return url.toString();
    }

    if (url.hostname.includes("omnycontent.com")) {
      url.searchParams.set("size", width <= 160 ? "Small" : width <= 360 ? "Medium" : "Large");
      return url.toString();
    }

    if (IMAGE_PROXY_HOSTS.has(url.hostname)) {
      return proxiedImageUrl(url, width, height, quality);
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
