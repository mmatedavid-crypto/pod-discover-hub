import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Action {
  priority?: string
  type?: string
  target?: string
  action?: string
  expected_impact?: string
}

interface QueryRow {
  query?: string
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

interface Props {
  weekStart?: string
  weekEnd?: string
  totals?: { clicks?: number; impressions?: number; ctr?: number; position?: number }
  deltas?: {
    clicks_pct?: number
    impressions_pct?: number
    ctr_delta?: number
    position_delta?: number
  }
  summary?: string
  actions?: Action[]
  striking?: QueryRow[]
  rising?: QueryRow[]
  falling?: QueryRow[]
  adminUrl?: string
}

const fmtInt = (n?: number) => (n ?? 0).toLocaleString('hu-HU')
const fmtPct = (n?: number) =>
  n == null ? '–' : `${(n * 100).toFixed(1)}%`
const fmtSignedPct = (n?: number) => {
  if (n == null) return '–'
  const v = n * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}
const fmtPos = (n?: number) => (n == null ? '–' : n.toFixed(1))

const Email = ({
  weekStart,
  weekEnd,
  totals,
  deltas,
  summary,
  actions = [],
  striking = [],
  rising = [],
  falling = [],
  adminUrl,
}: Props) => (
  <Html lang="hu" dir="ltr">
    <Head />
    <Preview>
      Heti GSC riport: {fmtInt(totals?.clicks)} kattintás ({fmtSignedPct(deltas?.clicks_pct)})
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Heti Search Console riport</Heading>
        <Text style={muted}>
          {weekStart} – {weekEnd} · podiverzum.hu
        </Text>

        <Section style={statsRow}>
          <Stat label="Kattintás" value={fmtInt(totals?.clicks)} delta={fmtSignedPct(deltas?.clicks_pct)} />
          <Stat label="Impresszió" value={fmtInt(totals?.impressions)} delta={fmtSignedPct(deltas?.impressions_pct)} />
          <Stat label="CTR" value={fmtPct(totals?.ctr)} delta={fmtSignedPct(deltas?.ctr_delta)} />
          <Stat
            label="Átl. pozíció"
            value={fmtPos(totals?.position)}
            delta={
              deltas?.position_delta == null
                ? '–'
                : `${deltas.position_delta >= 0 ? '+' : ''}${deltas.position_delta.toFixed(2)}`
            }
          />
        </Section>

        {summary && (
          <Section style={card}>
            <Heading as="h2" style={h2}>Összegzés</Heading>
            <Text style={body}>{summary}</Text>
          </Section>
        )}

        {actions.length > 0 && (
          <Section style={card}>
            <Heading as="h2" style={h2}>Javasolt akciók ({actions.length})</Heading>
            {actions.map((a, i) => (
              <Section key={i} style={actionRow}>
                <Text style={actionTitle}>
                  <span style={priorityBadge(a.priority)}>{(a.priority || 'med').toUpperCase()}</span>{' '}
                  <span style={typeBadge}>{a.type || 'action'}</span>{' '}
                  <span style={actionTarget}>{a.target}</span>
                </Text>
                <Text style={body}>{a.action}</Text>
                {a.expected_impact && (
                  <Text style={muted}>Várt hatás: {a.expected_impact}</Text>
                )}
              </Section>
            ))}
          </Section>
        )}

        {striking.length > 0 && (
          <Section style={card}>
            <Heading as="h2" style={h2}>Striking-distance (top 10)</Heading>
            <Text style={muted}>Pozíció 4.5–20, magas impresszió. Title/meta finomhangolás.</Text>
            {striking.slice(0, 10).map((r, i) => (
              <Text key={i} style={listItem}>
                <strong>{r.query}</strong> · pos {fmtPos(r.position)} · {fmtInt(r.impressions)} impr · CTR {fmtPct(r.ctr)}
              </Text>
            ))}
          </Section>
        )}

        {(rising.length > 0 || falling.length > 0) && (
          <Section style={card}>
            <Heading as="h2" style={h2}>Mozgások</Heading>
            {rising.length > 0 && (
              <>
                <Text style={subHeading}>Felfutó (top 5)</Text>
                {rising.slice(0, 5).map((r, i) => (
                  <Text key={i} style={listItem}>
                    <strong>{r.query}</strong> · +{fmtInt(r.clicks)} klikk
                  </Text>
                ))}
              </>
            )}
            {falling.length > 0 && (
              <>
                <Text style={subHeading}>Eső (top 5)</Text>
                {falling.slice(0, 5).map((r, i) => (
                  <Text key={i} style={listItem}>
                    <strong>{r.query}</strong> · {fmtInt(r.clicks)} klikk
                  </Text>
                ))}
              </>
            )}
          </Section>
        )}

        <Hr style={hr} />
        <Text style={muted}>
          Részletes adatok az admin felületen: {adminUrl || 'https://podiverzum.hu/admin/gsc-insights'}
        </Text>
      </Container>
    </Body>
  </Html>
)

const Stat = ({ label, value, delta }: { label: string; value: string; delta: string }) => (
  <div style={statBox}>
    <Text style={statLabel}>{label}</Text>
    <Text style={statValue}>{value}</Text>
    <Text style={statDelta}>{delta}</Text>
  </div>
)

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif' }
const container = { padding: '24px', maxWidth: '640px', margin: '0 auto' }
const h1 = { fontSize: '24px', fontWeight: 700, margin: '0 0 4px', color: '#0f172a' }
const h2 = { fontSize: '16px', fontWeight: 600, margin: '0 0 8px', color: '#0f172a' }
const subHeading = { fontSize: '13px', fontWeight: 600, margin: '12px 0 4px', color: '#475569' }
const body = { fontSize: '14px', lineHeight: '20px', color: '#1e293b', margin: '4px 0' }
const muted = { fontSize: '12px', color: '#64748b', margin: '4px 0' }
const listItem = { fontSize: '13px', color: '#1e293b', margin: '2px 0' }
const hr = { borderColor: '#e2e8f0', margin: '24px 0 12px' }
const card = { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', margin: '16px 0' }
const statsRow = { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, margin: '16px 0' }
const statBox = { flex: '1 1 140px', padding: '12px', backgroundColor: '#f1f5f9', borderRadius: '6px', minWidth: '120px' }
const statLabel = { fontSize: '11px', color: '#64748b', textTransform: 'uppercase' as const, margin: 0 }
const statValue = { fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '2px 0' }
const statDelta = { fontSize: '12px', color: '#475569', margin: 0 }
const actionRow = { borderTop: '1px solid #e2e8f0', paddingTop: '8px', marginTop: '8px' }
const actionTitle = { fontSize: '13px', margin: '0 0 4px' }
const actionTarget = { color: '#0f172a', fontWeight: 600 }
const typeBadge = { display: 'inline-block', padding: '1px 6px', borderRadius: '3px', backgroundColor: '#e2e8f0', color: '#475569', fontSize: '11px', marginRight: '4px' }

const priorityBadge = (p?: string) => {
  const colors: Record<string, { bg: string; fg: string }> = {
    high: { bg: '#fee2e2', fg: '#991b1b' },
    medium: { bg: '#fef3c7', fg: '#92400e' },
    low: { bg: '#dcfce7', fg: '#166534' },
  }
  const c = colors[p || 'medium'] || colors.medium
  return {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: '3px',
    backgroundColor: c.bg,
    color: c.fg,
    fontSize: '11px',
    fontWeight: 700,
    marginRight: '4px',
  }
}

export const template = {
  component: Email,
  subject: (d: Props) =>
    `Heti GSC riport · ${d.weekStart || ''} – ${d.weekEnd || ''} · ${fmtInt(d.totals?.clicks)} klikk (${fmtSignedPct(d.deltas?.clicks_pct)})`,
  displayName: 'Heti GSC SEO insight',
  previewData: {
    weekStart: '2026-06-01',
    weekEnd: '2026-06-07',
    totals: { clicks: 1234, impressions: 45678, ctr: 0.027, position: 18.4 },
    deltas: { clicks_pct: 0.12, impressions_pct: -0.03, ctr_delta: 0.004, position_delta: -0.8 },
    summary: 'A héten +12% kattintás, miközben az átlagos pozíció javult.',
    actions: [
      { priority: 'high', type: 'title_meta', target: 'partizán podcast', action: 'Title frissítés brand-előtéttel.', expected_impact: '+CTR' },
    ],
    striking: [{ query: 'partizán podcast', impressions: 800, clicks: 18, ctr: 0.022, position: 6.8 }],
    rising: [{ query: 'magyar podcast', clicks: 40 }],
    falling: [{ query: 'régi query', clicks: 5 }],
  },
} satisfies TemplateEntry
