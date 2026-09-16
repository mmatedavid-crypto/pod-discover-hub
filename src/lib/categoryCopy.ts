// Single source of truth for category landing copy lives in the shared edge
// module so the prerendered bot HTML and the React page never drift apart.
export {
  categoryGuidance,
  categoryHeading,
  categoryIntro,
  categoryMetaDescription,
  categoryTitle,
} from "../../supabase/functions/_shared/category-copy";
export type { CategoryCopyInput } from "../../supabase/functions/_shared/category-copy";
