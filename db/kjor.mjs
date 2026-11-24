/*
 * Kjører supabase/migrations/*.sql mot navet i filrekkefølge.
 *
 *   node db/kjor.mjs
 *
 * Skriver bare filnavn og ok/feil. Hver fil går som én transaksjon, så en
 * feil midt i lar basen stå som før. Stopper ved første feil: senere
 * migrasjoner kan bygge på de tidligere.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql, vask } from './navet.mjs'

const mappe = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const filer = fs.readdirSync(mappe).filter((f) => f.endsWith('.sql')).sort()

for (const navn of filer) {
  process.stdout.write(`${navn} ... `)
  try {
    const innhold = fs.readFileSync(path.join(mappe, navn), 'utf8')
    // Filene må ikke ha egen begin/commit: kjøreren pakker hver fil i én transaksjon.
    await sql(`begin;\n${innhold}\ncommit;`)
    console.log('ok')
  } catch (e) {
    console.log('FEIL')
    console.error(vask(e.message))
    process.exit(1)
  }
}
