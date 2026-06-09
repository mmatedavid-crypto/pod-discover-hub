import { useEffect } from "react";
import { siteIdentityJsonLd } from "@/lib/sitePublisher";

export function SiteStructuredData() {
  useEffect(() => {
    const scriptId = "site-identity-json-ld";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      script.dataset.seo = "site-identity";
      document.head.appendChild(script);
    }
    script.text = JSON.stringify(siteIdentityJsonLd());

    return () => {
      document.getElementById(scriptId)?.remove();
    };
  }, []);

  return null;
}
