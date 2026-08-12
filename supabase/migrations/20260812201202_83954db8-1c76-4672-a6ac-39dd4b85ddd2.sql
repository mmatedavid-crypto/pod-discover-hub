-- 1) New spirituality/religion + esoterica topics
insert into public.topics (slug, name, short_name, domain, topic_type, priority, is_public, is_indexable, seo_title, seo_description, h1, intro_text, positive_hints)
values
 ('katolikus-egyhaz','Katolikus egyház','Katolikus','spirituality','seo',80,true,false,
  'Katolikus egyház – magyar podcast epizódok','Katolikus témájú magyar podcast epizódok: szentmise, plébániai élet, püspöki tanítás, pápai megnyilatkozások és hitbeli kérdések.','Katolikus egyház a magyar podcastokban',
  'Szentmise, liturgia, plébániai élet, egyházi tanítás és pápai megnyilatkozások magyar podcastokban. Az epizódok között katolikus lelkiségi műsorok, interjúk papokkal és hitbeli beszélgetések is szerepelnek.',
  array['katolikus','szentmise','plébánia','püspök','pápa','ferences','jezsuita']),
 ('protestans-egyhazak','Protestáns egyházak','Protestáns','spirituality','seo',76,true,false,
  'Protestáns egyházak – magyar podcastok','Református, evangélikus és más protestáns közösségek magyar podcast epizódjai: igehirdetés, bibliaóra, hit és gyakorlat.','Protestáns egyházak a magyar podcastokban',
  'Református, evangélikus, baptista és más protestáns közösségek műsorai: igehirdetés, bibliatanulmány, gyülekezeti élet és hitbeli kérdések magyar nyelven.',
  array['református','evangélikus','protestáns','igehirdetés','gyülekezet','baptista']),
 ('zsido-hagyomany','Zsidó hagyomány','Judaizmus','spirituality','seo',72,true,false,
  'Zsidó hagyomány – magyar podcast epizódok','Tóra, Talmud, zsidó ünnepek és magyar zsidó közösségi élet magyar podcastokban.','Zsidó hagyomány a magyar podcastokban',
  'Tóra- és Talmud-tanulás, zsidó ünnepek, rabbinikus tanítás, valamint a magyar zsidó közösségi élet témái magyar podcast epizódokban.',
  array['zsidó','tóra','talmud','rabbi','sábesz','hanuka','judaizmus']),
 ('imadsag','Imádság és liturgia','Imádság','spirituality','seo',70,true,false,
  'Imádság és liturgia – magyar podcastok','Imádság, rózsafüzér, napi elmélkedés és liturgia magyar podcast epizódokban.','Imádság és liturgia a magyar podcastokban',
  'Napi imádság, rózsafüzér, elmélkedés, zsolozsma és liturgikus magyarázatok magyar podcastokban – rövid, hétköznap is hallgatható epizódok.',
  array['imádság','rózsafüzér','elmélkedés','liturgia','zsolozsma']),
 ('zarandoklat-szentek','Zarándoklat és szentek','Zarándoklat','spirituality','seo',68,true,false,
  'Zarándoklat és szentek – magyar podcastok','Kegyhelyek, zarándokutak és szentek élete magyar podcast epizódokban: Csíksomlyó, Máriapócs, Szent István és mások.','Zarándoklat és szentek a magyar podcastokban',
  'Kegyhelyek, zarándokutak és szentéletrajzok: Csíksomlyó, Máriapócs, Mariazell, Szent István, Szent Márton és további szentek története magyar podcastokban.',
  array['zarándok','kegyhely','csíksomlyó','máriapócs','szent istván','szentté']),
 ('hit-es-megteres','Hit és megtérés','Hit','spirituality','seo',66,true,false,
  'Hit és megtérés – magyar podcast epizódok','Személyes hittörténetek, megtérés, kétely és istenkeresés magyar podcastokban.','Hit és megtérés a magyar podcastokban',
  'Személyes hittörténetek, megtérés, kételyek és istenkeresés: őszinte beszélgetések arról, hogyan változtatja meg a hit az emberek életét.',
  array['megtérés','istenkeresés','hitem','kétely','ateizmus']),
 ('ezoterika','Ezoterika','Ezoterika','spirituality','seo',78,true,false,
  'Ezoterika – magyar podcast epizódok','Ezoterikus témák magyar podcastokban: energiák, csakrák, gyógyítás, spirituális tanítások.','Ezoterika a magyar podcastokban',
  'Ezoterikus tanítások és gyakorlatok magyar podcastokban: energiamunka, csakrák, aura, reiki, spirituális önfejlesztés és határtudományos megközelítések.',
  array['ezoterikus','ezoterika','csakra','aura','reiki','energiagyógyász']),
 ('asztrologia','Asztrológia és horoszkóp','Asztrológia','spirituality','seo',75,true,false,
  'Asztrológia és horoszkóp – magyar podcastok','Asztrológiai elemzések, horoszkóp, holdfázisok és születési képek magyar podcast epizódokban.','Asztrológia és horoszkóp a magyar podcastokban',
  'Horoszkóp-előrejelzések, születési kép elemzések, holdfázisok és tranzitok: asztrológiai műsorok és beszélgetések magyar nyelven.',
  array['asztrológia','horoszkóp','zodiákus','holdfázis','születési kép','tranzit']),
 ('tarot-joslas','Tarot és jóslás','Tarot','spirituality','seo',64,true,false,
  'Tarot és jóslás – magyar podcast epizódok','Tarot, kártyavetés, numerológia és jóslási hagyományok magyar podcastokban.','Tarot és jóslás a magyar podcastokban',
  'Tarot-kártyák, kártyavetés, numerológia és a jóslás hagyományai: bevezető és haladó epizódok magyar podcastokból.',
  array['tarot','kártyavetés','jóslás','numerológia']),
 ('reinkarnacio-tulvilag','Reinkarnáció és túlvilág','Túlvilág','spirituality','seo',62,true,false,
  'Reinkarnáció és túlvilág – magyar podcastok','Reinkarnáció, előző életek, halálközeli élmények és túlvilág-elképzelések magyar podcast epizódokban.','Reinkarnáció és túlvilág a magyar podcastokban',
  'Reinkarnáció, előző életek regressziója, halálközeli élmények és a túlvilággal kapcsolatos elképzelések – vallási és ezoterikus megközelítésből.',
  array['reinkarnáció','előző élet','halálközeli','túlvilág','szellemvilág']),
 ('buddhizmus-zen','Buddhizmus és zen','Buddhizmus','spirituality','seo',60,true,false,
  'Buddhizmus és zen – magyar podcast epizódok','Buddhista tanítások, zen, dharma és tibeti hagyomány magyar podcastokban.','Buddhizmus és zen a magyar podcastokban',
  'Buddhista tanítások és gyakorlatok: zen, dharma, tibeti buddhizmus, éberség és a szenvedésről szóló tanítások magyar podcast epizódokban.',
  array['buddhizmus','buddhista','zen','dharma','tibeti buddhizmus']),
 ('samanizmus-nephagyomany','Sámánizmus és néphagyomány','Sámánizmus','spirituality','seo',58,true,false,
  'Sámánizmus és néphagyomány – magyar podcastok','Sámáni hagyomány, dobolás, népi gyógyítás és magyar ősvallás témájú podcast epizódok.','Sámánizmus és néphagyomány a magyar podcastokban',
  'Sámáni hagyomány, dobolás, révülés, népi gyógyítás és a magyar ősvallás kutatása – néprajzi és spirituális megközelítésben.',
  array['sámán','sámánizmus','révülés','népi gyógyítás','ősvallás']),
 ('paranormalis-jelensegek','Paranormális jelenségek','Paranormális','spirituality','seo',70,true,false,
  'Paranormális jelenségek – magyar podcastok','UFO-k, szellemjárás, kísértethistóriák és megfejtetlen jelenségek magyar podcast epizódokban.','Paranormális jelenségek a magyar podcastokban',
  'UFO-észlelések, szellemjárás, kísértethistóriák és megfejtetlen jelenségek: tényfeltáró és szórakoztató epizódok magyar podcastokból.',
  array['paranormális','ufo','szellemjárás','kísértet','földönkívüli','megfejtetlen']),
 ('mindfulness','Mindfulness és éberség','Mindfulness','spirituality','seo',66,true,false,
  'Mindfulness és éberség – magyar podcastok','Mindfulness gyakorlatok, tudatos jelenlét, légzéstechnikák és vezetett meditációk magyar podcastokban.','Mindfulness és éberség a magyar podcastokban',
  'Tudatos jelenlét, mindfulness gyakorlatok, légzéstechnikák és vezetett meditációk – stresszoldás és fókusz magyar podcast epizódokkal.',
  array['mindfulness','tudatos jelenlét','éberség','légzéstechnika','vezetett meditáció'])
on conflict (slug) do nothing;

-- 2) Map Hungarian episodes to the new topics by keyword evidence
with pat(slug, rx) as (values
 ('katolikus-egyhaz','katolikus|szentmise|plébáni|püspök|ferenc pápa|jezsuit|ferences rend'),
 ('protestans-egyhazak','reformát|evangélikus|protestáns|igehirdet|gyülekezet|baptista'),
 ('zsido-hagyomany','zsidó|tóra|talmud|rabbi|sábesz|hanuka|judaizmus'),
 ('imadsag','imádság|rózsafüzér|elmélked|liturgi|zsolozsma|szentmise'),
 ('zarandoklat-szentek','zarándok|kegyhely|csíksomlyó|máriapócs|mariazell|szent istván|szentté avat'),
 ('hit-es-megteres','megtérés|istenkeres|hitem|hit és kétely|ateizmus'),
 ('ezoterika','ezoteri|csakra|aura[^b]|reiki|energiagyógy|energia gyógyít'),
 ('asztrologia','asztrológ|horoszkóp|zodiákus|holdfázis|születési kép|asztro'),
 ('tarot-joslas','tarot|kártyavet|jóslás|numerológ'),
 ('reinkarnacio-tulvilag','reinkarnáci|előző élet|halálközeli|túlvilág|szellemvilág'),
 ('buddhizmus-zen','buddhizmus|buddhist|zen buddh|dharma|tibeti buddh|zen mester'),
 ('samanizmus-nephagyomany','sámán|samanizmus|révülés|népi gyógyít|ősvallás'),
 ('paranormalis-jelensegek','paranormál|ufo|szellemjár|kísértet|földönkívüli|megfejtetlen jelens'),
 ('mindfulness','mindfulness|tudatos jelenlét|éberség|légzéstechnik|vezetett meditáci')
)
insert into public.episode_topic_map (episode_id, topic_id, confidence, source)
select e.id, t.id, 0.55, 'keyword_seed_2026_08'
from pat
join public.topics t on t.slug = pat.slug
join public.episodes e on (coalesce(e.title,'') || ' ' || coalesce(e.description,'')) ~* pat.rx
join public.podcasts p on p.id = e.podcast_id and p.language_decision = 'accept_hungarian'
on conflict (episode_id, topic_id) do nothing;

-- 3) Refresh counters for the new topics and gate indexability
with agg as (
  select t.id, count(distinct m.episode_id) as eps, count(distinct e.podcast_id) as pods
  from public.topics t
  left join public.episode_topic_map m on m.topic_id = t.id
  left join public.episodes e on e.id = m.episode_id
  where t.slug in ('katolikus-egyhaz','protestans-egyhazak','zsido-hagyomany','imadsag','zarandoklat-szentek','hit-es-megteres','ezoterika','asztrologia','tarot-joslas','reinkarnacio-tulvilag','buddhizmus-zen','samanizmus-nephagyomany','paranormalis-jelensegek','mindfulness')
  group by t.id
)
update public.topics t
set episode_count = agg.eps,
    podcast_count = agg.pods,
    is_indexable = agg.eps >= 5,
    updated_at = now()
from agg
where agg.id = t.id;