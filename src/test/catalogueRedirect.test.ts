import { describe, expect, it } from "vitest";
import worker from "../../infra/cloudflare-worker/worker.js";

describe("verified alias HTTP redirect", () => {
  for (const host of ["podiverzum.hu", "www.podiverzum.hu"]) {
    for (const userAgent of ["Mozilla/5.0", "Googlebot"]) {
      it(`redirects ${host} /vereb-pisti in one hop for ${userAgent}`, async () => {
        const response = await worker.fetch(new Request(`https://${host}/szemelyek/vereb-pisti?from=shared`, { headers: { "User-Agent": userAgent } }), {}, {});
        expect(response.status).toBe(301);
        expect(response.headers.get("Location")).toBe("https://podiverzum.hu/szemelyek/vereb-istvan?from=shared");
      });
    }
  }
});