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
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="hu" dir="ltr">
    <Head />
    <Preview>Meghívót kaptál a {siteName}-ra</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoWrap}>
          <Img src={logoSrc} width="56" height="56" alt="Podiverzum" style={logo} />
        </Section>
        <Heading style={h1}>Meghívót kaptál</Heading>
        <Text style={text}>
          Meghívást kaptál a{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          -ra. Kattints az alábbi gombra a meghívás elfogadásához és a fiókod
          létrehozásához.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Meghívás elfogadása
        </Button>
        <Text style={footer}>
          Ha nem számítottál erre a meghívóra, nyugodtan hagyd figyelmen kívül.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

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
const link = { color: '#e51414', textDecoration: 'underline' }
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
