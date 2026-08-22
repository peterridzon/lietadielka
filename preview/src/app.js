(function () {
  'use strict'

  var DATA = JSON.parse(document.getElementById('flight-data').textContent)
  var LAND = JSON.parse(document.getElementById('land-data').textContent)
  var BORDERS = JSON.parse(document.getElementById('border-data').textContent)
  var SVG_NS = 'http://www.w3.org/2000/svg'

  // --- formatting ---------------------------------------------------------
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  function pad(n) { return n < 10 ? '0' + n : String(n) }
  function isoDate(s) { return s.slice(0, 10) }
  function dayLabel(s) {
    var d = new Date(s)
    return pad(d.getUTCDate()) + ' ' + MONTHS[d.getUTCMonth()]
  }
  function hhmm(s) {
    var d = new Date(s)
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes())
  }
  function duration(sec) {
    if (sec == null) return '—'
    return pad(Math.floor(sec / 3600)) + ':' + pad(Math.round((sec % 3600) / 60))
  }
  /** Gaps span seconds to hours, and "00:00" for a 20-second gap reads as no gap at all. */
  function gapLength(sec) {
    if (sec == null) return '—'
    if (sec < 90) return Math.round(sec) + ' s'
    if (sec < 5400) return Math.round(sec / 60) + ' min'
    return Math.floor(sec / 3600) + ' h ' + Math.round((sec % 3600) / 60) + ' min'
  }
  function km(n) { return n == null ? '—' : Math.round(n).toLocaleString('en-GB') }
  function pct(x) { return x == null ? '—' : Math.round(x * 100) + '%' }
  function grade(x) { return x >= 0.75 ? 'q-high' : x >= 0.5 ? 'q-med' : 'q-low' }

  function el(tag, cls, text) {
    var node = document.createElement(tag)
    if (cls) node.className = cls
    if (text != null) node.textContent = text
    return node
  }

  /** Accepted airport, else the probable one, else nothing — never a guess dressed up. */
  function endpoint(f, side) {
    var p = side === 'dep'
      ? { code: f.depIata || f.depIdent, city: f.depCity, name: f.depName, ident: f.depIdent }
      : { code: f.arrIata || f.arrIdent, city: f.arrCity, name: f.arrName, ident: f.arrIdent }
    if (p.ident) return { code: p.code, city: p.city, name: p.name, state: 'known' }
    var q = side === 'dep'
      ? { code: f.depPIata || f.depPIdent, city: f.depPCity, name: f.depPName, ident: f.depPIdent }
      : { code: f.arrPIata || f.arrPIdent, city: f.arrPCity, name: f.arrPName, ident: f.arrPIdent }
    if (q.ident) return { code: q.code, city: q.city, name: q.name, state: 'probable' }
    return { code: 'UNKN', city: null, name: 'Not identified', state: 'unknown' }
  }

  // --- headline figures ---------------------------------------------------
  var flights = DATA.flights
  var totalSeconds = flights.reduce(function (s, f) { return s + (f.durationSeconds || 0) }, 0)
  var totalKm = flights.reduce(function (s, f) { return s + (f.distanceKm || 0) }, 0)
  var gapKm = flights.reduce(function (s, f) { return s + (f.distanceFromGapsKm || 0) }, 0)

  document.getElementById('delay-hours').textContent = DATA.publicationDelayHours

  var days = DATA.days.slice().sort(function (a, b) { return a.day < b.day ? -1 : 1 })
  var firstDay = days.length ? days[0].day : isoDate(flights[0].departureTime)
  var lastDay = days.length ? days[days.length - 1].day : isoDate(flights[flights.length - 1].departureTime)

  document.getElementById('window-sub').textContent =
    'Every state aircraft in the registry, ' + dayLabel(firstDay) + ' to ' + dayLabel(lastDay) +
    ' ' + new Date(lastDay).getUTCFullYear() + '. Figures cover only the days the archive could actually serve.'

  var kpiDefs = [
    { v: String(flights.length), unit: '', label: 'Flights detected', note: flights.length + ' reconstructed from ' + flights.reduce(function (s, f) { return s + f.positionCount }, 0).toLocaleString('en-GB') + ' observations' },
    { v: (totalSeconds / 3600).toFixed(1), unit: 'h', label: 'Airborne time', note: 'Wheels-up to wheels-down, not block time' },
    { v: km(totalKm), unit: 'km', label: 'Distance flown', note: km(gapKm) + ' km of it bridged across coverage gaps' },
    { unavailable: 'Data unavailable', label: 'Estimated cost', note: 'No sourced operating figure has been obtained' },
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

  // --- coverage grid ------------------------------------------------------
  // One run may retry a day, so keep the best-informed answer per aircraft-day.
  var RANK = { unavailable: 0, empty: 1, completed: 2 }
  var byCell = {}
  var dayKeys = []
  days.forEach(function (d) {
    if (dayKeys.indexOf(d.day) === -1) dayKeys.push(d.day)
    var key = d.icao + '|' + d.day
    if (!byCell[key] || RANK[d.status] > RANK[byCell[key]]) byCell[key] = d.status
  })
  dayKeys.sort()

  var flightsByIcaoDay = {}
  var fleetByReg = {}
  DATA.fleet.forEach(function (a) { fleetByReg[a.registration] = a })
  flights.forEach(function (f) {
    var icao = fleetByReg[f.registration] ? fleetByReg[f.registration].icao24 : ''
    flightsByIcaoDay[icao + '|' + isoDate(f.departureTime)] = true
  })

  var table = document.getElementById('cov')
  var headRow = el('tr')
  headRow.appendChild(el('th', 'reg', ''))
  var lastMonth = null
  dayKeys.forEach(function (day) {
    var m = day.slice(0, 7)
    // The label is absolutely positioned so a wide month name cannot widen its column.
    var th = el('th', 'month-label')
    if (m !== lastMonth) th.appendChild(el('b', null, MONTHS[Number(day.slice(5, 7)) - 1]))
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
      var cls = 'c-nodata', title = 'no data retrievable'
      if (status === 'completed' || flightsByIcaoDay[ac.icao24 + '|' + day]) {
        cls = 'c-flew'; title = 'flights detected'
      } else if (status === 'empty') {
        cls = 'c-quiet'; title = 'archive held the day, aircraft not seen'
      }
      var cell = el('span', 'cell ' + cls)
      cell.title = ac.registration + ' · ' + day + ' · ' + title
      td.appendChild(cell)
      row.appendChild(td)
    })
    table.appendChild(row)
  })

  // --- fleet --------------------------------------------------------------
  var fleetBox = document.getElementById('fleet')
  DATA.fleet.forEach(function (ac) {
    var mine = flights.filter(function (f) { return f.registration === ac.registration })
    var hours = mine.reduce(function (s, f) { return s + (f.durationSeconds || 0) }, 0) / 3600
    var card = el('div', 'ac')
    card.appendChild(el('div', 'reg', ac.registration))
    card.appendChild(el('div', 'type', (ac.variant || ac.model || '') + (ac.manufacturer ? '' : '')))
    var stat = el('div', 'stat')
    if (mine.length) {
      stat.innerHTML = '<b>' + mine.length + '</b> flights · <b>' + hours.toFixed(1) + '</b> h'
    } else {
      stat.textContent = 'not seen in this window'
    }
    card.appendChild(stat)
    if (ac.activeUntil) {
      card.appendChild(el('span', 'tag retired', 'withdrawn ' + ac.activeUntil))
    } else if (ac.verificationStatus === 'needs_verification') {
      card.appendChild(el('span', 'tag unverified', 'identity unverified'))
    }
    fleetBox.appendChild(card)
  })

  // --- map ----------------------------------------------------------------
  function buildMap(f) {
    var track = f.track || []
    if (track.length < 2) return null

    var lons = track.map(function (p) { return p[0] })
    var lats = track.map(function (p) { return p[1] })
    var minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons)
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats)

    var padLon = Math.max((maxLon - minLon) * 0.14, 1.6)
    var padLat = Math.max((maxLat - minLat) * 0.22, 1.6)
    minLon -= padLon; maxLon += padLon; minLat -= padLat; maxLat += padLat

    // Equirectangular, x compressed by the cosine of the view's centre latitude,
    // which keeps shapes honest over the span of a single flight.
    var k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
    var w = (maxLon - minLon) * k
    var h = maxLat - minLat
    var W = 720
    var H = Math.max(220, Math.min(460, Math.round(W * h / w)))
    var sx = W / w, sy = H / h
    var s = Math.min(sx, sy)
    var ox = (W - w * s) / 2, oy = (H - h * s) / 2

    function px(lon, lat) {
      return [ox + (lon - minLon) * k * s, oy + (maxLat - lat) * s]
    }

    var svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
    svg.setAttribute('role', 'img')

    var dep = endpoint(f, 'dep'), arr = endpoint(f, 'arr')
    svg.setAttribute('aria-label',
      'Reconstructed track, ' + dep.code + ' to ' + arr.code +
      ', ' + pct(f.dataCoverage) + ' of the flight covered by observations')

    // Land, drawn flat with a hairline edge — a chart base, not a basemap.
    var landGroup = document.createElementNS(SVG_NS, 'g')
    LAND.forEach(function (ring) {
      var inView = false
      for (var i = 0; i < ring.length; i++) {
        if (ring[i][0] > minLon - 20 && ring[i][0] < maxLon + 20 &&
            ring[i][1] > minLat - 20 && ring[i][1] < maxLat + 20) { inView = true; break }
      }
      if (!inView) return
      var d = ring.map(function (pt, i) {
        var q = px(pt[0], pt[1])
        return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)
      }).join('') + 'Z'
      var path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', d)
      path.style.setProperty('fill', 'var(--land)')
      path.style.setProperty('stroke', 'var(--land-edge)')
      path.setAttribute('stroke-width', '0.7')
      landGroup.appendChild(path)
    })
    svg.appendChild(landGroup)

    var borderGroup = document.createElementNS(SVG_NS, 'g')
    BORDERS.forEach(function (line) {
      var inView = false
      for (var i = 0; i < line.length; i++) {
        if (line[i][0] > minLon - 6 && line[i][0] < maxLon + 6 &&
            line[i][1] > minLat - 6 && line[i][1] < maxLat + 6) { inView = true; break }
      }
      if (!inView) return
      var d = line.map(function (pt, i) {
        var q = px(pt[0], pt[1])
        return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)
      }).join('')
      var path = document.createElementNS(SVG_NS, 'path')
      path.setAttribute('d', d)
      path.setAttribute('fill', 'none')
      path.style.setProperty('stroke', 'var(--border-line)')
      path.setAttribute('stroke-width', '0.8')
      borderGroup.appendChild(path)
    })
    svg.appendChild(borderGroup)

    // Segments the aircraft was observed on, and segments inferred across a gap.
    var gaps = (f.gaps || []).map(function (g) {
      return [Date.parse(g.from) / 1000, Date.parse(g.to) / 1000]
    })
    function bridged(t1, t2) {
      for (var i = 0; i < gaps.length; i++) {
        if (gaps[i][0] < t2 && gaps[i][1] > t1) return true
      }
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
        line.setAttribute('stroke-width', '1.6')
        line.setAttribute('stroke-dasharray', '3 5')
        line.setAttribute('opacity', '0.62')
      } else {
        line.setAttribute('stroke-width', '2.4')
      }
      svg.appendChild(line)
    }

    ;[[track[0], dep], [track[track.length - 1], arr]].forEach(function (pair) {
      var q = px(pair[0][0], pair[0][1])
      var known = pair[1].state === 'known'
      var c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('cx', q[0].toFixed(1)); c.setAttribute('cy', q[1].toFixed(1))
      c.setAttribute('r', '4.5')
      c.style.setProperty('fill', known ? 'var(--accent)' : 'var(--surface)')
      c.style.setProperty('stroke', known ? 'var(--surface)' : 'var(--accent)')
      c.setAttribute('stroke-width', '2')
      if (!known) c.setAttribute('stroke-dasharray', '2.5 2')
      svg.appendChild(c)

      var label = document.createElementNS(SVG_NS, 'text')
      label.setAttribute('x', (q[0] + 9).toFixed(1))
      label.setAttribute('y', (q[1] + 4).toFixed(1))
      label.style.setProperty('font-family', 'var(--data)')
      label.setAttribute('font-size', '12')
      label.setAttribute('font-weight', '600')
      label.style.setProperty('fill', 'var(--ink)')
      label.setAttribute('paint-order', 'stroke')
      label.style.setProperty('stroke', 'var(--surface)')
      label.setAttribute('stroke-width', '3.5')
      label.setAttribute('stroke-linejoin', 'round')
      label.textContent = pair[1].code + (known ? '' : ' ?')
      svg.appendChild(label)
    })

    return svg
  }

  // --- flight strips ------------------------------------------------------
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
      lines.push('Neither end of this flight was identified. The track begins and ends in the air.')
    } else if (dep.state === 'unknown') {
      lines.push('The origin was never observed — coverage begins with the aircraft already airborne.')
    } else if (arr.state === 'unknown') {
      lines.push('The destination was never observed — coverage ends with the aircraft still airborne.')
    } else if (dep.state === 'probable' || arr.state === 'probable') {
      lines.push('An airport marked <b>?</b> was identified from an airborne fix only, not from the aircraft on the ground.')
    }
    if ((f.distanceFromGapsKm || 0) > 100) {
      lines.push('<b>' + km(f.distanceFromGapsKm) + ' km</b> of the distance was bridged across gaps in coverage, so the figure is a lower bound.')
    }
    if (f.depEst || f.arrEst) {
      lines.push('Times marked <b>~</b> were inferred from the first or last airborne fix rather than watched.')
    }
    return lines
  }

  var stripsBox = document.getElementById('strips')
  document.getElementById('flights-heading').textContent = flights.length + ' flights, oldest first'

  flights.forEach(function (f, index) {
    var dep = endpoint(f, 'dep'), arr = endpoint(f, 'arr')

    var strip = el('div', 'strip')
    strip.setAttribute('open-state', '0')

    var btn = el('button', 'strip-btn')
    btn.type = 'button'
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-controls', 'detail-' + index)

    btn.appendChild(el('span', 'rail ' + f.confidence))

    var date = el('span', 'f-date')
    date.appendChild(document.createTextNode(dayLabel(f.departureTime)))
    btn.appendChild(date)

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
    btn.addEventListener('click', function () {
      var open = strip.getAttribute('open-state') === '1'
      strip.setAttribute('open-state', open ? '0' : '1')
      btn.setAttribute('aria-expanded', open ? 'false' : 'true')
      if (built || open) return
      built = true

      var inner = el('div', 'detail-in')

      var mapCell = el('div', 'detail-map')
      var svg = buildMap(f)
      if (svg) {
        mapCell.appendChild(svg)
        var key = el('div', 'map-key')
        key.innerHTML =
          '<span><svg viewBox="0 0 26 8"><line class="k-solid" x1="1" y1="4" x2="25" y2="4"/></svg> observed</span>' +
          '<span><svg viewBox="0 0 26 8"><line class="k-dashed" x1="1" y1="4" x2="25" y2="4"/></svg> bridged across a gap</span>' +
          '<span>' + f.trackPoints + ' of ' + f.trackFrom.toLocaleString('en-GB') + ' fixes drawn</span>'
        mapCell.appendChild(key)
      } else {
        mapCell.appendChild(el('p', 'caveat', 'No track geometry stored for this flight.'))
      }
      inner.appendChild(mapCell)

      var facts = el('div', 'detail-facts')
      facts.appendChild(factList([
        ['Departure', hhmm(f.departureTime) + (f.depEst ? ' ~' : '') + ' UTC'],
        ['Arrival', hhmm(f.arrivalTime) + (f.arrEst ? ' ~' : '') + ' UTC'],
        ['From', dep.name || '—', dep.state !== 'known'],
        ['To', arr.name || '—', arr.state !== 'known'],
        ['Airborne', duration(f.durationSeconds)],
        ['Track flown', km(f.distanceKm) + ' km'],
        ['Direct distance', km(f.greatCircleKm) + ' km'],
        ['Maximum altitude', f.maxAltitudeFt ? f.maxAltitudeFt.toLocaleString('en-GB') + ' ft' : '—'],
        ['Observations', f.positionCount.toLocaleString('en-GB')],
        ['Longest gap', gapLength(f.maxGapSeconds)],
        ['Aircraft', (f.variant || f.model || '') + ''],
        ['Estimated cost', 'data unavailable', true],
      ]))

      var quality = el('div', 'quality')
      quality.appendChild(el('p', 'eyebrow', 'Data quality'))
      quality.appendChild(qualityRow('ADS-B coverage', f.dataCoverage || 0))
      quality.appendChild(qualityRow('Route', f.routeConfidence || 0))
      quality.appendChild(qualityRow('Origin airport', f.depConf || 0))
      quality.appendChild(qualityRow('Destination airport', f.arrConf || 0))
      facts.appendChild(quality)

      var lines = caveatFor(f, dep, arr)
      if (lines.length) {
        var caveat = el('div', 'caveat')
        caveat.innerHTML = lines.join(' ')
        facts.appendChild(caveat)
      }

      inner.appendChild(facts)
      detail.appendChild(inner)
    })

    stripsBox.appendChild(strip)
  })

  // --- city pairs ---------------------------------------------------------
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
          ? (dep.city || dep.code) + ' — returned to the airport it left'
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
  list.forEach(function (p) {
    var row = el('div', 'route')
    var pair = el('div', 'pair', p.key)
    pair.appendChild(el('em', null, p.cities))
    row.appendChild(pair)
    var meter = el('div', 'meter')
    var fill = el('i')
    fill.style.width = Math.round((p.n / max) * 100) + '%'
    meter.appendChild(fill)
    row.appendChild(meter)
    row.appendChild(el('div', 'n', String(p.n)))
    routesBox.appendChild(row)
  })

  if (unknownLegs) {
    var row = el('div', 'route unknown')
    var pair = el('div', 'pair', 'One or both ends unknown')
    pair.appendChild(el('em', null, 'not attributed to any airport'))
    row.appendChild(pair)
    var meter = el('div', 'meter')
    var fill = el('i')
    fill.style.width = Math.round((unknownLegs / max) * 100) + '%'
    meter.appendChild(fill)
    row.appendChild(meter)
    row.appendChild(el('div', 'n', String(unknownLegs)))
    routesBox.appendChild(row)
  }

  // --- footer -------------------------------------------------------------
  var gen = new Date(DATA.generatedAt)
  document.getElementById('foot-generated').textContent =
    'Built from the pipeline database on ' + pad(gen.getUTCDate()) + ' ' + MONTHS[gen.getUTCMonth()] + ' ' + gen.getUTCFullYear()
  document.getElementById('foot-detector').textContent = flights.length ? flights[0].detectorVersion : '—'
})()
