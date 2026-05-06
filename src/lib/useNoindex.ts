import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

/** Apply noindex + simple title on admin/auth pages. */
export function useNoindex(title: string) {
  useEffect(() => {
    setSeo({ title, description: "Internal page.", noindex: true });
  }, [title]);
}
