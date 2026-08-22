(function () {
  'use strict'

  var DATA = JSON.parse(document.getElementById('flight-data').textContent)
  var LAND = JSON.parse(document.getElementById('land-data').textContent)
  var BORDERS = JSON.parse(document.getElementById('border-data').textContent)
  var PHOTOS = JSON.parse(document.getElementById('photo-data').textContent)
  var SVG_NS = 'http://www.w3.org/2000/svg'

  // --- formátovanie -------------------------------------------------------
  var MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'máj', 'jún', 'júl', 'aug', 'sep', 'okt', 'nov', 'dec']
  var MONTH_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna', 'júla',
    'augusta', 'septembra', 'októbra', 'novembra', 'decembra']

  function pad(n) { return n < 10 ? '0' + n : String(n) }
  function isoDate(s) { return s.slice(0, 10) }
  function nf(n, digits) {
    return Number(n).toLocaleString('sk-SK', digits != null
      ? { minimumFractionDigits: digits, maximumFractionDigits: digits }
      : undefined)
  }
  function dayLabel(s) {
    var d = new Date(s)
    return d.getUTCDate() + '. ' + MONTH_SHORT[d.getUTCMonth()]
  }
  function longDate(s) {
    var d = new Date(s)
    return d.getUTCDate() + '. ' + MONTH_GEN[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
  }
  function hhmm(s) {
    var d = new Date(s)
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())
  }
  function duration(sec) {
    if (sec == null) return '—'
    return pad(Math.floor(sec / 3600)) + ':' + pad(Math.round((sec % 3600) / 60))
  }
  /** Výpadky trvajú od sekúnd po hodiny, a „00:00“ pri 20 sekundách sa číta ako žiadny výpadok. */
  function gapLength(sec) {
    if (sec == null) return '—'
    if (sec < 90) return Math.round(sec) + ' s'
    if (sec < 5400) return Math.round(sec / 60) + ' min'
    return Math.floor(sec / 3600) + ' h ' + Math.round((sec % 3600) / 60) + ' min'
  }
  function km(n) { return n == null ? '—' : nf(Math.round(n)) }
  function pct(x) { return x == null ? '—' : Math.round(x * 100) + '\u00a0%' }
  function grade(x) { return x >= 0.75 ? 'q-high' : x >= 0.5 ? 'q-med' : 'q-low' }

  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  /** Prijaté letisko, inak pravdepodobné, inak nič — nikdy odhad vydávaný za istotu. */
  function endpoint(f, side) {
    var p = side === 'dep'
      ? { code: f.depIata || f.depIdent, city: f.depCity, name: f.depName, ident: f.depIdent }
      : { code: f.arrIata || f.arrIdent, city: f.arrCity, name: f.arrName, ident: f.arrIdent }
    if (p.ident) return { code: p.code, city: p.city, name: p.name, state: 'known' }
    var q = side === 'dep'
      ? { code: f.depPIata || f.depPIdent, city: f.depPCity, name: f.depPName, ident: f.depPIdent }
      : { code: f.arrPIata || f.arrPIdent, city: f.arrPCity, name: f.arrPName, ident: f.arrPIdent }
    if (q.ident) return { code: q.code, city: q.city, name: q.name, state: 'probable' }
    return { code: 'NEZN', city: null, name: 'Neurčené', state: 'unknown' }
  }

  // --- hlavné čísla -------------------------------------------------------
  var flights = DATA.flights
  var totalSeconds = flights.reduce(function (s, f) { return s + (f.durationSeconds || 0) }, 0)
  var totalKm = flights.reduce(function (s, f) { return s + (f.distanceKm || 0) }, 0)
  var gapKm = flights.reduce(function (s, f) { return s + (f.distanceFromGapsKm || 0) }, 0)
  var totalFixes = flights.reduce(function (s, f) { return s + f.positionCount }, 0)

  document.getElementById('delay-hours').textContent = DATA.publicationDelayHours

  // --- náklady -----------------------------------------------------------
  var CONF_SK = { high: 'vysoká', medium: 'stredná', low: 'nízka' }
  var MISSING_SK = {
    insurance: 'poistenie',
    crew_fixed: 'mzdové náklady posádok a personálu',
    training: 'výcvik',
    facility: 'hangárovanie a technická základňa',
    software: 'software a navigačné databázy',
    capital: 'kapitálové náklady a odpisy',
    administration: 'administratíva',
    maintenance_hour: 'údržba',
    navigation: 'navigačné poplatky',
    airport: 'letiskové poplatky',
    handling: 'handling',
    allocated_fixed: 'alokované fixné náklady',
  }

  function eur(v) { return v == null ? '—' : Math.round(v).toLocaleString('sk-SK') + '\u00a0€' }
  function eurRange(low, mid, high) {
    if (mid == null) return 'dáta nedostupné'
    if (low == null || high == null || Math.round(low) === Math.round(high)) return eur(mid)
    return eur(low) + ' – ' + eur(high)
  }

  var costed = flights.filter(function (f) { return f.costFullMid != null })
  var totalDirect = costed.reduce(function (s, f) { return s + (f.costDirectMid || 0) }, 0)
  var totalFixed = costed.reduce(function (s, f) { return s + (f.costFixedMid || 0) }, 0)
  var totalFull = costed.reduce(function (s, f) { return s + (f.costFullMid || 0) }, 0)
  var totalFullLow = costed.reduce(function (s, f) { return s + (f.costFullLow || 0) }, 0)
  var totalFullHigh = costed.reduce(function (s, f) { return s + (f.costFullHigh || 0) }, 0)


  var days = DATA.days.slice().sort(function (a, b) { return a.day < b.day ? -1 : 1 })
  var firstDay = days.length ? days[0].day : isoDate(flights[0].departureTime)
  var lastDay = days.length ? days[days.length - 1].day : isoDate(flights[flights.length - 1].departureTime)

  document.getElementById('window-sub').textContent =
    'Všetky štátne lietadlá z registra, ' + longDate(firstDay) + ' až ' + longDate(lastDay) +
    '. Čísla pokrývajú výhradne dni, ktoré archív dokázal poskytnúť.'

  var kpiDefs = [
    { v: nf(flights.length), unit: '', label: 'Detegované lety', note: 'zrekonštruované z ' + nf(totalFixes) + ' pozorovaní' },
    { v: nf(totalSeconds / 3600, 1), unit: 'h', label: 'Čas vo vzduchu', note: 'Od vzletu po dosadnutie, nie blokový čas' },
    { v: km(totalKm), unit: 'km', label: 'Preletená vzdialenosť', note: km(gapKm) + ' km z toho premostených cez výpadky pokrytia' },
    costed.length
      ? {
          v: eur(totalFull).replace('\u00a0€', ''),
          unit: '€',
          label: 'Odhadované celkové náklady',
          note: 'Interval ' + eur(totalFullLow) + ' – ' + eur(totalFullHigh) + ' · kvalita odhadu nízka',
        }
      : { unavailable: 'Dáta nedostupné', label: 'Odhadované náklady', note: 'Nemáme zdrojovany udaj' },
  ]
  var kpis = document.getElementById('kpis')
  kpiDefs.forEach(function (d) {
    var box = el('div', 'kpi')
    box.appendChild(el('p', 'eyebrow', d.label))
    if (d.unavailable) {
      box.appendChild(el('div', 'v unavailable', d.unavailable))
    } else {
      var v = el('div', 'v')
      v.appendChild(document.createTextNode(d.v))
      if (d.unit) v.appendChild(el('small', null, d.unit))
      box.appendChild(v)
    }
    box.appendChild(el('div', 'note', d.note))
    kpis.appendChild(box)
  })

  // --- mapa ---------------------------------------------------------------
  /**
   * Jedna mapa pre jeden let aj pre celú flotilu.
   *
   * Bez dlaždíc: pevná pevnina, hranice štátov ako geografická referencia a trasa,
   * ktorá plnou čiarou hovorí „toto sme videli“ a prerušovanou „toto sme dopočítali“.
   */
  function buildMap(list, opts) {
    opts = opts || {}
    var tracks = list.map(function (f) { return f.track || [] }).filter(function (t) { return t.length > 1 })
    if (!tracks.length) return null

    var minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
    tracks.forEach(function (t) {
      t.forEach(function (p) {
        if (p[0] < minLon) minLon = p[0]
        if (p[0] > maxLon) maxLon = p[0]
        if (p[1] < minLat) minLat = p[1]
        if (p[1] > maxLat) maxLat = p[1]
      })
    })

    var padLon = Math.max((maxLon - minLon) * 0.14, 1.6)
    var padLat = Math.max((maxLat - minLat) * 0.22, 1.6)
    minLon -= padLon; maxLon += padLon; minLat -= padLat; maxLat += padLat

    // Ekvidištantná valcová projekcia, os x stlačená kosínusom strednej šírky.
    var k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
    var w = (maxLon - minLon) * k
    var h = maxLat - minLat
    var W = 720
    var H = Math.max(opts.minHeight || 220, Math.min(opts.maxHeight || 460, Math.round(W * h / w)))
    var s = Math.min(W / w, H / h)
    var ox = (W - w * s) / 2, oy = (H - h * s) / 2

    function px(lon, lat) { return [ox + (lon - minLon) * k * s, oy + (maxLat - lat) * s] }

    var svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
    svg.setAttribute('role', 'img')

    function shape(points, close, fillVar, strokeVar, width) {
      var d = points.map(function (pt, i) {
        var q = px(pt[0], pt[1])
        return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)
      }).join('') + (close ? 'Z' : '')
      var path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', d)
      if (fillVar) path.style.setProperty('fill', fillVar); else path.setAttribute('fill', 'none')
      path.style.setProperty('stroke', strokeVar)
      path.setAttribute('stroke-width', String(width))
      return path
    }

    function inView(points, margin) {
      for (var i = 0; i < points.length; i++) {
        if (points[i][0] > minLon - margin && points[i][0] < maxLon + margin &&
            points[i][1] > minLat - margin && points[i][1] < maxLat + margin) return true
      }
      return false
    }

    var landGroup = document.createElementNS(SVG_NS, 'g')
    LAND.forEach(function (ring) {
      if (inView(ring, 20)) landGroup.appendChild(shape(ring, true, 'var(--land)', 'var(--land-edge)', 0.7))
    })
    svg.appendChild(landGroup)

    var borderGroup = document.createElementNS(SVG_NS, 'g')
    BORDERS.forEach(function (line) {
      if (inView(line, 6)) borderGroup.appendChild(shape(line, false, null, 'var(--border-line)', 0.8))
    })
    svg.appendChild(borderGroup)

    var solidWidth = opts.solidWidth || 2.4
    var dashWidth = opts.dashWidth || 1.6

    list.forEach(function (f) {
      var track = f.track || []
      if (track.length < 2) return
      var gaps = (f.gaps || []).map(function (g) {
        return [Date.parse(g.from) / 1000, Date.parse(g.to) / 1000]
      })
      function bridged(t1, t2) {
        for (var i = 0; i < gaps.length; i++) if (gaps[i][0] < t2 && gaps[i][1] > t1) return true
        return false
      }
      for (var i = 1; i < track.length; i++) {
        var a = track[i - 1], b = track[i]
        var p1 = px(a[0], a[1]), p2 = px(b[0], b[1])
        var line = document.createElementNS(SVG_NS, 'line')
        line.setAttribute('x1', p1[0].toFixed(1)); line.setAttribute('y1', p1[1].toFixed(1))
        line.setAttribute('x2', p2[0].toFixed(1)); line.setAttribute('y2', p2[1].toFixed(1))
        line.style.setProperty('stroke', 'var(--accent)')
        line.setAttribute('stroke-linecap', 'round')
        if (bridged(a[3], b[3])) {
          line.setAttribute('stroke-width', String(dashWidth))
          line.setAttribute('stroke-dasharray', '3 5')
          line.setAttribute('opacity', String(opts.dashOpacity || 0.62))
        } else {
          line.setAttribute('stroke-width', String(solidWidth))
          if (opts.solidOpacity) line.setAttribute('opacity', String(opts.solidOpacity))
        }
        svg.appendChild(line)
      }
    })

    // Koncové body. Duté kolieska sú miesta, kde sme lietadlo na zemi nikdy nevideli.
    var marks = []
    list.forEach(function (f) {
      var track = f.track || []
      if (track.length < 2) return
      marks.push({ pt: track[0], port: endpoint(f, 'dep') })
      marks.push({ pt: track[track.length - 1], port: endpoint(f, 'arr') })
    })

    var seen = {}
    var placed = []
    marks.forEach(function (m) {
      var q = px(m.pt[0], m.pt[1])
      var known = m.port.state === 'known'
      var dedupKey = known ? m.port.code : 'x:' + q[0].toFixed(0) + ',' + q[1].toFixed(0)
      if (seen[dedupKey]) return
      seen[dedupKey] = true

      var c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('cx', q[0].toFixed(1)); c.setAttribute('cy', q[1].toFixed(1))
      c.setAttribute('r', '4.5')
      c.style.setProperty('fill', known ? 'var(--accent)' : 'var(--surface)')
      c.style.setProperty('stroke', known ? 'var(--surface)' : 'var(--accent)')
      c.setAttribute('stroke-width', '2')
      if (!known) c.setAttribute('stroke-dasharray', '2.5 2')
      svg.appendChild(c)

      // Na prehľadovej mape by šesť popiskov „NEZN“ len zaclonilo trasy; duté koliesko
      // a legenda povedia to isté.
      if (!known && opts.labelUnknown === false) return
      var text = m.port.code + (known ? '' : ' ?')
      var boxW = text.length * 7.4 + 10
      // Greedy vyhýbanie sa prekryvom: skús vpravo, potom nad a pod, inak popisok vynechaj.
      var offsets = [[9, 4], [9, -9], [9, 16], [-boxW - 4, 4], [9, -21], [9, 28]]
      var spot = null
      for (var o = 0; o < offsets.length; o++) {
        var bx = q[0] + offsets[o][0], by = q[1] + offsets[o][1] - 10
        var hit = false
        for (var pI = 0; pI < placed.length; pI++) {
          var r = placed[pI]
          if (bx < r[0] + r[2] && bx + boxW > r[0] && by < r[1] + 14 && by + 14 > r[1]) { hit = true; break }
        }
        if (!hit) { spot = [bx, by, boxW]; break }
      }
      if (!spot) return
      placed.push(spot)

      var label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('x', spot[0].toFixed(1))
      label.setAttribute('y', (spot[1] + 14).toFixed(1))
      label.style.setProperty('font-family', 'var(--data)')
      label.setAttribute('font-size', '12')
      label.setAttribute('font-weight', '600')
      label.style.setProperty('fill', 'var(--ink)')
      label.setAttribute('paint-order', 'stroke')
      label.style.setProperty('stroke', 'var(--surface)')
      label.setAttribute('stroke-width', '3.5')
      label.setAttribute('stroke-linejoin', 'round')
      label.textContent = text
      svg.appendChild(label)
    })

    svg.setAttribute('aria-label', opts.aria || 'Zrekonštruovaná trasa letu')
    return svg
  }

  function mapKey(extra) {
    var key = el('div', 'map-key')
    key.innerHTML =
      '<span><svg viewBox="0 0 26 8"><line class="k-solid" x1="1" y1="4" x2="25" y2="4"/></svg> pozorované</span>' +
      '<span><svg viewBox="0 0 26 8"><line class="k-dashed" x1="1" y1="4" x2="25" y2="4"/></svg> premostené cez výpadok</span>' +
      (extra ? '<span>' + extra + '</span>' : '')
    return key
  }

  // --- prehľadová mapa ----------------------------------------------------
  var overview = document.getElementById('overview')
  var overviewSvg = buildMap(flights, {
    minHeight: 300,
    maxHeight: 420,
    solidWidth: 1.9,
    solidOpacity: 0.85,
    dashWidth: 1.2,
    dashOpacity: 0.45,
    labelUnknown: false,
    aria: 'Mapa všetkých ' + flights.length + ' zrekonštruovaných trás slovenskej štátnej flotily',
  })
  if (overviewSvg) {
    overview.appendChild(overviewSvg)
    overview.appendChild(mapKey(nf(flights.length) + ' letov · duté koliesko = letisko, ktoré sme neurčili'))
  }

  // --- náklady: karty a zdroj ---------------------------------------------
  var fleetCost = document.getElementById('fleet-cost')
  if (costed.length) {
    ;[
      {
        label: 'Odhadované priame prevádzkové náklady',
        value: eur(totalDirect),
        note: 'Palivo, poplatky, handling a údržba viazaná na prevádzku. To, čo by odpadlo, keby sa lety neuskutočnili.',
      },
      {
        label: 'Odhadované alokované fixné náklady',
        value: eur(totalFixed),
        note: 'Podiel na udržiavaní kapacity. Vzniká aj vtedy, keď lietadlá stoja.',
      },
      {
        label: 'Odhadované celkové náklady daňovníka',
        value: eurRange(totalFullLow, totalFull, totalFullHigh),
        note: 'Súčet oboch vrstiev za ' + nf(costed.length) + ' detegovaných letov v tomto období.',
      },
      {
        label: 'Porovnateľná komerčná alternatíva',
        value: null,
        note: 'Nemáme zdrojovanú porovnateľnú tarifu, takže porovnanie nezobrazujeme. Rozhranie je pripravené, čísla chýbajú.',
      },
    ].forEach(function (d) {
      var card = el('div', 'fc')
      card.appendChild(el('p', 'eyebrow', d.label))
      if (d.value) card.appendChild(el('div', 'v', d.value))
      else card.appendChild(el('div', 'r', 'dáta nedostupné'))
      card.appendChild(el('div', 'note', d.note))
      fleetCost.appendChild(card)
    })

    var first = costed[0]
    var meta = document.getElementById('cost-source')
    var modelSource = (DATA.sources || []).filter(function (s) { return s.sourceTier === 'A4' })[0]
    meta.innerHTML =
      '<span>Cost model <b>' + first.costModelVersion + '</b> · engine ' + first.costEngineVersion +
      ' · cenová úroveň vstupov ' + (first.costPriceYear || '?') +
      (first.costPriceYearGap ? ', lety o ' + first.costPriceYearGap + ' rokov neskôr' : '') + '</span>' +
      '<span>Kvalita odhadu všetkých výpočtov: <b>' + (CONF_SK[first.costConfidence] || first.costConfidence).toUpperCase() + '</b></span>' +
      (modelSource
        ? '<span>Zdroj sadzby (' + modelSource.sourceTier + '): ' + modelSource.publisher + ' — ' +
          '<a href="' + modelSource.url + '" target="_blank" rel="noopener noreferrer">' + modelSource.title + '</a></span>'
        : '')
  }

  // --- metodika: reťazec od dokumentu po číslo ------------------------------
  // Všetko sa vykresľuje zo skutočných riadkov databázy, takže sa text nemôže rozísť
  // s tým, čo engine naozaj počíta.
  var model = (DATA.costModels || []).filter(function (m) { return m.validTo === null })[0] ||
    (DATA.costModels || [])[0]
  var a4 = (DATA.sources || []).filter(function (s) { return s.sourceTier === 'A4' })[0]
  var fixedOrg = (DATA.fixedCosts || []).filter(function (f) { return f.scope === 'organization' })[0]
  var fixedFleet = (DATA.fixedCosts || []).filter(function (f) { return f.scope === 'fleet' })[0]
  var utilOfficial = (DATA.utilisation || []).filter(function (u) { return u.method === 'official' })[0]
  var utilMinimum = (DATA.utilisation || []).filter(function (u) {
    return u.method === 'planning_minimum' && u.scopeKey === 'lu-mvsr-fixedwing'
  })[0]
  var example = costed.filter(function (f) { return !f.costBlockEstimated })[0] || costed[0]

  var methodSource = document.getElementById('method-source')
  if (methodSource && a4) {
    var head = el('div', 'msrc-head')
    head.appendChild(el('h3', null, a4.title))
    var link = document.createElement('a')
    link.href = a4.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = a4.url
    head.appendChild(link)
    methodSource.appendChild(head)

    var quotes = el('div', 'quotes')
    // Krátke citáty s číslami — presne tie vety, ktoré sa dajú v PDF nájsť a porovnať.
    ;[
      ['4 079 €', 'na hodinu letu na letúnoch (priemer oboch typov lietadiel F100 a A319)', 'za roky 2018 a 2019'],
      ['3 802 €', 'na hodinu letu na letúnoch (vrátane poplatkov)', 'dlhodobý priemer po započítaní roka 2020'],
      ['2 359,55 € – 5 300,75 €', 'rozptyl hodinovej ceny priamych prevádzkových nákladov letúnov', 'na najvyužívanejších letiskách'],
      ['1 400', 'letových hodín na letúnoch', 'vykonaných v roku 2019'],
      ['9 885 780 €', 'priemerný dlhodobý rozpočet bez mzdových nákladov', 'pri minimálnom nálete 600 h letúny + 600 h vrtuľníky'],
    ].forEach(function (q) {
      var box = el('div', 'quote')
      box.innerHTML = '<b>' + q[0] + '</b> — ' + q[1] + ' <em style="font-style:normal;color:var(--ink-3)">(' + q[2] + ')</em>'
      quotes.appendChild(box)
    })
    methodSource.appendChild(quotes)

    var check = el('div', 'msrc-check')
    check.innerHTML =
      'Kontrola, že sme dokument čítali správne: jeho vlastná plánovacia tabuľka uvádza pre ' +
      'MZVEZ SR 202 letových hodín a 768 004 €. <b>768 004 ÷ 202 = 3 802,0</b> — presne tá ' +
      'sadzba, ktorú používame. To isté sedí na každom ďalšom riadku tabuľky.'
    methodSource.appendChild(check)
  }

  var chain = document.getElementById('method-chain')
  if (chain && model && example) {
    var directMid = model.blendedDirectRateMid
    var orgFixed = fixedOrg ? fixedOrg.valueMid : null
    var fleetFixed = fixedFleet ? fixedFleet.valueMid : null
    var hoursOfficial = utilOfficial ? utilOfficial.flightHours : null
    var hoursMinimum = utilMinimum ? utilMinimum.flightHours : null
    var perHourOfficial = fleetFixed && hoursOfficial ? fleetFixed / hoursOfficial : null
    var perHourMinimum = fleetFixed && hoursMinimum ? fleetFixed / hoursMinimum : null
    var exBlock = example.costBlockHours || 0
    var exAirborne = (example.durationSeconds || 0) / 3600

    var w = function (v) { return nf(Math.round(v)) }

    function step(title, badge, math, note) {
      var li = document.createElement('li')
      var t = el('div', 'ctitle')
      t.appendChild(document.createTextNode(title))
      t.appendChild(el('span', 'badge ' + badge, badge === 'sourced' ? 'zdroj' : 'odvodené'))
      li.appendChild(t)
      var m = el('div', 'cmath')
      m.innerHTML = math
      li.appendChild(m)
      if (note) li.appendChild(el('div', 'cnote', note))
      chain.appendChild(li)
    }

    step(
      'Sadzba priamych nákladov',
      'sourced',
      '<span class="eq">' + nf(directMid) + ' €</span> na hodinu letu',
      'Prevzatá z dokumentu bez úpravy. Interval ' + nf(model.blendedDirectRateLow) + ' – ' +
        nf(model.blendedDirectRateHigh) + ' € je rozptyl, ktorý uvádza ten istý materiál.',
    )

    step(
      'Block time konkrétneho letu',
      'derived',
      'let ' + example.publicId + ': ' + exAirborne.toFixed(2) + ' h vo vzduchu → ' +
        '<span class="eq">' + exBlock.toFixed(2) + ' h</span> block',
      'Meraný z pozemného pohybu v ADS-B dátach — od prvej pozície s rýchlosťou nad 3 uzly ' +
        'pred vzletom po poslednú po pristátí. Kde pozemné pozície chýbajú, použije sa čas vo ' +
        'vzduchu plus prirážka na rolovanie a let je označený ako odhad.',
    )

    step(
      'Priame náklady letu',
      'derived',
      exBlock.toFixed(2) + ' h × ' + nf(directMid) + ' €/h = <span class="eq">' +
        w(exBlock * directMid) + ' €</span>',
      'Jediné násobenie. Sadzba už obsahuje palivo, poplatky, handling aj údržbu viazanú na ' +
        'prevádzku — preto ich nepripočítavame druhýkrát.',
    )

    if (orgFixed && fleetFixed && perHourOfficial) {
      step(
        'Fixné náklady útvaru za rok',
        'derived',
        '9 885 780 € rozpočet − (600 h × 3 802 € + 600 h × 812 €) = 9 885 780 − 2 768 400 = ' +
          '<span class="eq">' + w(orgFixed) + ' €</span>',
        'Rozpočtové číslo je z dokumentu. Odpočítanie priamych nákladov pri minimálnom nálete ' +
          'je naša aritmetika: rozpočet obsahuje obe zložky, nás zaujíma tá, ktorá vzniká aj keď ' +
          'lietadlá stoja. Sadzba 812 €/h pre vrtuľníky je z toho istého materiálu.',
      )

      step(
        'Podiel pripadajúci na letúny',
        'derived',
        w(orgFixed) + ' € × (600 ÷ 1 200) = <span class="eq">' + w(fleetFixed) + ' €</span>',
        'Rozpočet kryje letúny aj vrtuľníky. Delíme ho podľa plánovaných hodín, teda na polovicu. ' +
          'Iná metóda alokácie — napríklad podľa hodnoty lietadiel — by dala iné číslo. Toto je ' +
          'najspochybniteľnejší krok celého reťazca.',
      )

      step(
        'Fixné náklady na letovú hodinu',
        'derived',
        w(fleetFixed) + ' € ÷ ' + nf(hoursOfficial) + ' h = <span class="eq">' +
          w(perHourOfficial) + ' €/h</span>' +
          (perHourMinimum
            ? '&nbsp;&nbsp;·&nbsp;&nbsp;pri ' + nf(hoursMinimum) + ' h = ' + w(perHourMinimum) + ' €/h'
            : ''),
        'Menovateľ rozhoduje o výsledku viac než čokoľvek iné. Máme dva oficiálne údaje — ' +
          nf(hoursOfficial) + ' skutočne nalietaných hodín za rok 2019 a ' + nf(hoursMinimum) +
          ' hodín ako minimum na udržanie spôsobilosti. Rozdiel je ' +
          (perHourMinimum / perHourOfficial).toFixed(1) + '-násobok, a preto z neho robíme interval, nie poznámku pod čiarou.',
      )

      step(
        'Fixné náklady konkrétneho letu',
        'derived',
        exAirborne.toFixed(2) + ' h × ' + w(perHourOfficial) + ' €/h = <span class="eq">' +
          w(exAirborne * perHourOfficial) + ' €</span>',
        'Alokujeme podľa času vo vzduchu, nie block time — fixné náklady sa viažu na využitie ' +
          'lietadla, ktoré je vykázané v letových hodinách.',
      )
    }

    step(
      'Celkové náklady daňovníka',
      'derived',
      w(example.costDirectMid) + ' € + ' + w(example.costFixedMid) + ' € = <span class="eq">' +
        w(example.costFullMid) + ' €</span>',
      'Zaokrúhľujeme položky pred sčítaním, aby zobrazené čísla naozaj dali zobrazený súčet.',
    )
  }

  var tiers = document.getElementById('tiers')
  if (tiers) {
    ;[
      ['A1', 'skutočná faktúra / zaplatená suma', false],
      ['A2', 'oficiálne údaje o výdavkoch', false],
      ['A3', 'zmluva v CRZ / ÚVO', false],
      ['A4', 'oficiálny materiál štátneho orgánu', true],
      ['A5', 'sadzobník letiska / EUROCONTROL', false],
      ['B1', 'údaje výrobcu', false],
      ['B2', 'certifikovaný prevádzkovateľ', false],
      ['C', 'priemyselný benchmark', false],
      ['D', 'analytický odhad', false],
    ].forEach(function (t) {
      var tr = document.createElement('tr')
      if (t[2]) tr.className = 'here'
      tr.appendChild(el('td', null, t[0]))
      tr.appendChild(el('td', null, t[1]))
      tr.appendChild(el('td', null, t[2] ? '← naše vstupy' : ''))
      tiers.appendChild(tr)
    })
  }

  var methodMissing = document.getElementById('method-missing')
  if (methodMissing && example) {
    var list = (example.costMissing || []).map(function (m) { return MISSING_SK[m] || m })
    methodMissing.innerHTML = list.length
      ? 'Odhad nezahŕňa: <b>' + list.join(', ') + '</b>.'
      : 'Odhad zahŕňa všetky modelované kategórie.'
  }

  var methodPriceYear = document.getElementById('method-priceyear')
  if (methodPriceYear && example) {
    methodPriceYear.innerHTML =
      'Vstupy sú v cenách roku <b>' + (example.costPriceYear || '?') + '</b>, lety sú z roku ' +
      new Date(example.departureTime).getUTCFullYear() + '. Odstup ' +
      (example.costPriceYearGap || 0) + ' rokov <b>neupravujeme o infláciu</b> — nemáme na to ' +
      'zdrojovaný index. Reálne náklady sú preto pravdepodobne vyššie než uvedené. Preto je ' +
      'kvalita každého odhadu na tejto stránke nízka.'
  }

  var verifyList = document.getElementById('verify-list')
  if (verifyList && a4 && model && example) {
    ;[
      '<b>Otvorte dokument.</b> Sadzby ' + nf(Math.round(model.blendedDirectRateMid)) + ' €/h, rozptyl ' +
        nf(model.blendedDirectRateLow) + ' – ' + nf(model.blendedDirectRateHigh) +
        ' €/h aj rozpočet 9 885 780 € sú v kapitolách 2 a 4.1. ' +
        '<a href="' + a4.url + '" target="_blank" rel="noopener noreferrer">rokovania.gov.sk</a>',
      '<b>Prepočítajte jeden let.</b> Vezmite block time z detailu ktoréhokoľvek letu vyššie a ' +
        'vynásobte ho sadzbou. Musí vyjsť zobrazené číslo priamych nákladov.',
      '<b>Spochybnite alokáciu.</b> Delenie rozpočtu na polovicu medzi letúny a vrtuľníky je ' +
        'naše rozhodnutie, nie údaj z dokumentu. Ak podľa vás patrí letúnom iný podiel, ' +
        'prepočítajte krok 5 a uvidíte, ako veľmi to hýbe výsledkom.',
      '<b>Pozrite si kód.</b> Každé číslo má v databáze uložený vzorec, vstupy a zdroj. ' +
        'Z príkazového riadka: <code>npm run costs:explain -- --flight ' + example.publicId + '</code>',
    ].forEach(function (item) {
      var li = document.createElement('li')
      li.innerHTML = item
      verifyList.appendChild(li)
    })
  }

  // --- misie ---------------------------------------------------------------
  var costByFlight = {}
  flights.forEach(function (f) { costByFlight[f.publicId] = f })
  var legsByMission = {}
  ;(DATA.missionLegs || []).forEach(function (l) {
    if (!legsByMission[l.missionId]) legsByMission[l.missionId] = []
    legsByMission[l.missionId].push(l)
  })

  var missionsBox = document.getElementById('missions')
  if (missionsBox && (DATA.missions || []).length) {
    var head = el('div', 'mrow head')
    ;['Začiatok', 'Trasa', 'Úseky', 'Vo vzduchu', 'Celkové náklady'].forEach(function (h, i) {
      head.appendChild(el('div', ['', 'mroute', 'mlegs', 'mhours', 'mcost'][i], h))
    })
    missionsBox.appendChild(head)

    var rows = DATA.missions.map(function (m) {
      var legs = (legsByMission[m.publicId] || []).sort(function (a, b) { return a.legIndex - b.legIndex })
      var full = legs.reduce(function (s, l) {
        var f = costByFlight[l.publicId]
        return s + (f && f.costFullMid ? f.costFullMid : 0)
      }, 0)
      return { m: m, legs: legs, full: full }
    })
    rows.sort(function (a, b) { return b.full - a.full })

    rows.forEach(function (r) {
      var row = el('div', 'mrow')
      row.appendChild(el('div', null, dayLabel(r.m.startedAt)))
      var route = el('div', 'mroute', (r.m.routeKey || '').replace(/-/g, ' → ').replace(/UNKNOWN/g, 'NEZN'))
      route.appendChild(el('em', null, r.m.registration || ''))
      row.appendChild(route)
      row.appendChild(el('div', 'mlegs', nf(r.m.legCount)))
      row.appendChild(el('div', 'mhours', duration(r.m.airborneSeconds)))
      row.appendChild(el('div', 'mcost', r.full ? eur(r.full) : '—'))
      missionsBox.appendChild(row)
    })
  }

  // --- mriežka pokrytia ---------------------------------------------------
  // Jeden deň sa môže importovať opakovane, tak si necháme najlepšie podloženú odpoveď.
  var RANK = { unavailable: 0, empty: 1, completed: 2 }
  var byCell = {}
  var dayKeys = []
  days.forEach(function (d) {
    if (dayKeys.indexOf(d.day) === -1) dayKeys.push(d.day)
    var key = d.icao + '|' + d.day
    if (!byCell[key] || RANK[d.status] > RANK[byCell[key]]) byCell[key] = d.status
  })
  dayKeys.sort()

  var fleetByReg = {}
  DATA.fleet.forEach(function (a) { fleetByReg[a.registration] = a })
  var flightsByIcaoDay = {}
  flights.forEach(function (f) {
    var ac = fleetByReg[f.registration]
    if (ac) flightsByIcaoDay[ac.icao24 + '|' + isoDate(f.departureTime)] = true
  })

  var table = document.getElementById('cov')
  var headRow = el('tr')
  headRow.appendChild(el('th', 'reg', ''))
  var lastMonth = null
  dayKeys.forEach(function (day) {
    var m = day.slice(0, 7)
    // Popisok je absolútne umiestnený, aby široký názov mesiaca nerozšíril stĺpec.
    var th = el('th', 'month-label')
    if (m !== lastMonth) th.appendChild(el('b', null, MONTH_SHORT[Number(day.slice(5, 7)) - 1]))
    lastMonth = m
    headRow.appendChild(th)
  })
  table.appendChild(headRow)

  DATA.fleet.forEach(function (ac) {
    var row = el('tr')
    row.appendChild(el('th', 'reg', ac.registration))
    dayKeys.forEach(function (day) {
      var td = el('td')
      var status = byCell[ac.icao24 + '|' + day]
      var cls = 'c-nodata', title = 'deň sa nedal získať'
      if (status === 'completed' || flightsByIcaoDay[ac.icao24 + '|' + day]) {
        cls = 'c-flew'; title = 'detegované lety'
      } else if (status === 'empty') {
        cls = 'c-quiet'; title = 'archív deň mal, lietadlo nevidel'
      }
      var cell = el('span', 'cell ' + cls)
      cell.title = ac.registration + ' · ' + day + ' · ' + title
      td.appendChild(cell)
      row.appendChild(td)
    })
    table.appendChild(row)
  })

  // --- register: oddelene podľa prevádzkovateľa -----------------------------
  // Vyradené lietadlo zostáva v registri, ale nesmie vstupovať do ničoho, čo opisuje
  // flotilu dnes — inak nafúkne jej veľkosť a rozriedi každý údaj na lietadlo.
  function isCurrentlyActive(ac) {
    if (ac.status !== 'active') return false
    var today = new Date().toISOString().slice(0, 10)
    if (ac.activeFrom && ac.activeFrom > today) return false
    if (ac.activeUntil && ac.activeUntil < today) return false
    return true
  }

  function aircraftCard(ac) {
    var mine = flights.filter(function (f) { return f.registration === ac.registration })
    var hours = mine.reduce(function (s, f) { return s + (f.durationSeconds || 0) }, 0) / 3600
    var card = el('div', 'ac')
    card.appendChild(el('div', 'reg', ac.registration))
    var type = el('div', 'type', ac.variant || ac.model || '')
    if (ac.registrationType === 'military') {
      type.appendChild(el('em', null, ' · vojenský register, ev. č. ' + ac.registration))
    }
    card.appendChild(type)

    var photo = PHOTOS[ac.registration]
    if (photo) {
      var fig = el('figure')
      var img = document.createElement('img')
      img.src = photo.src
      img.alt = ac.registration + ', ' + (ac.variant || ac.model || 'lietadlo') + ', fotografované ' + photo.date
      img.loading = 'lazy'
      fig.appendChild(img)
      var cap = el('figcaption')
      cap.innerHTML = 'Foto ' + (photo.date || '').slice(0, 4) + ': ' +
        '<a href="' + photo.page + '" target="_blank" rel="noopener noreferrer">' + photo.author + '</a>' +
        ' · <a href="' + photo.licenseUrl + '" target="_blank" rel="noopener noreferrer">' + photo.license + '</a>'
      fig.appendChild(cap)
      card.appendChild(fig)
    } else {
      card.appendChild(el('div', 'no-photo', 'Voľne licencovanú fotografiu tohto lietadla sme nenašli'))
    }

    var stat = el('div', 'stat')
    if (mine.length) stat.innerHTML = '<b>' + nf(mine.length) + '</b> letov · <b>' + nf(hours, 1) + '</b> h'
    else stat.textContent = 'v tomto období nezaznamenané'
    card.appendChild(stat)

    if (ac.activeUntil) card.appendChild(el('span', 'tag retired', 'vyradené ' + ac.activeUntil))
    else if (ac.verificationStatus === 'needs_verification') {
      card.appendChild(el('span', 'tag unverified', 'identita neoverená'))
    }
    return card
  }

  var groupsBox = document.getElementById('fleet-groups')
  var operators = DATA.operators || []
  var current = DATA.fleet.filter(isCurrentlyActive)
  var historical = DATA.fleet.filter(function (ac) { return !isCurrentlyActive(ac) })

  operators
    .filter(function (op) { return op.parentId })
    .forEach(function (op) {
      var members = current.filter(function (ac) { return ac.operatorId === op.id })
      if (!members.length) return
      var group = el('div', 'fleet-group')
      var header = document.createElement('header')
      header.appendChild(el('h3', null, op.name))
      var hours = flights
        .filter(function (f) { return members.some(function (m) { return m.registration === f.registration }) })
        .reduce(function (s, f) { return s + (f.durationSeconds || 0) }, 0) / 3600
      header.appendChild(el('span', 'gmeta',
        nf(members.length) + ' lietadlá v službe · ' + nf(hours, 1) + ' h v tomto období'))
      group.appendChild(header)
      var grid = el('div', 'fleet')
      members.forEach(function (ac) { grid.appendChild(aircraftCard(ac)) })
      group.appendChild(grid)
      groupsBox.appendChild(group)
    })

  if (historical.length) {
    var group = el('div', 'fleet-group historical')
    var header = document.createElement('header')
    header.appendChild(el('h3', null, 'Historické záznamy'))
    header.appendChild(el('span', 'gmeta',
      'Mimo služby. Nevstupujú do počtu lietadiel, do nákladov ani do žiadneho údaja o dnešnej flotile.'))
    group.appendChild(header)
    var grid = el('div', 'fleet')
    historical.forEach(function (ac) { grid.appendChild(aircraftCard(ac)) })
    group.appendChild(grid)
    groupsBox.appendChild(group)
  }

  // --- letové pásiky ------------------------------------------------------
  function portNode(p, estimated) {
    var node = el('span', 'f-port' + (p.state === 'unknown' ? ' unknown' : p.state === 'probable' ? ' probable' : ''))
    node.appendChild(document.createTextNode(p.code))
    if (p.city) node.appendChild(el('em', null, p.city))
    if (estimated) node.appendChild(el('em', null, '~'))
    return node
  }

  function factList(pairs) {
    var dl = el('dl', 'fact-grid')
    pairs.forEach(function (p) {
      var wrap = el('div', 'fact')
      wrap.appendChild(el('dt', null, p[0]))
      wrap.appendChild(el('dd', p[2] ? 'soft' : null, p[1]))
      dl.appendChild(wrap)
    })
    return dl
  }

  function qualityRow(label, value) {
    var row = el('div', 'qrow ' + grade(value))
    row.appendChild(el('span', 'lbl', label))
    var track = el('span', 'track')
    var fill = el('i')
    fill.style.width = Math.max(2, Math.round(value * 100)) + '%'
    track.appendChild(fill)
    row.appendChild(track)
    row.appendChild(el('span', 'val', pct(value)))
    return row
  }

  function caveatFor(f, dep, arr) {
    var lines = []
    if (dep.state !== 'known' && arr.state !== 'known') {
      lines.push('Neurčili sme ani jeden koniec tohto letu — trasa začína aj končí vo vzduchu.')
    } else if (dep.state === 'unknown') {
      lines.push('Miesto odletu sme nikdy nevideli — pokrytie začína, keď je lietadlo už vo vzduchu.')
    } else if (arr.state === 'unknown') {
      lines.push('Cieľ sme nikdy nevideli — pokrytie končí, kým je lietadlo ešte vo vzduchu.')
    } else if (dep.state === 'probable' || arr.state === 'probable') {
      lines.push('Letisko označené <b>?</b> sme určili len z pozície vo vzduchu, nie z lietadla na zemi.')
    }
    if ((f.distanceFromGapsKm || 0) > 100) {
      lines.push('<b>' + km(f.distanceFromGapsKm) + ' km</b> vzdialenosti je premostených cez výpadky pokrytia, takže údaj je dolná hranica.')
    }
    if (f.depEst || f.arrEst) {
      lines.push('Časy s <b>~</b> sme odvodili z prvej alebo poslednej pozície vo vzduchu, nie odpozorovali.')
    }
    return lines
  }

  var stripsBox = document.getElementById('strips')
  document.getElementById('flights-heading').textContent = nf(flights.length) + ' letov, od najstaršieho'

  flights.forEach(function (f, index) {
    var dep = endpoint(f, 'dep'), arr = endpoint(f, 'arr')

    var strip = el('div', 'strip')
    strip.setAttribute('open-state', '0')

    var btn = el('button', 'strip-btn')
    btn.type = 'button'
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-controls', 'detail-' + index)

    btn.appendChild(el('span', 'rail ' + f.confidence))
    btn.appendChild(el('span', 'f-date', dayLabel(f.departureTime)))

    var ac = el('span', 'f-ac', f.registration)
    ac.appendChild(el('em', null, f.callsign || '—'))
    btn.appendChild(ac)

    var route = el('span', 'f-route')
    route.appendChild(portNode(dep, f.depEst))
    route.appendChild(el('span', 'f-arrow', '→'))
    route.appendChild(portNode(arr, f.arrEst))
    btn.appendChild(route)

    btn.appendChild(el('span', 'f-dur', duration(f.durationSeconds)))

    var dist = el('span', 'f-dist')
    dist.appendChild(document.createTextNode(km(f.distanceKm)))
    dist.appendChild(el('em', null, 'km'))
    btn.appendChild(dist)

    var cov = el('span', 'f-cov')
    var bar = el('span', 'bar')
    var fill = el('i')
    fill.style.width = Math.max(2, Math.round((f.dataCoverage || 0) * 100)) + '%'
    bar.appendChild(fill)
    cov.appendChild(bar)
    cov.appendChild(el('span', 'pct', pct(f.dataCoverage)))
    btn.appendChild(cov)

    btn.appendChild(el('span', 'chev', '›'))
    strip.appendChild(btn)

    var detail = el('div', 'detail')
    detail.id = 'detail-' + index
    strip.appendChild(detail)

    var built = false
    function build() {
      if (built) return
      built = true
      var inner = el('div', 'detail-in')

      var mapCell = el('div', 'detail-map')
      var svg = buildMap([f], {
        aria: 'Zrekonštruovaná trasa, ' + dep.code + ' do ' + arr.code +
          ', pozorovaniami pokryté ' + pct(f.dataCoverage) + ' letu',
      })
      if (svg) {
        mapCell.appendChild(svg)
        mapCell.appendChild(mapKey(nf(f.trackPoints) + ' z ' + nf(f.trackFrom) + ' pozícií vykreslených'))
      } else {
        mapCell.appendChild(el('p', 'caveat', 'K tomuto letu nemáme uloženú geometriu trasy.'))
      }
      inner.appendChild(mapCell)

      var facts = el('div', 'detail-facts')
      facts.appendChild(factList([
        ['Odlet', hhmm(f.departureTime) + (f.depEst ? ' ~' : '') + ' UTC'],
        ['Prílet', hhmm(f.arrivalTime) + (f.arrEst ? ' ~' : '') + ' UTC'],
        ['Odkiaľ', dep.name || '—', dep.state !== 'known'],
        ['Kam', arr.name || '—', arr.state !== 'known'],
        ['Vo vzduchu', duration(f.durationSeconds)],
        ['Preletená trasa', km(f.distanceKm) + ' km'],
        ['Priama vzdialenosť', km(f.greatCircleKm) + ' km'],
        ['Maximálna výška', f.maxAltitudeFt ? nf(f.maxAltitudeFt) + ' ft' : '—'],
        ['Pozorovania', nf(f.positionCount)],
        ['Najdlhší výpadok', gapLength(f.maxGapSeconds)],
        ['Lietadlo', f.variant || f.model || '—'],
        ['Odhadované náklady', f.costFullMid != null ? eur(f.costFullMid) : 'dáta nedostupné', f.costFullMid == null],
      ]))

      var quality = el('div', 'quality')
      quality.appendChild(el('p', 'eyebrow', 'Kvalita dát'))
      quality.appendChild(qualityRow('ADS-B pokrytie', f.dataCoverage || 0))
      quality.appendChild(qualityRow('Trasa', f.routeConfidence || 0))
      quality.appendChild(qualityRow('Letisko odletu', f.depConf || 0))
      quality.appendChild(qualityRow('Letisko príletu', f.arrConf || 0))
      facts.appendChild(quality)

      // Účel letu — nikdy neodvodený softvérom, vždy so zdrojom a so statusom.
      var purpose = el('div', 'purpose')
      purpose.appendChild(el('p', 'eyebrow', 'Účel letu'))
      if (f.purposeTitle) {
        var STATUS_LABEL = { confirmed: 'potvrdený', probable: 'pravdepodobný', unknown: 'neznámy' }
        var st = f.purposeStatus || 'unknown'
        purpose.appendChild(el('span', 'status ' + st, STATUS_LABEL[st] || st))
        purpose.appendChild(el('div', 'ptitle', f.purposeTitle))
        if (f.purposeDescription) purpose.appendChild(el('p', 'pdesc', f.purposeDescription))
        if (f.purposeSourceUrl) {
          var src = el('div', 'psrc')
          src.innerHTML = 'Zdroj: ' + (f.purposeSourcePublisher || '') +
            ' · <a href="' + f.purposeSourceUrl + '" target="_blank" rel="noopener noreferrer">' +
            f.purposeSourceUrl.replace(/^https?:\/\//, '').slice(0, 60) + '…</a>'
          purpose.appendChild(src)
        }
      } else {
        purpose.appendChild(el('span', 'status unknown', 'neznámy'))
        purpose.appendChild(el('p', 'pdesc',
          'Účel tohto letu nemáme podložený zdrojom. Softvér ho neodhaduje — kým sa neobjaví ' +
          'verejný doklad, zostáva neznámy.'))
      }
      facts.appendChild(purpose)

      // Náklady: dve vrstvy oddelene, plus úplný postup výpočtu.
      if (f.costFullMid != null) {
        var cost = el('div', 'quality')
        cost.appendChild(el('p', 'eyebrow', 'Odhadované náklady'))

        var layers = el('div', 'cost-layers')
        ;[
          ['Priame prevádzkové', 'čo by odpadlo, keby sa let neuskutočnil', f.costDirectLow, f.costDirectMid, f.costDirectHigh, false],
          ['Alokované fixné', 'podiel na udržiavaní kapacity', f.costFixedLow, f.costFixedMid, f.costFixedHigh, false],
          ['Celkové náklady daňovníka', 'súčet oboch vrstiev', f.costFullLow, f.costFullMid, f.costFullHigh, true],
        ].forEach(function (row) {
          var layer = el('div', 'cost-layer' + (row[5] ? ' total' : ''))
          var name = el('div', 'lname', row[0])
          name.appendChild(el('em', null, row[1]))
          layer.appendChild(name)
          layer.appendChild(el('div', 'lval', eurRange(row[2], row[3], row[4])))
          layers.appendChild(layer)
        })
        cost.appendChild(layers)

        var cmeta = el('div', 'cost-meta')
        cmeta.innerHTML =
          '<span>Kvalita odhadu: <b>' + (CONF_SK[f.costConfidence] || f.costConfidence).toUpperCase() + '</b>' +
          (f.costValidationWarning ? ' · validačné upozornenie' : '') + '</span>' +
          '<span>Block time ' + (f.costBlockHours || 0).toFixed(2) + ' h ' +
          (f.costBlockEstimated ? '(odhad)' : '(meraný)') + ' · model ' + f.costModelVersion + '</span>'
        cost.appendChild(cmeta)

        var missingList = (f.costMissing || []).map(function (m) { return MISSING_SK[m] || m })
        if (missingList.length) {
          var miss = el('div', 'cost-missing')
          miss.innerHTML = '<b>Odhad nezahŕňa:</b> ' + missingList.join(', ') + '.'
          cost.appendChild(miss)
        }

        var howto = document.createElement('details')
        howto.className = 'howto'
        var summary = document.createElement('summary')
        summary.textContent = 'Ako sme toto vypočítali?'
        howto.appendChild(summary)
        var trace = el('div', 'trace')
        ;((f.costTrace && f.costTrace.steps) || []).forEach(function (step) {
          var box = el('div', 'tstep')
          var html = '<b>' + step.label + '</b><span class="tf">' + step.formula + '</span>'
          Object.keys(step.inputs || {}).forEach(function (k) {
            var v = step.inputs[k]
            if (v === null || v === undefined) return
            html += '<span class="ti">' + k + ': ' + (typeof v === 'number' ? nf(v) : v) + '</span>'
          })
          if (step.result != null) {
            var unit = step.resultUnit || 'EUR'
            html += '<span class="tr">= ' + (unit === 'EUR' ? eur(step.result) : nf(step.result) + ' ' + unit) + '</span>'
          }
          box.innerHTML = html
          trace.appendChild(box)
        })
        ;(f.costWarnings || []).forEach(function (w) {
          trace.appendChild(el('div', 'tsrc', '⚠ ' + w.message))
        })
        howto.appendChild(trace)
        cost.appendChild(howto)

        facts.appendChild(cost)
      }

      var lines = caveatFor(f, dep, arr)
      if (lines.length) {
        var caveat = el('div', 'caveat')
        caveat.innerHTML = lines.join(' ')
        facts.appendChild(caveat)
      }

      inner.appendChild(facts)
      detail.appendChild(inner)
    }

    btn.addEventListener('click', function () {
      var open = strip.getAttribute('open-state') === '1'
      strip.setAttribute('open-state', open ? '0' : '1')
      btn.setAttribute('aria-expanded', open ? 'false' : 'true')
      if (!open) build()
    })

    // Prvý let necháme otvorený, aby bolo vidieť, čo sa pod pásikom skrýva.
    if (index === 0) {
      strip.setAttribute('open-state', '1')
      btn.setAttribute('aria-expanded', 'true')
      build()
    }

    stripsBox.appendChild(strip)
  })

  // --- dvojice miest ------------------------------------------------------
  var pairs = {}
  var unknownLegs = 0
  flights.forEach(function (f) {
    var dep = endpoint(f, 'dep'), arr = endpoint(f, 'arr')
    if (dep.state !== 'known' || arr.state !== 'known') { unknownLegs++; return }
    var sameField = dep.code === arr.code
    var codes = [dep.code, arr.code].sort()
    var key = sameField ? dep.code + ' ⟲' : codes.join(' ⇄ ')
    if (!pairs[key]) {
      pairs[key] = {
        key: key,
        n: 0,
        cities: sameField
          ? (dep.city || dep.code) + ' — vrátilo sa na letisko, z ktorého vzlietlo'
          : [dep, arr].sort(function (a, b) { return a.code < b.code ? -1 : 1 })
              .map(function (p) { return p.city }).join(' – '),
      }
    }
    pairs[key].n++
  })

  var list = Object.keys(pairs).map(function (k) { return pairs[k] })
  list.sort(function (a, b) { return b.n - a.n })
  var max = Math.max.apply(null, list.map(function (p) { return p.n }).concat([unknownLegs, 1]))

  var routesBox = document.getElementById('routes')
  function routeRow(title, subtitle, n, unknown) {
    var row = el('div', 'route' + (unknown ? ' unknown' : ''))
    var pair = el('div', 'pair', title)
    pair.appendChild(el('em', null, subtitle))
    row.appendChild(pair)
    var meter = el('div', 'meter')
    var fill = el('i')
    fill.style.width = Math.round((n / max) * 100) + '%'
    meter.appendChild(fill)
    row.appendChild(meter)
    row.appendChild(el('div', 'n', nf(n)))
    routesBox.appendChild(row)
  }
  list.forEach(function (p) { routeRow(p.key, p.cities, p.n, false) })
  if (unknownLegs) routeRow('Jeden alebo oba konce neznáme', 'nepriradené k žiadnemu letisku', unknownLegs, true)

  // --- pätička ------------------------------------------------------------
  document.getElementById('foot-generated').textContent =
    'Postavené z databázy pipeline ' + longDate(DATA.generatedAt)
  document.getElementById('foot-detector').textContent = flights.length ? flights[0].detectorVersion : '—'
})()
