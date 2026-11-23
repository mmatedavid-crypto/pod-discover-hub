import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import ListLoadError from "@/components/ListLoadError";
import { Button } from "@/components/ui/button";
import { setSeo } from "@/lib/seo";
import { optimizedImageUrl } from "@/lib/image";
import { hasStandaloneToken } from "@/lib/landingCuration";

const CANONICAL = "https://podiverzum.hu/byd";
const TOKEN = "BYD";
const PAGE_SIZE = 20;

// Every Hungarian catalog episode whose title or RSS description contained the standalone token "BYD"
// when this page was built (2026-11-23). Read by primary key, so the page never scans the episodes table.
const VERIFIED_IDS = "3d80b617-63be-48a1-b975-e758bb40ccdd,1615cb92-db01-410f-8f84-9d4a1de4cdef,d1235b12-5d9a-4e0d-a643-affd8204e05f,f74a833c-56ef-4ce3-9cbf-1597254aa5f2,a16cb1f6-cb60-42b3-bf38-69e9d9c32b1c,1c736750-1f88-4366-8c63-1c0e0ce79ca7,1afaad7d-11fe-4efb-8583-e8886f8df1a4,5ecd9bdb-bef3-4f2c-9af8-dd2cf52a3865,6839986d-340f-4288-8c3a-b60b35204c9e,05c2c75a-f9c7-45a8-879a-b44236210a8b,cf3dc62d-e29d-4be2-a15b-350b3815a7ca,6b880eff-f25b-4f48-8405-a359ec6bb23f,9fe9486f-187b-4a98-896e-dce68470f8af,6679b8b9-4b8f-4023-a5a4-808db58d3d8e,19b6f610-3c9d-413d-b817-820f09b25a65,974b8aa9-8c5c-4013-ba1a-ae3b8c61bcd4,3cb01560-256d-459f-84dc-ef7e120b006d,a2b357b1-d9bd-4761-b40f-d9decf7b7c2a,0039d5be-4015-43a7-bd04-23c2fe07a63e,11d6bec0-998c-4374-9b29-35504baab9fd,9622e1f0-39c2-49a2-9635-1f157a846e50,1005d503-acc9-47da-9849-3bdc81a0dbba,eb4b001f-4516-4a56-8e57-294ffe9480ee,1f0c8873-4d91-4080-83b6-3ff21ef1bd88,31752f06-7668-448a-9f6e-f89c2ff47383,3e39d1b8-6224-4412-b0c9-a0237a6fbb8f,eb25f409-fcfb-43fc-a662-56bf1b964f3a,dfb388d9-d787-402a-a2a6-afc329d16847,95e17ac8-5ee3-4412-8b26-69767684b188,675f8ba9-d33f-43ce-b8ad-e43ecf030b2b,648cb3e9-5409-47b4-aa23-0f48e02479d1,cd89c741-b0ea-4906-8c14-02b1c6693c3d,289e312c-2cd9-43f0-9453-f49989328ade,707c7cce-99e6-49ef-b489-f74e5785e85e,d4eae326-6f94-46d2-a320-d03e6e21dbc5,620cd3a9-5fe0-4a5d-bf0b-e4fe521c2024,1a2bd8a0-7cf3-477a-9084-d224b12052a6,6f8297cf-7c8d-4183-9e36-2fceac373b83,040403fc-2082-4a1b-beef-f52555c70730,82b4a99c-a5da-4de1-b263-3ec88b6fd610,b7937266-7ff3-4a22-a939-f1caa81f1e4d,af96e693-b05e-4d69-a16b-928225f0b39e,53dbabcd-f047-4f4b-a443-f8d371f764ae,a1134b9b-f67b-46e8-890e-7ab2ff23ad1f,9c9f62d6-9c66-488f-87f1-80efe5f5fffb,ea231c80-5f9a-4a8b-b116-3a872544a842,f2c29aa7-5c9b-44d5-9c4f-09504f77f976,77e60a65-87aa-406a-ba77-55bbf5e9fb5a,b408fe16-0d18-4020-8054-341da27410b5,d9e855d3-7679-4cce-9da7-36fae0feb441,c226029b-7db3-46f7-aa90-94297357fa56,93cfa84d-9f5b-4382-a618-8ea88bc202e9,9f983dd7-6d9e-4e85-b1c7-370b91c314a3,51101125-525a-4899-ad52-e1e0d629c7bb,654fca89-af44-4440-bcac-b61c9cd2a554,b00ac9c8-1c15-4402-a80e-33b26b2dcb29,a9f4f2ef-fd9e-4efe-89d2-5e392e32e4fb,1516452a-c3af-47a1-a882-2e6ffb802b14,2847bae9-b895-4f89-8524-eace2be0cd6a,a9b51e66-6b9f-4c6a-81ba-bb5de648c49d,8b0cbddd-17ea-404c-b413-5e84ac98915f,557cd827-9235-4d82-8963-36b5d81627aa,c5d6151e-5ecb-4aac-8959-7620fd28097b,a998662f-8e8b-449a-9c38-888492a2a0db,27190859-9be3-4626-834e-f0fa1e139f62,00c22f90-16d7-4570-972d-8dcde0e39783".split(",");

const SELECT = "id, title, display_title, slug, description, published_at, image_url, podcasts!inner(slug, title, display_title, image_url, language)";

type Item = { id: string; href: string; title: string; show: string; showHref: string; date: string; dateIso: string; image: string | null; inTitle: boolean };

const huDate = (iso: string) =>
  new Date(iso).toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Budapest" });

export default function BydPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [shown, setShown] = useState(PAGE_SIZE);

  useEffect(() => {
    setSeo({
      title: "Podcastok a BYD-ről | Podiverzum",
      description: "Magyar podcastepizódok a BYD-ről: autók, a szegedi gyár, a magyarországi beruházás – a Podiverzum katalógusából.",
      canonical: CANONICAL,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(false);
      const [known, fresh] = await Promise.all([
        supabase.from("episodes").select(SELECT).in("id", VERIFIED_IDS),
        // New episodes: indexed trigram lookups only (title, search_text); every hit is re-checked below.
        supabase.from("episodes").select(SELECT).or("title.ilike.*byd*,search_text.ilike.*byd*").limit(200),
      ]);
      if (cancelled) return;
      if (known.error) { setError(true); setItems([]); return; }
      const seen = new Set<string>();
      const dupKey = new Set<string>();
      const list: Item[] = [];
      for (const r of [...(known.data || []), ...(fresh.data || [])] as any[]) {
        const p = r.podcasts;
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (!r.slug || !p?.slug || !r.published_at || !String(p.language || "").toLowerCase().startsWith("hu")) continue;
        const title: string = r.display_title || r.title || "";
        const inTitle = hasStandaloneToken(title, TOKEN) || hasStandaloneToken(r.title, TOKEN);
        if (!inTitle && !hasStandaloneToken(r.description, TOKEN)) continue;
        if (!title || title.includes("\uFFFD")) continue;
        const k = `${(p.display_title || p.title || "").trim().toLowerCase()}|${title.trim().toLowerCase()}`;
        if (dupKey.has(k)) continue; // same episode imported twice (duplicate feed copies of one show)
        dupKey.add(k);
        list.push({
          id: r.id,
          href: `/podcast/${p.slug}/${r.slug}`,
          title,
          show: p.display_title || p.title || "",
          showHref: `/podcast/${p.slug}`,
          date: huDate(r.published_at),
          dateIso: r.published_at,
          image: r.image_url || p.image_url || null,
          inTitle,
        });
      }
      list.sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime());
      setItems(list);
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const visible = (items || []).slice(0, shown);
  const titled = items?.filter((i) => i.inTitle).length ?? 0;

  return (
    <Layout>
      <div className="container mx-auto max-w-3xl py-10">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Podiverzum – szerkesztői témaoldal</p>
        <h1 className="mt-1 text-3xl font-semibold">Podcastok a BYD-ről</h1>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Magyar podcastadások a kínai BYD autógyártóról: autótesztek és villanyautós beszélgetések, a szegedi gyár és a
          budapesti fejlesztőközpont, valamint a cég magyarországi jelenlétének gazdasági és közéleti vitái. A listát a
          Podiverzum állította össze a nyilvános magyar katalógusából; minden adás az eredeti műsoré.
        </p>
        {items && items.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {items.length} adás · {titled} címében, {items.length - titled} csak a leírásában szerepel a BYD.
          </p>
        )}

        <div className="mt-8">
          {items === null ? (
            <div className="text-sm text-muted-foreground">Betöltés…</div>
          ) : error ? (
            <ListLoadError onRetry={() => setReloadKey((k) => k + 1)} />
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Most nincs megjeleníthető adás.</div>
          ) : (
            <>
              <ul className="space-y-3">
                {visible.map((it) => (
                  <li key={it.id} className="flex gap-3 rounded-lg border border-border/70 bg-card/80 p-3 sm:gap-4 sm:p-4">
                    {it.image && (
                      <img
                        src={optimizedImageUrl(it.image, { width: 160, height: 160 }) || it.image}
                        alt=""
                        width={80}
                        height={80}
                        loading="lazy"
                        decoding="async"
                        className="h-16 w-16 shrink-0 rounded-md bg-secondary object-cover sm:h-20 sm:w-20"
                      />
                    )}
                    <div className="min-w-0">
                      <Link to={it.href} className="font-semibold leading-snug hover:underline">{it.title}</Link>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <Link to={it.showHref} className="hover:underline">{it.show}</Link>
                        <span className="mx-1.5 opacity-60">·</span>
                        <time dateTime={it.dateIso}>{it.date}</time>
                        {!it.inTitle && (<><span className="mx-1.5 opacity-60">·</span>a leírásában említi</>)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {shown < items.length && (
                <div className="mt-6 text-center">
                  <Button variant="outline" onClick={() => setShown((s) => s + PAGE_SIZE)}>
                    Több adás ({items.length - shown} további)
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          A Podiverzum független podcastkereső; ez az oldal nem a BYD vagy forgalmazói kiadványa, és nem tartalmaz ajánlatot.
          Az adások szerzői és kiadói a megjelölt műsorok.
        </p>
      </div>
    </Layout>
  );
}
