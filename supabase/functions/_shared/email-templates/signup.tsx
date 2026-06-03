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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="hu" dir="ltr">
    <Head />
    <Preview>Erősítsd meg az email-címed a Podiverzumon</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoWrap}>
          <Img src={logoSrc} width="56" height="56" alt="Podiverzum" style={logo} />
        </Section>
        <Heading style={h1}>Üdv a Podiverzumon!</Heading>
        <Text style={text}>
          Köszi, hogy regisztráltál a{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          -ra — a magyar podcastvilág otthonába.
        </Text>
        <Text style={text}>
          Kérlek, erősítsd meg az email-címed (
          <Link href={`mailto:${recipient}`} style={link}>
            {recipient}
          </Link>
          ) az alábbi gombbal:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Email megerősítése
        </Button>
        <Text style={footer}>
          Ha nem te regisztráltál, ezt az emailt nyugodtan figyelmen kívül hagyhatod.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

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
