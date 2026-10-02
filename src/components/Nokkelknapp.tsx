/* ══════════════════════════════════════════════════════════════════
     NØKKELKNAPPEN — limes inn øverst i <body>, rett etter lukkeren.

     Mobilappen har én felles innlogging lagret kryptert på telefonen.
     Åpner appen denne sida, åpner den også en meldingskanal gjennom
     Chrome. Da, og bare da, kommer en 🔑 under passordfeltet. Trykk, så
     fyller appen inn e-post og passord. Skjemaet sendes ALDRI inn herfra.

     ── MÅ LIGGE INLINE, ØVERST ────────────────────────────────────
     Chrome gir sida porten én gang, i den første meldingen. Lytter vi
     ikke når den kommer, er kanalen tapt for denne sidelastingen. En
     React-komponent starter for sent – derfor rett i HTML-en serveren
     sender. I React-apper: som <script dangerouslySetInnerHTML> i skallet.

     ── SLIK KOMMER KANALEN (målt på Chrome, ikke gjettet) ─────────
     Først en vindusmelding med tom data og porten, med opphavet
     android-app://<vert>/no.haugemaskin.mobil. Så kommer hilsenen fra
     appen – {"type":"hm-hei","nokkel":true} – på porten. Står hilsenen i
     selve vindusmeldingen, slik dokumentasjonen beskriver, virker det også.

     ── HVEM VI HØRER PÅ ───────────────────────────────────────────
     Bare vår egen app, eller vårt eget opphav. Et android-app-opphav kan
     bare lages av Chrome, og bare etter at /.well-known/assetlinks.json på
     dette domenet har godkjent appen (use_as_origin). Et svar fylles bare
     inn når sida selv har spurt, og aldri etter tre sekunder.

     ── UTFYLLINGEN ────────────────────────────────────────────────
     Samme regler som Windows-appen (hauge-maskin-app/src/main.js):
       · uten et synlig passordfelt røres ingenting
       · søke- og filterfelt hoppes over
       · e-postfeltet er tekstfeltet rett før passordfeltet i skjemaet
       · verdien settes slik at React merker den (input + change)
     Og ingen knapp der det står et felt for NYTT passord – registrering
     og passordbytte skal ikke få den felles nøkkelen fylt inn.

     ── TIL «SISTE FORSØK» I APPEN ─────────────────────────────────
     Sida sier fra til appen hva den så, så en feil på en telefon kan
     finnes uten kabel: hm-klar (fikk hilsenen – med opphavet, en grov sti,
     om det fantes et passordfelt da, og hvor lenge etter lasting),
     hm-vist (knappen kom fram) og hm-avvist (en melding Chrome sendte, med
     et opphav vi ikke kjente igjen). Aldri e-post eller passord, og stien
     uten ledd med @, tall eller lange koder. Feil her stopper aldri knappen.

     SIKKERHETSNETT: alt, også hendelsene, ligger i try/catch. Knappen og
     stilen dens lages først når det finnes et passordfelt – sider uten
     innlogging får ingenting lagt inn. Synligheten settes fra skriptet,
     så en streng CSP ikke kan la knappen stå fremme. Knappen ligger
     utenfor rammeverkets rot, så React kan ikke rive den. Uten svar fra
     appen sier knappen fra i stedet for å henge.

     Kanonisk kopi: hauge-maskin-mobil/twa/hm-snutt.html
     ══════════════════════════════════════════════════════════════════
*/

/* Her som komponent: lukkeren er en React-komponent i dette systemet, og
   nøkkelknappen må ligge i HTML-en serveren sender – derfor rendres den i
   skallet, rett etter <Lukkar />, ikke i en komponent som starter etter
   hydrering. String.raw, så skråstrekene i regex-en kommer ut uendret.

   Generert fra twa/hm-snutt.html. Endres der, og lages på nytt herfra. */
const JS = String.raw`
(function () {
  try {
    var TEKST = '🔑 Fyll inn';
    var APPEN = /^android-app:\/\/([^\/]+\/)?no\.haugemaskin\.mobil(\/|$)/;
    var STIL =
      '#hm-nokkel{position:fixed;z-index:2147483646;top:0;left:0;display:none;' +
      'align-items:center;padding:8px 14px;border:0;border-radius:999px;' +
      'background:#e2001a;color:#fff;font:700 14px/1.2 system-ui,-apple-system,' +
      '"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.35);' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '#hm-nokkel.synleg{display:inline-flex}#hm-nokkel:active{background:#b40015}';

    var port = null, harNokkel = false, ferdig = false, vakt = null, planlagt = false;
    var knapp = null, venter = null, tilbake = null, sisteOpphav = '', vistMeldt = false;

    /* Hendelser går utenfor den ytre try-en. Hver av dem får sin egen. */
    function trygt(fn) {
      return function () { try { return fn.apply(this, arguments); } catch (x) { /* aldri sida */ } };
    }

    function les(t) { try { return JSON.parse(t); } catch (x) { return null; } }
    function svarApp(o) { try { if (port) port.postMessage(JSON.stringify(o)); } catch (x) { /* bare til feilsøking */ } }

    /* Til loggen: tre ledd, og et ledd med @, tall eller 16+ tegn blir «…»,
       så e-postadresser og koder i adressen aldri havner der. */
    function grovSti(p) {
      var deler = String(p || '/').split('/'), ut = [];
      for (var i = 1; i < deler.length && i <= 3; i++) {
        var d = deler[i];
        ut.push(!d || (d.length < 16 && !/[@\d]/.test(d)) ? d : '…');
      }
      return '/' + ut.join('/') + (deler.length > 4 ? '/…' : '');
    }

    function meldKlar() {
      try {
        svarApp({ type: 'hm-klar', v: 2, t: Date.now(), lastet: Math.round(performance.now()),
                  opphav: sisteOpphav, sti: grovSti(location.pathname),
                  passordfelt: !!passordfelt(), nyttPassord: !!nyttPassord(), nokkel: harNokkel });
      } catch (x) { /* bare til feilsøking */ }
    }
    function fraAppen(o) { return o === location.origin || APPEN.test(String(o)); }

    function synleg(el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
    }

    function forste(velger) {
      var alle = document.querySelectorAll(velger);
      for (var i = 0; i < alle.length; i++) if (synleg(alle[i])) return alle[i];
      return null;
    }

    function passordfelt() { return forste('input[type="password"]'); }
    function nyttPassord() { return forste('input[autocomplete~="new-password"]'); }

    var SOK = /(search|søk|sok|query|filter|finn)/i;
    function erSokefelt(el) {
      if (el.type === 'search') return true;
      var t = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
               el.getAttribute('autocomplete')].filter(Boolean).join(' ');
      return SOK.test(t);
    }

    function settVerdi(el, verdi) {
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, verdi);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function fyll(epost, passord) {
      var pf = passordfelt();
      if (!pf || nyttPassord()) return 0;
      var omraade = pf.form || document;
      var kandidatar = [].slice.call(omraade.querySelectorAll(
        'input[type="email"], input[type="text"], input[type="tel"], input:not([type])'
      )).filter(function (el) { return synleg(el) && !erSokefelt(el); });
      var alle = [].slice.call(document.querySelectorAll('input'));
      var pos = alle.indexOf(pf);
      var foer = kandidatar.filter(function (el) { return alle.indexOf(el) < pos; });
      var bf = foer.length ? foer[foer.length - 1] : null;
      var n = 0;
      if (typeof epost === 'string' && epost && bf) { settVerdi(bf, epost); n++; }
      if (typeof passord === 'string' && passord) { settVerdi(pf, passord); pf.focus(); n++; }
      return n;
    }

    /* En melding på knappen står en stund, så kommer teksten tilbake. */
    function tekst(t, kort) {
      if (!knapp) return;
      knapp.textContent = t;
      if (tilbake) { clearTimeout(tilbake); tilbake = null; }
      if (kort) tilbake = setTimeout(trygt(function () { tilbake = null; if (knapp) knapp.textContent = TEKST; }), 4000);
    }

    function lagKnapp() {
      if (knapp) return;
      var stil = document.createElement('style');
      stil.id = 'hm-nokkel-stil';
      stil.textContent = STIL;
      (document.head || document.documentElement).appendChild(stil);
      knapp = document.createElement('button');
      knapp.id = 'hm-nokkel';
      knapp.type = 'button';
      knapp.textContent = TEKST;
      // Satt fra skriptet, ikke bare i stilen: en CSP som stopper <style>
      // skal ikke kunne la knappen stå fremme
      knapp.style.position = 'fixed';
      knapp.style.zIndex = '2147483646';
      knapp.style.display = 'none';
      knapp.addEventListener('click', trygt(hent));
      document.body.appendChild(knapp);
    }

    function skjul() {
      if (!knapp) return;
      if (knapp.className) knapp.className = '';
      if (knapp.style.display !== 'none') knapp.style.display = 'none';
    }

    /* Under passordfeltet, høyrejustert, så knappen ikke dekker midten av
       «Logg inn»-knappen som som regel står rett under. Knappen lages
       først her, når det faktisk finnes et passordfelt. */
    function plasser() {
      var pf = port && harNokkel ? passordfelt() : null;
      // Innloggingen er borte – neste gang den kommer, skal knappen med
      if (!pf) { ferdig = false; skjul(); return; }
      if (ferdig || nyttPassord()) { skjul(); return; }
      lagKnapp();
      if (knapp.className !== 'synleg') knapp.className = 'synleg';
      if (knapp.style.display !== 'inline-flex') knapp.style.display = 'inline-flex';
      if (!vistMeldt) { vistMeldt = true; svarApp({ type: 'hm-vist', v: 2, t: Date.now() }); }
      var r = pf.getBoundingClientRect();
      var topp = Math.round(r.bottom + 6) + 'px';
      var venstre = Math.round(Math.max(8, r.right - knapp.offsetWidth)) + 'px';
      if (knapp.style.top !== topp) knapp.style.top = topp;
      if (knapp.style.left !== venstre) knapp.style.left = venstre;
    }

    /* Samler alt som skjer i sida til neste bilde, så en animert
       innloggingsside ikke tvinger fram én måling per endring. */
    function snart() {
      if (planlagt) return;
      planlagt = true;
      var neste = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
      neste(trygt(function () { planlagt = false; plasser(); }));
    }

    /* Følger med på sida, så knappen kommer når innloggingen tegnes og går
       når den forsvinner. Våre egne endringer setter ikke i gang en ny runde. */
    function folgMed() {
      if (vakt) return;
      vakt = new MutationObserver(trygt(function (poster) {
        for (var i = 0; i < poster.length; i++) {
          var mal = poster[i].target;
          if (mal !== knapp && !(knapp && knapp.contains(mal))) { snart(); return; }
        }
      }));
      vakt.observe(document.documentElement, {
        childList: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'type', 'disabled']
      });
      window.addEventListener('scroll', trygt(snart), true);
      window.addEventListener('resize', trygt(snart));
      if (window.visualViewport) window.visualViewport.addEventListener('resize', trygt(snart));
    }

    function hent() {
      if (!port || venter) return;
      tekst('🔑 …');
      port.postMessage(JSON.stringify({ type: 'hm-hent' }));
      venter = setTimeout(trygt(function () {
        venter = null;
        tekst('Åpne sida fra appen på nytt', true);
      }), 3000);
    }

    function hei(m) {
      harNokkel = m.nokkel === true;
      ferdig = false;
      vistMeldt = false;
      meldKlar();
      if (!harNokkel) { plasser(); return; }
      if (document.body) { folgMed(); plasser(); }
      else document.addEventListener('DOMContentLoaded', trygt(function () { folgMed(); plasser(); }));
    }

    function svar(m) {
      if (!venter) return; /* bare svar på noe vi har spurt om */
      clearTimeout(venter);
      venter = null;
      if (m.feil) { tekst(String(m.feil), true); return; }
      if (fyll(m.epost, m.passord)) {
        ferdig = true;
        tekst(TEKST);
        plasser();
      } else {
        tekst('Fant ikke innloggingen', true);
      }
    }

    function motta(e) {
      var m = les(e && e.data);
      if (!m) return;
      if (m.type === 'hm-hei') hei(m);
      else if (m.type === 'hm-nokkel') svar(m);
    }

    window.addEventListener('message', trygt(function (e) {
      if (!e.ports || !e.ports[0]) return;
      if (!fraAppen(e.origin)) {
        // Sendte Chrome den (uten avsendervindu – en ramme i sida har alltid
        // et), sier vi fra hvorfor på porten som fulgte med. Ellers ser ingen
        // i appen at Chrome leverte med et opphav vi ikke kjente igjen.
        if (!e.source) {
          try {
            e.ports[0].postMessage(JSON.stringify({ type: 'hm-avvist', v: 2, t: Date.now(), opphav: String(e.origin).slice(0, 120) }));
          } catch (x) { /* bare til feilsøking */ }
        }
        return;
      }
      port = e.ports[0];
      sisteOpphav = String(e.origin).slice(0, 120);
      port.onmessage = trygt(motta);
      var m = les(e.data);
      if (m && m.type === 'hm-hei') hei(m);
    }));
  } catch (x) { /* nøkkelknappen skal aldri kunne ta ned sida */ }
})();
`;

export function Nokkelknapp() {
  return <script dangerouslySetInnerHTML={{ __html: JS }} />;
}
