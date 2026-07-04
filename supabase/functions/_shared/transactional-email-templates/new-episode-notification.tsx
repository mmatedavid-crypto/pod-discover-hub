import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  podcastTitle?: string
  episodeTitle?: string
  episodeUrl?: string
  episodeDescription?: string
  publishedAt?: string
  unsubscribeUrl?: string
}

const Email = ({
  podcastTitle = '',
  episodeTitle = '',
  episodeUrl = 'https://podiverzum.hu',
  episodeDescription = '',
  publishedAt = '',
  unsubscribeUrl = 'https://podiverzum.hu',
}: Props) => {
  const shortDesc = (episodeDescription || '').replace(/<[^>]+>/g, '').trim().slice(0, 320)
  return (
    <Html lang="hu" dir="ltr">
      <Head />
      <Preview>{`Új epizód: ${episodeTitle}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={brand}>Podiverzum</Text>
          <Heading style={h1}>Új epizód: {podcastTitle}</Heading>
          <Text style={epTitle}>{episodeTitle}</Text>
          {publishedAt && <Text style={muted}>{publishedAt}</Text>}
          {shortDesc && (
            <Section style={card}>
              <Text style={bodyText}>{shortDesc}</Text>
            </Section>
          )}
          <Section style={{ margin: '24px 0' }}>
            <Button href={episodeUrl} style={button}>Meghallgatom</Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            Ezt az emailt azért kaptad, mert feliratkoztál a(z) <strong>{podcastTitle}</strong> új epizódjaira a Podiverzumon.
            {' '}
            <Link href={unsubscribeUrl} style={footerLink}>Leiratkozás egy kattintással</Link>.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const brand = { fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#64748b', margin: '0 0 8px' }
const h1 = { fontSize: '22px', fontWeight: 700, margin: '0 0 4px', color: '#0f172a', lineHeight: '28px' }
const epTitle = { fontSize: '18px', fontWeight: 600, margin: '12px 0 4px', color: '#0f172a', lineHeight: '24px' }
const muted = { fontSize: '12px', color: '#64748b', margin: '0 0 8px' }
const bodyText = { fontSize: '14px', lineHeight: '22px', color: '#1e293b', margin: 0 }
const card = { backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', margin: '16px 0' }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  padding: '12px 20px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderColor: '#e2e8f0', margin: '24px 0 12px' }
const footer = { fontSize: '12px', color: '#64748b', lineHeight: '18px' }
const footerLink = { color: '#0f172a', textDecoration: 'underline' }

export const template = {
  component: Email,
  subject: (d: Props) => `Új epizód: ${d.episodeTitle || d.podcastTitle || 'Podiverzum'}`,
  displayName: 'Új epizód értesítés',
  previewData: {
    podcastTitle: 'Biblia egy év alatt',
    episodeTitle: '186. nap: Ézsaiás elhívása',
    episodeUrl: 'https://podiverzum.hu/podcast/biblia-egy-ev-alatt-podcast-fabry-kornel-puspok-atyaval/186-nap',
    episodeDescription: 'A mai olvasmány Ézsaiás próféta elhívásáról szól...',
    publishedAt: '2026-07-04',
    unsubscribeUrl: 'https://podiverzum.hu/leiratkozas-podcast?token=demo',
  },
} satisfies TemplateEntry
