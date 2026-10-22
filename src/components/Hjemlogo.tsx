/*══════════════════════════════════════════════════════════════════
     HJEM-LOGOEN — limes inn øverst i <body>, rett etter nøkkelknappen.

     Åpnet fra mobilappen tar HM-logoen oppe til venstre deg tilbake til
     lista i appen. I en vanlig nettleser – på PC, som er
     primærplattformen – gjør logoen det den alltid har gjort.

     ── NÅR ────────────────────────────────────────────────────────
     Samme signal som lukkeren: referreren android-app://no.haugemaskin.mobil.
     Den forsvinner ved neste fulle sidelasting (en innloggingsrunde bytter
     den), så et flagg i sessionStorage husker det for resten av fanen.
     Bare en fane appen åpnet kan få flagget. Hilser appen gjennom
     meldingskanalen, gjelder det også – det opphavet kan bare Chrome lage.

     ── HVILKEN LOGO ───────────────────────────────────────────────
     Et element med data-hm-hjem, om systemet har merket logoen sin.
     Ellers et bilde eller en svg oppe til venstre (toppen innen 120 px,
     midten i venstre 40 %, under 120 px høy – en midtstilt logo på
     innloggingen er ikke med) der alt, src, klasse, id,
     aria-label eller tittel – også på lenka rundt – sier logo, hauge
     eller hm. Trykket fanges på window i fangstfasen, før React og
     ruterne ser det.

     ── HVORDAN ────────────────────────────────────────────────────
     intent://hjem#Intent;scheme=no.haugemaskin.mobil;package=no.haugemaskin.mobil;
       S.browser_fallback_url=<dit logoen pekte>;end
     Appen svarer på adressen fra 1.18.0, og systemet over lista lukkes.
     En eldre app svarer ikke, og da sender Chrome deg dit logoen pekte
     før (lenka rundt den, ellers forsiden av systemet).

     SIKKERHETSNETT: alt ligger i try/catch, og uten appen som avsender
     legges ikke engang lytteren på.

     Kanonisk kopi: hauge-maskin-mobil/twa/hm-snutt.html
     ══════════════════════════════════════════════════════════════════
*/

/* Her som komponent, rendret i skallet rett etter <Nokkelknapp />, så
   skriptet ligger i HTML-en serveren sender og lytter fra første stund.
   Det legger ingenting inn i sida, så hydreringen merker ingenting.
   String.raw, så skråstrekene i regex-en kommer ut uendret.

   Generert fra twa/hm-snutt.html. Endres der, og lages på nytt herfra. */
const JS = String.raw`
(function () {
  try {
    var PAKKE = 'no.haugemaskin.mobil';
    var APPEN = /^android-app:\/\/([^\/]+\/)?no\.haugemaskin\.mobil(\/|$)/;
    var NAVN = /logo|hauge|(^|[^a-z])hm([^a-z]|$)/i;
    var aktiv = false;

    function slaaPaa() {
      if (aktiv) return;
      aktiv = true;
      try { sessionStorage.setItem('hm-fra-appen', '1'); } catch (x) { /* gjelder bare denne sida */ }
      window.addEventListener('click', trykk, true);
    }

    function navn(el) {
      if (!el || !el.getAttribute) return '';
      var t = el.querySelector && el.tagName.toLowerCase() === 'svg' ? el.querySelector('title') : null;
      return [el.getAttribute('alt'), el.getAttribute('src'), el.getAttribute('class'), el.id,
              el.getAttribute('aria-label'), el.getAttribute('title'), t && t.textContent]
        .filter(Boolean).join(' ');
    }

    function oppeTilVenstre(el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 120 && r.top < 120 &&
             r.left + r.width / 2 < (window.innerWidth || 360) * 0.4;
    }

    /* Bildet som ble trykket på, eller bildet inni lenka eller knappen. */
    function finnLogo(mal) {
      var merket = mal.closest('[data-hm-hjem]');
      if (merket) return merket;
      var lenke = mal.closest('a, button, [role="link"]');
      var bilder = [];
      var b = mal.closest('img, svg');
      if (b) bilder.push(b);
      if (lenke) bilder = bilder.concat([].slice.call(lenke.querySelectorAll('img, svg')));
      for (var i = 0; i < bilder.length; i++) {
        var bilde = bilder[i];
        if (oppeTilVenstre(bilde) && NAVN.test(navn(bilde) + ' ' + navn(lenke))) return bilde;
      }
      return null;
    }

    function trykk(e) {
      try {
        if (e.defaultPrevented || e.button) return;
        var mal = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if (!mal || !mal.closest || !finnLogo(mal)) return;
        var lenke = mal.closest('a[href]');
        var dit = lenke && /^https?:/.test(lenke.href) ? lenke.href : location.origin + '/';
        e.preventDefault();
        e.stopImmediatePropagation();
        location.href = 'intent://hjem#Intent;scheme=' + PAKKE + ';package=' + PAKKE +
          ';S.browser_fallback_url=' + encodeURIComponent(dit) + ';end';
      } catch (x) { /* da gjør logoen det den alltid har gjort */ }
    }

    var fra = (document.referrer || '').lastIndexOf('android-app://' + PAKKE, 0) === 0;
    try { fra = fra || sessionStorage.getItem('hm-fra-appen') === '1'; } catch (x) { /* bare referreren */ }
    if (fra) slaaPaa();
    else window.addEventListener('message', function (e) {
      try { if (APPEN.test(String(e.origin))) slaaPaa(); } catch (x) { /* aldri sida */ }
    });
  } catch (x) { /* hjem-logoen skal aldri kunne ta ned sida */ }
})();
`

export function Hjemlogo() {
  return <script dangerouslySetInnerHTML={{ __html: JS }} />
}
