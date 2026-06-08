import { template as gscWeekly } from './gsc-weekly-insights.tsx'

export type TemplateEntry = {
  // deno-lint-ignore no-explicit-any
  component: (props: any) => unknown
  // deno-lint-ignore no-explicit-any
  subject: string | ((data: any) => string)
  displayName?: string
  // deno-lint-ignore no-explicit-any
  previewData?: any
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'gsc-weekly-insights': gscWeekly,
}
