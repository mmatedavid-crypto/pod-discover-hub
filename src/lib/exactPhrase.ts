// Google-style quoted-phrase search helpers, shared with the search-hybrid edge function.
export {
  parseExactPhraseQuery,
  exactPhraseMatch,
  exactMatchLabel,
  episodeExactFields,
  stripSearchQuotes,
} from "../../supabase/functions/_shared/search-exact-phrase";
export type { ExactPhraseQuery } from "../../supabase/functions/_shared/search-exact-phrase";

export type ExactPhraseInfo = { phrases: string[]; total: number };
