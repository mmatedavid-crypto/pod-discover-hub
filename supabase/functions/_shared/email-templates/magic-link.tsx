/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="hu" dir="ltr">
    <Head />
    <Preview>Bejelentkezési link — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoWrap}>
          <Img src={logoSrc} width="56" height="56" alt="Podiverzum" style={logo} />
        </Section>
        <Heading style={h1}>Bejelentkezési link</Heading>
        <Text style={text}>
          Kattints az alábbi gombra a {siteName} bejelentkezéshez. A link rövid időn
          belül lejár.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Bejelentkezés
        </Button>
        <Text style={footer}>
          Ha nem te kérted ezt a linket, hagyd figyelmen kívül ezt az emailt.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const logoSrc = 'https://podiverzum.hu/podiverzum-logo-square.png'
const main = {
  backgroundColor: '#ffffff',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
}
const container = { padding: '32px 28px', maxWidth: '560px' }
const logoWrap = { margin: '0 0 24px' }
const logo = { borderRadius: '10px', display: 'block' }
const h1 = {
  fontSize: '24px',
  fontWeight: 'bold' as const,
  color: '#0f0f0f',
  margin: '0 0 20px',
  letterSpacing: '-0.01em',
}
const text = {
  fontSize: '15px',
  color: '#3d3d3d',
  lineHeight: '1.55',
  margin: '0 0 22px',
}
const button = {
  backgroundColor: '#e51414',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 'bold' as const,
  borderRadius: '10px',
  padding: '13px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = { fontSize: '12px', color: '#9a9a9a', margin: '32px 0 0', lineHeight: '1.5' }
