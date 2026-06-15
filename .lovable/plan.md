# Plan: SmartDok Excel → pyntet PDF

## Funksjonalitet
Én enkel side (`/`) hvor brukeren:
1. Drar inn / velger `.xls` eller `.xlsx` fra SmartDok (format som `Fakturerbare timer (6).xls`)
2. Ser en forhåndsvisning av tabellen + auto-utfylte felter for **Prosjekt** og **Vedlegg** (kan redigeres)
3. Klikker «Last ned PDF» og får en PDF identisk i oppsett med `2026117 TT Anlegg - Herdalen 2012605 - Mai 2026.pdf`

Alt skjer i nettleseren — ingen backend, ingen lagring.

## PDF-layout (matcher referansen)
- Liggende A4
- Øverst venstre: `Prosjekt : …` og `Vedlegg : …` (fet)
- Øverst høyre: HM-logo
- Tabell under med kolonner: **Tid | Navn | Kommentar | Dato | Timer | AER timer | Maskinnavn1 | Timer**
- Sum-rad nederst med totale timer

## Kolonnemapping fra Excel
| PDF-kolonne | Excel-kilde |
|---|---|
| Tid | `Tid` |
| Navn | `Navn` |
| Kommentar | `Kommentar` (bytter `<br/>` til linjeskift) |
| Dato | `Dato` (Excel serial → `DD.MM.YYYY`) |
| Timer | `Timer` |
| AER timer | `Lønnsart` mappet (`Timelønn` → `Regning (1)`) |
| Maskinnavn1 | `Maskinnavn1` |
| Timer (siste) | `Maskin1 Timer` |

Auto-utfylling:
- **Prosjekt**: hentes fra `Pro.navn` (første rad), omformatert til `2026117 Herdalen 2012605`
- **Vedlegg**: måned + år utledet fra datoene (f.eks. `Mai 2026`)

Begge feltene kan redigeres før PDF lastes ned.

## Teknisk
- **Lese Excel**: `xlsx` (SheetJS) — støtter både `.xls` og `.xlsx` i nettleseren
- **Generere PDF**: `jspdf` + `jspdf-autotable` (klient-side, ingen serverkall)
- **Logo**: `hmLogo.png` lagres som Lovable Asset og embeddes i PDF
- Norske måneder hardkodes (`Januar`…`Desember`)

## Filer
- `src/routes/index.tsx` — siden (drop-zone, preview, prosjekt/vedlegg-inputs, last-ned-knapp)
- `src/lib/smartdok-parser.ts` — parse Excel → rad-array + auto-felter
- `src/lib/smartdok-pdf.ts` — bygg PDF
- `src/assets/hmLogo.png.asset.json` — logo-pointer
- Pakker: `xlsx`, `jspdf`, `jspdf-autotable`

## Design
Ren, lys flate i HM sine farger (rød aksent #E30613, svart, hvit). Stor drop-zone øverst, redigerbare prosjekt-/vedlegg-felter, kompakt forhåndsvisning under, primær rød «Last ned PDF»-knapp.
