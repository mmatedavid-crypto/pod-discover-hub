import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
type Insights = { questions: string[]; entities: { name: string; kind: string }[]; format: string | null };
export function EpisodeSourceInsights({ episodeId }: { episodeId: string }) {
 const {data}=useQuery({queryKey:['episode-source-insights',episodeId],staleTime:300000,retry:false,queryFn:async()=>{
  const r=await (supabase as any).rpc('get_episode_enrichment_public_v1',{p_episode:episodeId});
  if(r.error) return null;return r.data as Insights|null;
 }});
 if(!data || (!data.questions?.length && !data.entities?.length && !data.format)) return null;
 return <section className="mt-6 rounded-lg border border-border bg-card p-4" aria-label="Az epizód tartalma">
  {data.format && <p className="mb-3 text-xs text-muted-foreground">Műfaj: {data.format}</p>}
  {!!data.questions?.length && <><h2 className="mb-2 text-sm font-medium">Ezekről a kérdésekről szól</h2>
   <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">{data.questions.map(q=><li key={q}>{q}</li>)}</ul></>}
  {!!data.entities?.length && <div className="mt-4 flex flex-wrap gap-2">{data.entities.map(e=><Link className="rounded-full border border-border px-3 py-1 text-xs hover:bg-secondary" key={e.kind+e.name} to={`/kereses?q=${encodeURIComponent('"'+e.name+'"')}`}>{e.name}</Link>)}</div>}
 </section>;
}
