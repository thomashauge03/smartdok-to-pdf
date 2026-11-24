/*
 * SQL mot navet («Admin Panel», rxlkybaarxvyrrkkzjhj) gjennom Management API.
 * Kopi av haugemaskinbroyting/db/navet.mjs; smartdok-to-pdf bor i samme prosjekt.
 *
 * Tokenet hentes med Varslingskontrolls db/token.js, som leser det kryptert
 * fra adminbordet. Thomas fornyer tokenene bare der; en egen kopi her ville
 * gått ut uten at noen merket det.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { tokenFor } = require('C:/Users/thoma/varslingskontroll/db/token.js')

export const REF = 'rxlkybaarxvyrrkkzjhj'

/** Fjerner alt som ligner et token fra en feilmelding før den vises. */
export function vask(tekst) {
  return String(tekst).replace(/(Bearer\s+)\S+/gi, '$1***').replace(/sbp_[A-Za-z0-9]+/g, 'sbp_***')
}

export async function sql(sporring, { lesbar = false } = {}) {
  const token = await tokenFor(REF)
  const tekst = lesbar ? `set transaction read only;\n${sporring}` : sporring
  let r
  try {
    r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // UTF-8 eksplisitt, ellers blir æøå i kommentarene ødelagt.
      body: Buffer.from(JSON.stringify({ query: tekst }), 'utf8'),
    })
  } catch (e) {
    throw new Error(vask(e.message))
  }
  const svar = await r.text()
  if (!r.ok) {
    let melding = svar.slice(0, 600)
    try {
      melding = JSON.parse(svar).message || melding
    } catch {
      /* rå tekst */
    }
    throw new Error(vask(`HTTP ${r.status}: ${melding}`))
  }
  return JSON.parse(svar)
}
