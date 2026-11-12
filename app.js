/* Dining Wrapped — parses a Brown meal-plan statement CSV and renders a
   Spotify-Wrapped-style recap. Everything runs locally; no network calls.
   Plain script (no modules) so index.html works straight off the filesystem. */
(function () {
  'use strict';

  /* ─────────────────────────── helpers ─────────────────────────── */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, kids) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function num(n) { return n.toLocaleString('en-US'); }
  function money(n, cents) {
    var v = cents ? Math.round(n * 100) / 100 : Math.round(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0 });
  }
  function pct(n, digits) {
    var d = digits == null ? (n < 10 ? 1 : 0) : digits;
    return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)) + '%';
  }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function clock(hour, minute) {
    var ap = hour < 12 ? 'AM' : 'PM';
    var hh = hour % 12 === 0 ? 12 : hour % 12;
    if (hour === 12 && !minute) return 'noon';
    if (hour === 0 && !minute) return 'midnight';
    return hh + (minute ? ':' + (minute < 10 ? '0' : '') + minute : '') + ' ' + ap;
  }
  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function utcDay(d) { return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DOWS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function monthLabel(key) {
    var p = key.split('-');
    return MONTHS[+p[1] - 1] + ' ' + p[0].slice(2);
  }
  var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  function monthLabelLong(key) {
    var p = key.split('-');
    return MONTHS_FULL[+p[1] - 1] + ' ' + p[0];
  }
  function shortDate(d) {
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }
  /* how many times a given weekday falls inside the covered range */
  function countWeekdays(st, dow) {
    if (!st.first || !st.last) return 0;
    var start = new Date(st.first.getFullYear(), st.first.getMonth(), st.first.getDate());
    var n = 0;
    while (start <= st.last) {
      if (start.getDay() === dow) n++;
      start.setDate(start.getDate() + 1);
    }
    return n;
  }
  function longDate(d) {
    return DOWS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function plural(n, one, many) { return num(n) + ' ' + (n === 1 ? one : (many || one + 's')); }

  /* ─────────────────────────── csv ─────────────────────────── */

  function parseDelimited(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [], row = [], field = '', quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows
      .map(function (r) { return r.map(function (s) { return s.trim(); }); })
      .filter(function (r) { return r.some(function (s) { return s !== ''; }); });
  }

  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) return mk(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (m) {
      var y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return mk(y, +m[1], +m[2], m[4], m[5], m[6]);
    }
    var d = new Date(s);
    return isNaN(+d) ? null : d;
  }
  function mk(y, mo, d, hh, mi, ss) {
    return new Date(y, mo - 1, d, +(hh || 0), +(mi || 0), +(ss || 0));
  }
  function parseAmount(s) {
    if (s == null) return NaN;
    var v = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
    return v;
  }

  var NON_MEAL = /reset|deposit|payment|refund|transfer|adjust|credit|purchase|subscription|plan\b|refund\b/i;

  /* What the 20-a-week plan actually costs. The per-swipe figure is only as
     good as the semester length, so that is the knob to turn if the printed
     price ever changes. */
  var SEMESTER_COST = 4377.00;
  var SEMESTER_WEEKS = 16;

  function hallFromDescription(desc) {
    var s = String(desc || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!s || NON_MEAL.test(s)) return null;
    return s.replace(/\s+#?\d+\s*$/, '').trim() || null;
  }

  /* Brown dining halls. Statement descriptions come through as "AG Andrews 2",
     "Sharpe PAX 5", "VW Pax 3" — so match on the slug and canonicalise. */
  var ALIAS = {
    'andrews': 'Andrews', 'andrew': 'Andrews',
    'jo': "Jo's", "jo's": "Jo's", 'josiah': "Jo's", "josiah's": "Jo's", 'josiahs': "Jo's", 'jos': "Jo's",
    'ivy room': 'Ivy Room', 'ivy': 'Ivy Room', 'room': 'Ivy Room', 'the room': 'Ivy Room',
    'ratty': 'The Ratty', 'sharpe': 'The Ratty', 'sharpe pax': 'The Ratty',
    'sharpe refectory': 'The Ratty', 'the ratty': 'The Ratty',
    'vdub': 'VDub', 'vw pax': 'VDub', 'v dub': 'VDub',
    'baker': 'Baker', 'keeton': 'Keeton', 'harkness': 'Harkness', 'wilson': 'Wilson',
    'keyes': 'Keyes', 'rumford': 'Rumford', 'barus': 'Barus', 'holley': 'Holley',
    'greece': 'Greece', 'ccb': 'CCB', 'blue room': 'Blue Room'
  };
  var PALETTE = ['#ffb627', '#b36bff', '#3ddc97', '#4ea8ff', '#ff6b9d', '#facc15',
    '#2dd4bf', '#fb923c', '#a3e635', '#e879f9'];

  function canonHall(raw) {
    var low = String(raw || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
    if (!low) return raw;
    if (ALIAS[low]) return ALIAS[low];
    // Strip leading dining hall codes like AG, VW, VDUB, etc and building codes like 12UX, PAX
    var stripped = low;
    // repeatedly strip leading tokens that look like codes (letters, alphanumerics)
    var changed;
    do {
      changed = false;
      // strip token that is all letters 2-4 chars or contains digits (like 12ux) or common codes
      var m = stripped.match(/^([a-z]{2,4}|[a-z0-9]{3,5}|pax)\s+(.*)$/);
      if (m) {
        stripped = m[2].trim();
        changed = true;
      }
    } while (changed && stripped);
    if (ALIAS[stripped]) return ALIAS[stripped];
    // try without trailing numbers/spaces again
    stripped = stripped.replace(/\s+#?\d+\s*$/, '').trim();
    if (ALIAS[stripped]) return ALIAS[stripped];
    var bare = low.replace(/^[a-z]{2,4}\s+/, '');
    if (ALIAS[bare]) return ALIAS[bare];
    bare = bare.replace(/\s+#?\d+\s*$/, '').trim();
    if (ALIAS[bare]) return ALIAS[bare];
    // fallback: title case the stripped/core name
    var core = stripped || bare || low;
    return core.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }).replace(/\bJos\b/g, "Jo's").replace(/Jo's$/i, "Jo's");
  }

  function colorFor(name, index) {
    var known = { andrews: '#ffb627', jo: '#b36bff', jos: '#b36bff', ivyroom: '#3ddc97',
      theratty: '#4ea8ff', ratty: '#4ea8ff', sharpepax: '#4ea8ff', vdub: '#ff6b9d', baker: '#facc15',
      keeton: '#2dd4bf', wilson: '#fb923c', harkness: '#a3e635' };
    return known[slug(name)] || PALETTE[index % PALETTE.length];
  }

  /* Turn a raw CSV grid into swipe objects. Returns {swipes, credits, skipped}. */
  function extractSwipes(grid) {
    if (!grid.length) return { swipes: [], credits: [], skipped: 0 };
    var headerIdx = 0;
    for (var i = 0; i < Math.min(grid.length, 8); i++) {
      var joined = grid[i].join(' ').toLowerCase();
      if (joined.indexOf('date') >= 0 && (joined.indexOf('description') >= 0 || joined.indexOf('amount') >= 0)) {
        headerIdx = i; break;
      }
    }
    var head = grid[headerIdx].map(function (s) { return s.toLowerCase(); });
    function col(names) {
      for (var i = 0; i < head.length; i++) {
        for (var j = 0; j < names.length; j++) if (head[i].indexOf(names[j]) >= 0) return i;
      }
      return -1;
    }
    var iDate = col(['date', 'time']);
    var iDesc = col(['description', 'detail', 'hall', 'location']);
    var iAmt = col(['amount', 'debit', 'points', 'value']);
    var iBal = col(['balance', 'bal', 'remaining']);
    if (iDate < 0) iDate = 0;
    if (iDesc < 0) iDesc = 1;
    if (iAmt < 0) iAmt = 2;

    var swipes = [], credits = [], skipped = 0;
    for (var r = headerIdx + 1; r < grid.length; r++) {
      var row = grid[r];
      var t = parseDate(row[iDate]);
      var amt = parseAmount(row[iAmt]);
      if (!t) { skipped++; continue; }
      if (!(amt < 0)) {
        if (amt > 0) {
          var bal = iBal >= 0 ? parseAmount(row[iBal]) : NaN;
          credits.push({ t: t, amount: amt, label: row[iDesc] || 'Credit',
            balance: isFinite(bal) ? bal : null });
        }
        continue;
      }
      var hall = hallFromDescription(row[iDesc]);
      if (!hall) continue;
      swipes.push({ t: t, hall: canonHall(hall), points: -amt, raw: row.join(',') });
    }
    swipes.sort(function (a, b) { return a.t - b.t || (a.raw < b.raw ? -1 : 1); });
    return { swipes: swipes, credits: credits, skipped: skipped };
  }

  /* Merge several statements, collapsing rows that repeat across files
     (overlapping exports) while keeping genuine same-minute double swipes. */
  function mergeSets(sets) {
    if (sets.length === 1) return sets[0].swipes;
    var count = {}, best = {}, meta = {};
    sets.forEach(function (set) {
      var local = {};
      set.swipes.forEach(function (s) {
        local[s.raw] = (local[s.raw] || 0) + 1;
        if (!meta[s.raw] || s.t < meta[s.raw].t) meta[s.raw] = s;
      });
      Object.keys(local).forEach(function (k) {
        count[k] = (count[k] || 0) + 1;
        best[k] = Math.max(best[k] || 0, local[k]);
      });
    });
    var out = [];
    Object.keys(best).forEach(function (k) {
      var base = meta[k];
      for (var i = 0; i < best[k]; i++) {
        out.push({ t: base.t, hall: base.hall, points: base.points, raw: k });
      }
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /* ─────────────────────────── stats ─────────────────────────── */

  var DAYPARTS = [
    { name: 'Early', from: 5, to: 10, color: '#38bdf8' },
    { name: 'Lunch', from: 11, to: 15, color: '#a3e635' },
    { name: 'Dinner', from: 16, to: 20, color: '#fb923c' },
    { name: 'Late night', from: 21, to: 4, color: '#b36bff' }
  ];
  function daypartOf(hour) {
    for (var i = 0; i < DAYPARTS.length; i++) {
      var d = DAYPARTS[i];
      if (d.from <= d.to ? (hour >= d.from && hour <= d.to) : (hour >= d.from || hour <= d.to)) return d;
    }
    return DAYPARTS[0];
  }

  /* Dining days run 4am to 4am, so 00:30 is the *end* of a service day, not
     the start. Fold post-midnight hours past 24h to order a whole day. */
  var SERVICE_START = 4;
  function serviceHour(h) { return h < SERVICE_START ? h + 24 : h; }

  function buildStats(swipes, credits) {
    var st = {
      swipes: swipes,
      meals: 0, activeDays: 0, spanDays: 0, weeks: 0,
      first: null, last: null,
      hours: new Array(24).fill(0),
      dow: new Array(7).fill(0),
      dowHour: Array.from({ length: 7 }, function () { return new Array(24).fill(0); }),
      halls: [], hallIndex: {}, months: [], monthIndex: {}, weeks: [], weekIndex: {},
      dayparts: DAYPARTS.map(function (d) { return { name: d.name, color: d.color, points: 0 }; }),
      dayTotals: {}, weekTotals: {}, longestStreak: 0, bestDay: null, bestWeek: null,
      peakHour: 0, peakDow: 0, earliest: null, latest: null, earliestH: null, latestH: null,
      credits: credits || []
    };
    if (!swipes.length) return st;

    var days = {}, firstByHall = {}, lastByHall = {}, hallDays = {};

    swipes.forEach(function (s) {
      var p = s.points, t = s.t, hour = t.getHours();
      st.meals += p;
      st.hours[hour] += p;
      st.dow[t.getDay()] += p;
      st.dowHour[t.getDay()][hour] += p;

      var dk = dayKey(t), wk = weekKey(t), mk = monthKey(t);
      days[dk] = 1;
      st.dayTotals[dk] = (st.dayTotals[dk] || 0) + p;
      st.weekTotals[wk] = (st.weekTotals[wk] || 0) + p;

      if (!st.monthIndex[mk]) { st.monthIndex[mk] = { key: mk, total: 0, halls: {} }; st.months.push(mk); }
      st.monthIndex[mk].total += p;
      st.monthIndex[mk].halls[s.hall] = (st.monthIndex[mk].halls[s.hall] || 0) + p;

      if (!st.weekIndex[wk]) { st.weekIndex[wk] = { key: wk, total: 0, halls: {} }; }
      st.weekIndex[wk].total += p;
      st.weekIndex[wk].halls[s.hall] = (st.weekIndex[wk].halls[s.hall] || 0) + p;

      if (!st.hallIndex[s.hall]) {
        st.hallIndex[s.hall] = { name: s.hall, points: 0, days: 0, hours: new Array(24).fill(0), months: {}, weeks: {} };
        st.halls.push(st.hallIndex[s.hall]);
        hallDays[s.hall] = {};
      }
      var H = st.hallIndex[s.hall];
      H.points += p;
      H.hours[hour] += p;
      H.months[mk] = (H.months[mk] || 0) + p;
      H.weeks[wk] = (H.weeks[wk] || 0) + p;
      hallDays[s.hall][dk] = 1;

      if (!st.first || t < st.first) { st.first = t; }
      if (!st.last || t > st.last) { st.last = t; }
      if (!firstByHall[s.hall] || t < firstByHall[s.hall]) firstByHall[s.hall] = t;
      if (!lastByHall[s.hall] || t > lastByHall[s.hall]) lastByHall[s.hall] = t;
      // earliest/latest are clock extremes on a 4am-to-4am day, not first/last by date
      var sh = serviceHour(hour);
      if (st.earliestH == null || sh < st.earliestH) { st.earliestH = sh; st.earliest = t; }
      if (st.latestH == null || sh > st.latestH) { st.latestH = sh; st.latest = t; }
      st.dayparts[daypartOf(hour).name === 'Late night' ? 3 : DAYPARTS.indexOf(daypartOf(hour))].points += p;
    });

    st.months.sort();

    // day/span math first: the per-hall rollups below depend on the span
    var keys = Object.keys(days).sort();
    st.activeDays = keys.length;
    if (st.first && st.last) {
      st.spanDays = Math.round((utcDay(st.last) - utcDay(st.first)) / 86400000) + 1;
    }
    st.perWeek = st.spanDays ? st.meals / (st.spanDays / 7) : st.meals;

    /* Swipe economics. The Amount on a reset row is only the top-up delta:
       the balance lands on the same number every week, so the grant is that
       number, not the delta. Falling back to summing Amounts is wrong by a
       wide margin — it reads a 20/week plan as whatever is left over. */
    st.weeklyBudget = 0;
    st.budgetKnown = false;
    var balTally = {};
    (st.credits || []).forEach(function (c) {
      if (c.balance != null && c.balance > 0) balTally[c.balance] = (balTally[c.balance] || 0) + 1;
    });
    var bestBal = 0, bestN = 0;
    Object.keys(balTally).forEach(function (k) {
      if (balTally[k] > bestN) { bestN = balTally[k]; bestBal = Number(k); }
    });
    if (bestBal > 0 && bestN >= Math.max(2, (st.credits || []).length / 2)) {
      st.weeklyBudget = bestBal;
      st.budgetKnown = true;
    }
    var creditSum = (st.credits || []).reduce(function (a, c) { return a + c.amount; }, 0);
    st.creditCount = (st.credits || []).length;
    st.added = st.budgetKnown ? st.weeklyBudget * st.creditCount : creditSum;
    st.wasted = Math.max(0, st.added - st.meals);
    // each credit event starts a fresh week of the plan, so that is the
    // denominator when we have it; the date span is only a rough fallback
    st.weeksCovered = st.creditCount || (st.spanDays ? Math.max(1, st.spanDays / 7) : 1);
    st.weeksFromDates = st.spanDays ? Math.max(1, st.spanDays / 7) : 1;
    st.wastedPerWeek = st.wasted / st.weeksCovered;
    st.usedPct = st.added ? st.meals / st.added : null;

    /* money. A semester of 20-a-week is a known price, so every wasted swipe
       can be given a dollar value. */
    st.semesterCost = SEMESTER_COST;
    st.semesterSwipes = 20 * SEMESTER_WEEKS;
    st.costPerSwipeFull = SEMESTER_COST / st.semesterSwipes;
    // what a swipe costs when none are wasted. What you actually paid for the
    // ones you ate is that base price grossed up by the share that got eaten:
    // waste you paid for and did not eat, so it loads onto the rest.
    st.usedShare = st.added ? Math.min(1, st.meals / st.added) : 1;
    st.costPerSwipeUsed = st.usedShare ? st.costPerSwipeFull / st.usedShare : null;
    st.wastePremium = st.costPerSwipeUsed ? st.costPerSwipeUsed / st.costPerSwipeFull - 1 : 0;
    st.wastedDollars = st.wasted * st.costPerSwipeFull;
    st.wastedDollarsPerWeek = st.wastedPerWeek * st.costPerSwipeFull;
    st.wastedShareOfSemester = st.wastedDollars / SEMESTER_COST;

    /* meals per calendar day across the whole covered span, including the
       days you never swiped — those zeroes are the whole point. */
    st.perDayBuckets = [0, 0, 0, 0, 0]; // 0, 1, 2, 3, 4+
    st.daysWithFourPlus = 0;
    if (st.first && st.last) {
      var cur = new Date(st.first.getFullYear(), st.first.getMonth(), st.first.getDate());
      var end = new Date(st.last.getFullYear(), st.last.getMonth(), st.last.getDate());
      while (cur <= end) {
        var c = st.dayTotals[dayKey(cur)] || 0;
        st.perDayBuckets[Math.min(4, c)]++;
        cur.setDate(cur.getDate() + 1);
      }
    }

    st.halls.forEach(function (H, i) {
      H.color = colorFor(H.name, i);
      H.share = H.points / st.meals;
      H.first = firstByHall[H.name];
      H.last = lastByHall[H.name];
      H.days = Object.keys(hallDays[H.name]).length;
      H.peakHour = H.hours.indexOf(Math.max.apply(null, H.hours));
      H.perWeek = st.spanDays ? H.points / (st.spanDays / 7) : H.points;
      var gap = H.perWeek ? Math.max(0, Math.round((st.perWeek / H.perWeek - 1) * 100)) : 0;
      H.gapWeeks = isFinite(gap) && H.points > 4 ? gap : 0;
    });
    st.halls.sort(function (a, b) { return b.points - a.points; });

    // which hall owned each hour (used by the hour-chart tooltip)
    st.hourTopHall = [];
    for (var hh = 0; hh < 24; hh++) {
      var bestH = null, bestV = 0;
      st.halls.forEach(function (H) {
        if (H.hours[hh] > bestV) { bestV = H.hours[hh]; bestH = H; }
      });
      st.hourTopHall[hh] = bestV ? { hall: bestH.name, color: bestH.color, points: bestV } : null;
    }

    // longest run of consecutive days with at least one swipe
    var run = 0, prev = null, best = 0;
    keys.forEach(function (k) {
      var p = k.split('-');
      var u = Date.UTC(+p[0], +p[1] - 1, +p[2]);
      if (prev != null && u - prev === 86400000) run++; else run = 1;
      if (run > best) best = run;
      prev = u;
    });
    st.longestStreak = best;

    var dk = Object.keys(st.dayTotals), wk = Object.keys(st.weekTotals);
    st.bestDay = dk.reduce(function (a, b) { return st.dayTotals[b] > st.dayTotals[a] ? b : a; });
    st.bestDayCount = st.dayTotals[st.bestDay];
    st.bestWeek = wk.reduce(function (a, b) { return st.weekTotals[b] > st.weekTotals[a] ? b : a; });
    st.bestWeekCount = st.weekTotals[st.bestWeek];

    st.peakHour = st.hours.indexOf(Math.max.apply(null, st.hours));
    st.peakDow = st.dow.indexOf(Math.max.apply(null, st.dow));

    // share of meals by daypart (descending)
    st.dayparts.forEach(function (d) { d.share = d.points / st.meals; });
    st.topDaypart = st.dayparts.slice().sort(function (a, b) { return b.points - a.points; })[0];

    st.topHall = st.halls[0];
    st.runnerUp = st.halls[1];

    // first-third vs last-third monthly share, per hall (how habits drifted)
    var n = st.months.length;
    var cut = Math.max(1, Math.floor(n / 3));
    st.headMonths = st.months.slice(0, cut);
    st.tailMonths = st.months.slice(n - cut);
    st.halls.forEach(function (H) {
      H.headShare = avgShare(st, H, st.headMonths);
      H.tailShare = avgShare(st, H, st.tailMonths);
      H.delta = H.tailShare - H.headShare;
    });

    // month in which the lead hall changed hands
    st.crossover = null;
    var leader = null;
    st.months.forEach(function (mk, i) {
      var m = st.monthIndex[mk];
      var top = null, topV = -1;
      Object.keys(m.halls).forEach(function (hName) {
        if (m.halls[hName] > topV) { topV = m.halls[hName]; top = hName; }
      });
      if (leader && top && top !== leader && i > 0) st.crossover = { month: mk, from: leader, to: top };
      leader = top || leader;
    });
    st.leaderByMonth = st.months.map(function (mk) {
      var m = st.monthIndex[mk], top = null, topV = -1;
      Object.keys(m.halls).forEach(function (hName) {
        if (m.halls[hName] > topV) { topV = m.halls[hName]; top = hName; }
      });
      return { key: mk, leader: top, points: topV };
    });

    /* week-level equivalents for the week-to-week flow */
    st.weekKeys = Object.keys(st.weekIndex).sort();
    st.leaderByWeek = st.weekKeys.map(function (wk) {
      var w = st.weekIndex[wk], top = null, topV = -1;
      Object.keys(w.halls).forEach(function (hName) {
        if (w.halls[hName] > topV) { topV = w.halls[hName]; top = hName; }
      });
      return { key: wk, leader: top, points: topV };
    });

    return st;
  }

  function avgShare(st, H, months) {
    var t = 0, c = 0;
    months.forEach(function (mk) {
      var m = st.monthIndex[mk];
      if (!m || !m.total) return;
      t += (H.months[mk] || 0) / m.total; c++;
    });
    return c ? t / c : 0;
  }

  function weekKey(d) {
    // Week runs Monday 3 AM to next Monday 2:59 AM; 2 AM Monday is still part of previous week
    var t = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    var x = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return dayKey(x);
  }
  function weekLabel(key) {
    var d = new Date(key + 'T12:00:00');
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }
  function weekShort(key) {
    var d = new Date(key + 'T12:00:00');
    return d.getDate();
  }

  /* ─────────────────────────── charts ─────────────────────────── */

  var tip = $('#tip');
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var x = evt.clientX + 14, y = evt.clientY - r.height - 12;
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y < 8) y = evt.clientY + 18;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = y + 'px';
  }
  function hideTip() { tip.hidden = true; }

  /* 24-hour bar chart with daypart shading */
  function hourChart(st) {
    var W = 980, H = 330, m = { t: 26, r: 8, b: 34, l: 40 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = Math.max.apply(null, st.hours) || 1;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.appendChild(el('title', {}, [document.createTextNode('Meals by hour of day')]));

    // daypart bands
    [[0, 4], [5, 10], [11, 15], [16, 20], [21, 23]].forEach(function (span) {
      var x1 = m.l + span[0] * (iw / 24), x2 = m.l + (span[1] + 1) * (iw / 24);
      svg.appendChild(el('rect', {
        x: x1, y: m.t, width: x2 - x1, height: ih,
        fill: '#ffffff', opacity: .028, rx: 6
      }));
    });
    // gridlines
    var step = max <= 8 ? 2 : max <= 24 ? 5 : 10;
    for (var v = 0; v <= max + step; v += step) {
      var y = m.t + ih - (v / max) * ih;
      svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: '#ffffff', 'stroke-opacity': .09 }));
      var t = el('text', { x: m.l - 8, y: y + 4, class: 'axis', 'text-anchor': 'end' });
      t.textContent = v;
      svg.appendChild(t);
    }
    var bw = iw / 24;
    st.hours.forEach(function (v, hour) {
      var bh = (v / max) * ih;
      var x = m.l + hour * bw;
      var g = el('g');
      var isPeak = hour === st.peakHour;
      g.appendChild(el('rect', {
        x: x + 2, y: m.t + ih - bh, width: bw - 4, height: Math.max(bh, v ? 2 : 0),
        rx: 4, class: 'bar' + (isPeak ? ' peak' : ''),
        fill: isPeak ? '#ffffff' : 'url(#hgrad)', opacity: isPeak ? 1 : .92
      }));
      if (isPeak) {
        var lab = el('text', { x: x + bw / 2, y: m.t + ih - bh - 9, class: 'axis mid', fill: '#fff', 'font-weight': 700 });
        lab.textContent = num(v) + (v === 1 ? ' meal' : ' meals');
        svg.appendChild(lab);
      }
      g.addEventListener('mousemove', function (e) {
        var top = st.hourTopHall[hour];
        showTip(e, '<b>' + clock(hour) + '</b><div class="r"><span>Meals</span><span>' + num(v) +
          '</span></div>' + (top ? '<div class="r"><span>Top hall</span><span>' + top.hall +
            ' (' + num(top.points) + ')</span></div>' : ''));
      });
      g.addEventListener('mouseleave', hideTip);
      svg.appendChild(g);
      if (hour % 3 === 0 || hour === 23) {
        var xl = el('text', { x: x + bw / 2, y: H - 12, class: 'axis mid' });
        xl.textContent = clock(hour);
        svg.appendChild(xl);
      }
    });
    var defs = el('defs');
    var g1 = el('linearGradient', { id: 'hgrad', x1: 0, y1: 0, x2: 0, y2: 1 });
    g1.appendChild(el('stop', { offset: '0%', 'stop-color': '#c4b5fd' }));
    g1.appendChild(el('stop', { offset: '100%', 'stop-color': '#6d28d9' }));
    defs.appendChild(g1);
    svg.appendChild(defs);

    var wrap = h('div');
    wrap.appendChild(svg);
    var leg = h('div', 'leg');
    DAYPARTS.forEach(function (d) {
      var n = st.dayparts[DAYPARTS.indexOf(d)].points;
      var item = h('div');
      item.innerHTML = '<i style="--c:' + d.color + '"></i>' + d.name + ' · ' + num(n);
      leg.appendChild(item);
    });
    wrap.appendChild(leg);
    return wrap;
  }

  /* doughnut */
  function donut(items, size) {
    var S = size || 220, R = S / 2 - 8, cx = S / 2, cy = S / 2, r0 = R * 0.58;
    var svg = el('svg', { viewBox: '0 0 ' + S + ' ' + S, style: 'width:100%;max-width:' + S + 'px;margin:0 auto' });
    var total = items.reduce(function (a, b) { return a + b.points; }, 0) || 1;
    var a0 = -Math.PI / 2;
    items.forEach(function (it) {
      var frac = it.points / total;
      var a1 = a0 + frac * Math.PI * 2;
      var large = frac > .5 ? 1 : 0;
      var p = [
        'M', cx + Math.cos(a0) * R, cy + Math.sin(a0) * R,
        'A', R, R, 0, large, 1, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R,
        'L', cx + Math.cos(a1) * r0, cy + Math.sin(a1) * r0,
        'A', r0, r0, 0, large, 0, cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0, 'Z'
      ].join(' ');
      var path = el('path', { d: p, fill: it.color, class: 'bar', style: 'transform-origin:' + cx + 'px ' + cy + 'px' });
      path.addEventListener('mousemove', function (e) {
        showTip(e, '<b>' + it.name + '</b><div class="r"><span>Meals</span><span>' + num(it.points) +
          '</span></div><div class="r"><span>Share</span><span>' + pct(it.points / total * 100) + '</span></div>');
      });
      path.addEventListener('mouseleave', hideTip);
      svg.appendChild(path);
      a0 = a1;
    });
    var t1 = el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', fill: '#fff', 'font-size': 26, 'font-weight': 800 });
    t1.textContent = num(total);
    var t2 = el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', class: 'axis' });
    t2.textContent = 'meals';
    svg.appendChild(t1); svg.appendChild(t2);
    return svg;
  }

  /* horizontal bars (day of week) */
  function dowChart(st) {
    var W = 420, rowH = 34, m = { t: 6, r: 46, b: 6, l: 44 };
    var ih = rowH * 7, iw = W - m.l - m.r;
    var max = Math.max.apply(null, st.dow) || 1;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + (ih + m.t + m.b), role: 'img' });
    svg.appendChild(el('title', {}, [document.createTextNode('Meals by day of week')]));
    var order = [1, 2, 3, 4, 5, 6, 0];
    order.forEach(function (d, i) {
      var v = st.dow[d], y = m.t + i * rowH, bw = (v / max) * iw;
      var lbl = el('text', { x: m.l - 10, y: y + rowH / 2 + 4, class: 'axis', 'text-anchor': 'end' });
      lbl.textContent = DOWS[d];
      if (d === st.peakDow) { lbl.setAttribute('fill', '#fff'); lbl.setAttribute('font-weight', '700'); }
      svg.appendChild(lbl);
      svg.appendChild(el('rect', { x: m.l, y: y + 6, width: iw, height: rowH - 14, rx: 7, fill: '#ffffff', opacity: .05 }));
      var g = el('g');
      g.appendChild(el('rect', {
        x: m.l, y: y + 6, width: Math.max(bw, v ? 3 : 0), height: rowH - 14, rx: 7,
        class: 'hbar', fill: d === st.peakDow ? '#fff' : 'url(#hgrad)'
      }));
      g.addEventListener('mousemove', function (e) {
        showTip(e, '<b>' + DOWS[d] + '</b><div class="r"><span>Meals</span><span>' + num(v) + '</span></div>');
      });
      g.addEventListener('mouseleave', hideTip);
      svg.appendChild(g);
      var val = el('text', { x: m.l + Math.max(bw, 0) + 8, y: y + rowH / 2 + 4, class: 'axis' });
      val.textContent = num(v);
      svg.appendChild(val);
    });
    return svg;
  }

  /* 7 x 24 heatmap */
  function heatmap(st) {
    var cell = 20, gap = 4, m = { t: 22, r: 8, b: 22, l: 40 };
    var iw = 24 * (cell + gap), ih = 7 * (cell + gap);
    var W = m.l + iw + m.r, H = m.t + ih + m.b;
    var max = 0;
    st.dowHour.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.appendChild(el('title', {}, [document.createTextNode('Meals by weekday and hour')]));
    for (var hIdx = 0; hIdx < 24; hIdx++) {
      if (hIdx % 4) continue;
      var tx = el('text', { x: m.l + hIdx * (cell + gap) + cell / 2, y: m.t - 8, class: 'axis mid' });
      tx.textContent = clock(hIdx);
      svg.appendChild(tx);
    }
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d, i) {
      var ty = el('text', { x: m.l - 8, y: m.t + i * (cell + gap) + cell / 2 + 4, class: 'axis', 'text-anchor': 'end' });
      ty.textContent = DOWS[d];
      svg.appendChild(ty);
      for (var hh = 0; hh < 24; hh++) heatCell(svg, st, d, hh, i, m, cell, gap, max);
    });
    return svg;
  }

  /* One heatmap cell. Takes d/hh by argument: they must not come from the
     enclosing loop's `var`s, or every cell reports the same hour. */
  function heatCell(svg, st, d, hh, i, m, cell, gap, max) {
    var v = st.dowHour[d][hh];
    var x = m.l + hh * (cell + gap), y = m.t + i * (cell + gap);
    var g = el('g');
    g.appendChild(el('rect', {
      x: x, y: y, width: cell, height: cell, rx: 5,
      fill: v ? '#b36bff' : '#ffffff',
      'fill-opacity': v ? (0.16 + 0.84 * Math.pow(v / max, .7)) : 0.045
    }));
    g.addEventListener('mousemove', function (e) {
      showTip(e, '<b>' + DOWS[d] + ' · ' + clock(hh) + '</b><div class="r"><span>Meals</span><span>' +
        num(v) + '</span></div>');
    });
    g.addEventListener('mouseleave', hideTip);
    svg.appendChild(g);
  }

  /* smooth (monotone) cubic path segments through points, no leading moveto */
  function smoothSegs(pts) {
    if (pts.length < 2) return [];
    var n = pts.length, dx = [], dy = [], m2 = [], segs = [], i;
    for (i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x;
      dy[i] = pts[i + 1].y - pts[i].y;
    }
    var slope = function (i) { return dy[i] / (dx[i] || 1e-6); };
    var d = [];
    for (i = 0; i < n - 1; i++) d[i] = slope(i);
    m2[0] = d[0]; m2[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m2[i] = 0;
      else {
        var w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
        m2[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    for (i = 0; i < n - 1; i++) {
      var h3 = dx[i] / 3;
      segs.push('C' + (pts[i].x + h3) + ',' + (pts[i].y + m2[i] * h3) + ' ' +
        (pts[i + 1].x - h3) + ',' + (pts[i + 1].y - m2[i + 1] * h3) + ' ' +
        pts[i + 1].x + ',' + pts[i + 1].y);
    }
    return segs;
  }

  /* stacked, flowing area chart — month or week */
  function flowChart(st, mode) {
    var isWeek = mode === 'week';
    var periods = isWeek ? st.weekKeys : st.months;
    var index = isWeek ? st.weekIndex : st.monthIndex;
    var halls = st.halls;
    var W = 1060, H = 440, m = { t: 24, r: 20, b: 46, l: 46 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var share = mode === 'share' || mode === 'week';
    var n = periods.length;

    var totals = periods.map(function (pk) { return index[pk].total; });
    var ymax = share ? 100 : Math.max.apply(null, totals) || 1;
    var x = function (i) { return n === 1 ? m.l + iw / 2 : m.l + (i * iw) / (n - 1); };
    var y = function (v) { return m.t + ih - (v / ymax) * ih; };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.appendChild(el('title', {}, [document.createTextNode(
      (isWeek ? 'Week by week' : 'Month by month') + ' share of meals per dining hall')]));

    var gGrid = el('g');
    var gridVals = share ? [0, 25, 50, 75, 100] : niceTicks(ymax, 4);
    gridVals.forEach(function (v) {
      if (v > ymax) return;
      gGrid.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), stroke: '#ffffff', 'stroke-opacity': .09 }));
      var t = el('text', { x: m.l - 9, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
      t.textContent = v + (share ? '%' : '');
      gGrid.appendChild(t);
    });
    periods.forEach(function (pk, i) {
      var t = el('text', { x: x(i), y: H - 18, class: 'axis mid' });
      if (isWeek) {
        t.textContent = n > 14 ? weekShort(pk) : weekLabel(pk);
      } else {
        t.textContent = n > 14 ? monthLabel(pk).split(' ')[0] : monthLabel(pk);
      }
      svg.appendChild(t);
    });
    svg.appendChild(gGrid);

    // bands, bottom-up in rank order so the #1 hall hugs the baseline
    var gBands = el('g');
    var bands = [];
    var base = new Array(n).fill(0);
    halls.forEach(function (H2) {
      var vals = periods.map(function (pk) {
        var p = index[pk];
        var v = isWeek ? (H2.weeks[pk] || 0) : (H2.months[pk] || 0);
        return share ? (p.total ? (v / p.total) * 100 : 0) : v;
      });
      var lower = base.slice();
      var upper = base.map(function (b, i) { return b + vals[i]; });
      for (var i = 0; i < n; i++) base[i] = upper[i];
      bands.push({ hall: H2, vals: vals, lower: lower, upper: upper });
    });

    var clipId = 'flowclip';
    var defs = el('defs');
    var cp = el('clipPath', { id: clipId });
    var rect = el('rect', { x: m.l - 2, y: 0, width: 0, height: H });
    cp.appendChild(rect);
    defs.appendChild(cp);
    svg.appendChild(defs);

    bands.forEach(function (b) {
      var d;
      if (n === 1) {
        var bx = m.l + iw / 2 - iw * 0.22, bw = iw * 0.44;
        d = 'M' + bx + ',' + y(b.upper[0]) + 'H' + (bx + bw) + 'V' + y(b.lower[0]) + 'H' + bx + 'Z';
      } else {
        var up = b.upper.map(function (v, i) { return { x: x(i), y: y(v) }; });
        var lo = b.lower.map(function (v, i) { return { x: x(i), y: y(v) }; }).reverse();
        d = 'M' + up[0].x + ',' + up[0].y + smoothSegs(up).join('') +
          'L' + lo[0].x + ',' + lo[0].y + smoothSegs(lo).join('') + 'Z';
      }
      var path = el('path', { d: d, fill: b.hall.color, 'fill-opacity': .82, stroke: b.hall.color, 'stroke-width': 1, 'stroke-opacity': .5 });
      gBands.appendChild(path);
    });
    var gClip = el('g', { 'clip-path': 'url(#' + clipId + ')' });
    while (gBands.firstChild) gClip.appendChild(gBands.firstChild);
    svg.appendChild(gClip);
    requestAnimationFrame(function () {
      var t0 = performance.now(), dur = 1100;
      (function step(t) {
        var k = Math.max(0, Math.min(1, (t - t0) / dur));
        var e = 1 - Math.pow(1 - k, 3);
        rect.setAttribute('width', (iw + 6) * e);
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });

    // (the crossover is called out in the shift panel below the chart, not on
    // the bands themselves — an unlabelled dashed line here just looked broken)

    // hover crosshair
    var hov = el('g', { opacity: 0 });
    var line = el('line', { y1: m.t, y2: m.t + ih, stroke: '#fff', 'stroke-opacity': .5 });
    hov.appendChild(line);
    var dots = el('g');
    hov.appendChild(dots);
    svg.appendChild(hov);
    var hit = el('rect', { x: m.l - iw / (n > 1 ? (2 * (n - 1)) : 2), y: 0, width: iw + iw / (n > 1 ? (n - 1) : 1), height: H, fill: 'transparent' });
    svg.appendChild(hit);
    hit.addEventListener('mousemove', function (e) {
      var box = svg.getBoundingClientRect();
      var px = (e.clientX - box.left) * (W / box.width);
      var i = n === 1 ? 0 : Math.round(((px - m.l) / iw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      var pk = periods[i], p = index[pk];
      line.setAttribute('x1', x(i)); line.setAttribute('x2', x(i));
      while (dots.firstChild) dots.removeChild(dots.firstChild);
      bands.forEach(function (b) {
        dots.appendChild(el('circle', {
          cx: x(i), cy: y(b.upper[i]), r: 4, fill: b.hall.color, stroke: '#0b0710', 'stroke-width': 2
        }));
      });
      hov.setAttribute('opacity', 1);
      var rows = bands.map(function (b) {
        return '<div class="r"><span>' + b.hall.name + '</span><span>' +
          (share ? pct(b.vals[i]) : num(b.vals[i])) + '</span></div>';
      }).join('');
      showTip(e, '<b>' + (isWeek ? weekLabel(pk) : monthLabel(pk)) + '</b>' + rows +
        '<div class="r" style="margin-top:.35rem;border-top:1px solid rgba(255,255,255,.15);padding-top:.35rem">' +
        '<span>Total</span><span>' + num(mth.total) + '</span></div>');
    });
    hit.addEventListener('mouseleave', function () { hov.setAttribute('opacity', 0); hideTip(); });

    var wrap = h('div');
    wrap.appendChild(svg);
    var leg = h('div', 'leg');
    var bandEls = Array.prototype.slice.call(gClip.querySelectorAll('path'));
    halls.forEach(function (H2, hi) {
      var it = h('div');
      it.innerHTML = '<i style="--c:' + H2.color + '"></i>' + H2.name +
        ' <span class="leg-p">' + pct(H2.share * 100) + '</span>';
      it.tabIndex = 0;
      /* hovering a legend entry says who that band is for every month, so a
         hall can never look missing from the chart */
      var focus = function (e) {
        bandEls.forEach(function (p, pi) { p.style.opacity = pi === hi ? '1' : '.22'; });
        var peak = periods.reduce(function (a, pk) {
          var v = isWeek ? (H2.weeks[pk] || 0) : (H2.months[pk] || 0);
          return v > a.v ? { v: v, pk: pk } : a;
        }, { v: 0, pk: periods[0] });
        showTip(e, '<b>' + H2.name + '</b>' +
          '<div class="r"><span>Meals</span><span>' + num(H2.points) + '</span></div>' +
          '<div class="r"><span>Share</span><span>' + pct(H2.share * 100) + '</span></div>' +
          '<div class="r"><span>Best ' + (isWeek ? 'week' : 'month') + '</span><span>' +
          (isWeek ? weekLabel(peak.pk) : monthLabel(peak.pk)) + ' · ' + num(peak.v) + '</span></div>' +
          '<div class="r"><span>Days</span><span>' + num(H2.days) + '</span></div>');
      };
      var blur = function () {
        bandEls.forEach(function (p) { p.style.opacity = ''; });
        hideTip();
      };
      it.addEventListener('mousemove', focus);
      it.addEventListener('mouseleave', blur);
      it.addEventListener('focus', focus);
      it.addEventListener('blur', blur);
      leg.appendChild(it);
    });
    wrap.appendChild(leg);
    return wrap;
  }

  function niceTicks(max, count) {
    var raw = max / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    var out = [];
    for (var v = 0; v <= max; v += step) out.push(Math.round(v));
    return out;
  }

  function monthlyBars(st) {
    var W = 1060, H = 300, m = { t: 20, r: 20, b: 46, l: 40 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var months = st.months, n = months.length;
    var totals = months.map(function (mk) { return st.monthIndex[mk].total; });
    var max = Math.max.apply(null, totals) || 1;
    var bw = iw / n;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.appendChild(el('title', {}, [document.createTextNode('Meals per month')]));
    months.forEach(function (mk, i) {
      var v = totals[i], bh = (v / max) * ih;
      var g = el('g');
      var rect = el('rect', {
        x: m.l + i * bw + bw * 0.2, y: m.t + ih - bh, width: bw * 0.6,
        height: Math.max(bh, 2), rx: 6, class: 'bar', fill: 'url(#hgrad)'
      });
      g.appendChild(rect);
      var t = el('text', { x: m.l + i * bw + bw / 2, y: H - 20, class: 'axis mid' });
      t.textContent = monthLabel(mk);
      svg.appendChild(g); svg.appendChild(t);
      g.addEventListener('mousemove', function (e) {
        showTip(e, '<b>' + monthLabel(mk) + '</b><div class="r"><span>Meals</span><span>' + num(v) + '</span></div>');
      });
      g.addEventListener('mouseleave', hideTip);
    });
    var defs = el('defs');
    var g1 = el('linearGradient', { id: 'hgrad', x1: 0, y1: 0, x2: 0, y2: 1 });
    g1.appendChild(el('stop', { offset: '0%', 'stop-color': '#c4b5fd' }));
    g1.appendChild(el('stop', { offset: '100%', 'stop-color': '#6d28d9' }));
    defs.appendChild(g1);
    svg.appendChild(defs);
    return svg;
  }

  /* ─────────────────────────── rendering ─────────────────────────── */

  function countUp(node, value, fmt) {
    var t0 = performance.now(), dur = 1200;
    fmt = fmt || num;
    function paint(k) {
      var e = 1 - Math.pow(1 - k, 4);
      node.textContent = fmt(Math.round(value * e));
    }
    (function step(t) {
      var k = Math.max(0, Math.min(1, (t - t0) / dur));
      paint(k);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
    // rAF stalls in background tabs; make sure the real number always lands
    setTimeout(function () { paint(1); }, dur + 250);
  }

  /* "an Andrews person" but "The Ratty person" — a name starting with The
     supplies its own article, so don't prepend one. */
  function article(name) {
    if (/^the\s/i.test(name)) return '';
    return /^[aeiou]/i.test(name) ? 'an' : 'a';
  }

  var current = null;

  function render(st, sources) {
    current = st;
    $('#report').hidden = false;
    $('#intro').hidden = true;

    /* hero */
    var months = st.months.length;
    $('#range').textContent = monthLabel(st.months[0]) + ' — ' + monthLabel(st.months[months - 1]) +
      ' · ' + months + (months === 1 ? ' month' : ' months') + ' · ' + plural(sources.length, 'file');
    countUp($('#totalSwipes'), st.meals);
    $('#heroLede').innerHTML = 'That’s <em>' + plural(st.activeDays, 'day') + '</em> of eating on campus, ' +
      'up to <em>' + plural(st.bestDayCount, 'meal') + ' in a single day</em>. ' +
      'Your hall habits did not stay still — scroll on.';
    var pills = [
      ['Total credits burned', num(st.meals)],
      ['Average week', st.perWeek.toFixed(1) + ' meals'],
      ['Longest streak', plural(st.longestStreak, 'day')],
      ['Busiest day', DOWS[st.peakDow]],
      ['Peak hour', clock(st.peakHour)]
    ];
    if (st.credits.length) pills.push(['Plan resets', num(st.credits.length)]);
    var pw = $('#heroPills');
    pw.innerHTML = '';
    pills.forEach(function (p) {
      var pill = h('div', 'pill');
      pill.appendChild(h('b', null, p[1]));
      pill.appendChild(document.createTextNode(' ' + p[0]));
      pw.appendChild(pill);
    });

    /* #1 hall */
    var top = st.topHall;
    $('#topHallName').innerHTML = top.name + '.';
    $('#topHallLede').innerHTML = '<em>' + num(top.points) + '</em> meals — ' + pct(top.share * 100) +
      ' of everything you swiped' + (st.runnerUp ? ', ahead of ' + st.runnerUp.name +
      ' by ' + num(top.points - st.runnerUp.points) : '') + '.';
    var board = $('#hallBoard');
    board.innerHTML = '';
    st.halls.forEach(function (H, i) {
      var row = h('div', 'rank' + (i === 0 ? ' first' : ''));
      row.style.setProperty('--c', H.color);
      row.appendChild(h('div', 'num', '#' + (i + 1)));
      row.appendChild(h('div', 'nm', H.name));
      row.appendChild(h('div', 'meta', num(H.points) + ' · ' + pct(H.share * 100)));
      var track = h('div', 'track');
      var fill = h('div', 'fill');
      fill.style.setProperty('--w', H.points / st.halls[0].points);
      fill.style.transitionDelay = (i * 0.09) + 's';
      track.appendChild(fill);
      row.appendChild(track);
      board.appendChild(row);
    });
    $('#hallCaption').textContent = top.days >= st.activeDays
      ? 'You basically lived in ' + top.name + ' — it was the scene every single day you ate on campus.'
      : top.days >= st.activeDays * 0.6
        ? 'You showed up in ' + top.name + ' on ' + num(top.days) + ' of your ' + num(st.activeDays) +
          ' eating days (' + pct(top.days / st.activeDays * 100) + ').'
        : 'Not a monoculture: ' + top.name + ' took the crown, but you kept the other halls open too — ' +
          st.halls.slice(0, 3).map(function (H) { return H.name; }).join(', ') + ' all got real minutes.';

    /* when */
    var peakDowName = DOWS[st.peakDow];
    $('#whenHeadline').textContent = 'Your peak was ' + clock(st.peakHour) + ' on a ' + peakDowName + '.';
    var bestDay = new Date(st.bestDay + 'T12:00:00');
    var whenCards = [
      { k: 'Most meals in a day', v: num(st.bestDayCount), d: longDate(bestDay) },
      { k: 'Busiest day of the week', v: peakDowName, d: num(st.dow[st.peakDow]) + ' meals over ' +
          plural(countWeekdays(st, st.peakDow), DOWS_FULL[st.peakDow]) },
      { k: 'Busiest month', v: monthLabelLong(busiestMonth(st)), d: num(st.monthIndex[busiestMonth(st)].total) + ' meals' },
      { k: 'Longest on-plan streak', v: plural(st.longestStreak, 'day'), d: st.longestStreak >= st.activeDays
          ? 'You never missed a day'
          : 'longest run without missing one' },
      { k: 'Heaviest week', v: num(st.bestWeekCount), d: 'week of ' + shortDate(new Date(st.bestWeek + 'T12:00:00')) },
      { k: 'Earliest swipe', v: clock(st.earliestH % 24, st.earliest.getMinutes()),
        d: longDate(st.earliest) },
      { k: 'Latest swipe', v: clock(st.latestH % 24, st.latest.getMinutes()),
        d: longDate(st.latest) },
      { k: 'You are a', v: persona(st), d: st.topDaypart.name + ' person · ' + pct(st.topDaypart.share * 100) + ' of meals' }
    ];
    var wc = $('#whenCards');
    wc.innerHTML = '';
    whenCards.forEach(function (c) {
      var card = h('div', 'card');
      card.appendChild(h('div', 'k', c.k));
      card.appendChild(h('div', 'v', c.v));
      card.appendChild(h('div', 'd', c.d));
      wc.appendChild(card);
    });

    /* swipe economy */
    renderWaste(st);

    /* hours */
    $('#hoursHeadline').textContent = st.hours[st.peakHour] >= st.meals * 0.2
      ? 'You basically eat at ' + clock(st.peakHour) + '.'
      : 'No single hour rules you — you graze all day.';
    var hc = $('#hourChartCard');
    hc.innerHTML = '<h3>Meals by hour</h3><p class="sub">Every swipe, bucketed by the clock on the receipt.</p>';
    hc.appendChild(hourChart(st));
    var dpc = $('#daypartCard');
    dpc.innerHTML = '<h3>Your dayparts</h3><p class="sub">' + pct(st.topDaypart.share * 100) +
      ' of meals land in ' + st.topDaypart.name.toLowerCase() + '.</p>';
    dpc.appendChild(donut(st.dayparts));
    var leg = h('div', 'leg');
    st.dayparts.forEach(function (d) {
      var it = h('div');
      it.innerHTML = '<i style="--c:' + d.color + '"></i>' + d.name + ' ' + pct(d.share * 100);
      leg.appendChild(it);
    });
    dpc.appendChild(leg);
    var dwc = $('#dowCard');
    dwc.innerHTML = '<h3>Meals by weekday</h3><p class="sub">' + peakDowName + ' is your heavy day.</p>';
    dwc.appendChild(dowChart(st));

    /* heatmap */
    $('#heatHeadline').textContent = st.longestStreak >= st.activeDays
      ? 'You never skipped a day.'
      : 'Your week has a shape.';
    var heat = $('#heatCard');
    heat.innerHTML = '<h3>Weekday × hour</h3><p class="sub">Brighter means busier. Hover any square.</p>';
    heat.appendChild(heatmap(st));
    $('#heatCaption').textContent = quietestNote(st);

    /* breakdown */
    $('#breakHeadline').textContent = st.halls.length + (st.halls.length === 1 ? ' hall' : ' halls') +
      ', ' + plural(st.activeDays, 'day') + ', ' + plural(st.meals, 'meal') + '.';
    var bg = $('#breakGrid');
    bg.innerHTML = '';
    st.halls.forEach(function (H) {
      var card = h('div', 'hall');
      card.style.setProperty('--c', H.color);
      card.innerHTML =
        '<div class="h-nm">' + H.name + '</div>' +
        '<div class="h-sh">' + pct(H.share * 100) + '</div>' +
        '<div class="h-sw">' + num(H.points) + ' meals · peak ' + clock(H.peakHour) + '</div>' +
        '<dl>' +
        '<dt>First visit</dt><dd>' + monthLabel(monthKey(H.first)) + '</dd>' +
        '<dt>Last visit</dt><dd>' + monthLabel(monthKey(H.last)) + '</dd>' +
        '<dt>Days visited</dt><dd>' + num(H.days) + '</dd>' +
        '<dt>Per week</dt><dd>' + H.perWeek.toFixed(1) + '</dd>' +
        '<dt>Trend</dt><dd>' + trend(H) + '</dd>' +
        '</dl>';
      bg.appendChild(card);
    });

    /* flow */
    renderFlow(st);
    var fp = $('#shiftPanel');
    fp.innerHTML = '';
    if (st.months.length >= 2) {
      fp.appendChild(h('p', 'kicker', 'First ' + st.headMonths.length + ' months vs last ' + st.tailMonths.length + ' months'));
      var maxShare = Math.max.apply(null, st.halls.map(function (X) {
        return Math.max(X.headShare, X.tailShare);
      })) || 1;
      st.halls.slice(0, 5).forEach(function (H) {
        var row = h('div', 'shift-row');
        row.style.setProperty('--c', H.color);
        var d = Math.round(H.delta * 100);
        var head = h('div', 'sr-h');
        head.appendChild(h('span', null, H.name));
        head.appendChild(h('small', null, pct(H.headShare * 100) + ' → ' + pct(H.tailShare * 100) +
          ' (' + (d > 0 ? '+' : '') + d + ' pts)'));
        row.appendChild(head);
        var dual = h('div', 'dual');
        [H.headShare, H.tailShare].forEach(function (share, idx) {
          var lane = h('div', 'lane');
          var bar = h('i');
          bar.style.setProperty('--c', H.color);
          bar.style.opacity = idx === 0 ? '.45' : '1';
          bar.style.transitionDelay = (idx * 0.12) + 's';
          bar.style.setProperty('--w', share / maxShare);
          lane.appendChild(bar);
          dual.appendChild(lane);
        });
        row.appendChild(dual);
        fp.appendChild(row);
      });
      if (st.crossover) {
        var note = h('div', 'shift-row');
        note.appendChild(h('div', 'sr-h')).appendChild(h('span', null, 'The switch'));
        var p = h('p', 'caption');
        p.style.margin = '0';
        p.innerHTML = st.crossover.from + ' had you in ' + monthLabelLong(st.crossover.month) +
          ', but <b>' + st.crossover.to + '</b> walked in and never left. That one month is where your whole food year turns over.';
        note.appendChild(p);
        fp.appendChild(note);
      }
    }

    /* outro */
    var outroName = st.months.length > 1 && st.leaderByMonth[st.leaderByMonth.length - 1].leader !== st.topHall.name
      ? st.leaderByMonth[st.leaderByMonth.length - 1].leader : st.topHall.name;
    $('#outroHeadline').textContent = st.topHall.name + ' → ' + outroName + '.';
    $('#summary').textContent = summaryText(st, sources);

    buildDots();
    observe();
  }

  function trend(H) {
    var d = Math.round(H.delta * 100);
    if (Math.abs(d) < 3) return '<span class="trend flat">holding steady</span>';
    return '<span class="trend ' + (d > 0 ? 'up">▲ climbing' : 'down">▼ cooling') +
      ' ' + Math.abs(d) + ' pts</span>';
  }

  function busiestMonth(st) {
    return st.months.reduce(function (a, b) {
      return st.monthIndex[b].total > st.monthIndex[a].total ? b : a;
    }, st.months[0]);
  }

  /* ── money: the semester price, and how much of it went nowhere ── */
  function renderCost(st) {
    var box = $('#costCard');
    box.innerHTML = '<h3>What it cost</h3>' +
      '<p class="sub">A semester on the 20-a-week plan is a flat price, so every swipe has a ' +
      'number attached — including the ones nobody ate.</p>';

    var haveWaste = st.added > 0 && st.wasted > 0;
    var usedShare = haveWaste ? st.meals / (st.meals + st.wasted) : 1;

    /* 1. the semester as one bar: what you ate vs what expired */
    var W = 900, H = 74, bw = 720, x0 = 24, y = 30, bh = 34;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', class: 'costbar' });
    svg.appendChild(el('title', {}, [document.createTextNode(
      num(st.meals) + ' swipes used, ' + num(st.wasted) + ' expired')]));
    var defs = el('defs');
    var g1 = el('linearGradient', { id: 'usedgrad', x1: '0', y1: '0', x2: '1', y2: '0' });
    g1.appendChild(el('stop', { offset: '0', 'stop-color': '#4ade80' }));
    g1.appendChild(el('stop', { offset: '1', 'stop-color': '#22d3ee' }));
    defs.appendChild(g1);
    svg.appendChild(defs);

    if (haveWaste) {
      var wUsed = bw * usedShare, wLost = bw - wUsed;
      svg.appendChild(el('rect', { x: x0, y: y, width: wUsed, height: bh, rx: 8, fill: 'url(#usedgrad)' }));
      svg.appendChild(el('rect', { x: x0 + wUsed, y: y, width: wLost, height: bh, rx: 8,
        fill: '#ff5c7a', 'fill-opacity': .92, class: 'lost' }));
      var tUsed = el('text', { x: x0 + 14, y: y + 23, class: 'axis', fill: '#06210f',
        'font-weight': 800 });
      tUsed.textContent = num(st.meals) + ' used';
      svg.appendChild(tUsed);
      var tLost = el('text', { x: x0 + bw - 14, y: y + 23, class: 'axis', 'text-anchor': 'end',
        fill: '#2b0510', 'font-weight': 800 });
      tLost.textContent = num(st.wasted) + ' expired';
      svg.appendChild(tLost);
      var lostG = el('g');
      lostG.appendChild(el('rect', { x: x0 + wUsed, y: y, width: wLost, height: bh, fill: 'transparent' }));
      lostG.addEventListener('mousemove', function (e) {
        showTip(e, '<b>' + money(st.wastedDollars) + ' of swipes</b>' +
          '<div class="r"><span>Swipes</span><span>' + num(st.wasted) + '</span></div>' +
          '<div class="r"><span>At</span><span>' + money(st.costPerSwipeFull, true) + '</span></div>' +
          '<div class="r"><span>Per week</span><span>' + money(st.wastedDollarsPerWeek) + '</span></div>');
      });
      svg.appendChild(lostG);
    } else {
      svg.appendChild(el('rect', { x: x0, y: y, width: bw, height: bh, rx: 8, fill: 'url(#usedgrad)' }));
    }
    var scale = el('text', { x: x0, y: y + bh + 20, class: 'axis' });
    scale.textContent = haveWaste
      ? 'The whole run: ' + num(st.meals + st.wasted) + ' swipes you were given, and what happened to them'
      : 'Every swipe you were given, and every single one got used';
    svg.appendChild(scale);
    box.appendChild(svg);

    /* 2. the price list */
    var rows = [
      { k: 'One semester, 20 a week', v: money(st.semesterCost, true),
        d: plural(st.semesterSwipes, 'swipe') + ' for the term' },
      { k: 'If you used every one', v: money(st.costPerSwipeFull, true),
        d: 'a swipe, priced out' },
      { k: 'What you paid per swipe', v: money(st.costPerSwipeUsed, true),
        d: st.wasted ? pct(st.wastePremium * 100) + ' on the base price'
          : 'nothing wasted, so the base price stands' },
      { k: 'Went in the bin', v: haveWaste ? money(st.wastedDollars) : '—',
        d: haveWaste ? pct(st.wastedShareOfSemester * 100) + ' of a whole semester' : 'nothing expired' }
    ];
    var t = h('div', 'costgrid');
    rows.forEach(function (r) {
      var cell = h('div', 'costcell' + (r.k === 'Went in the bin' ? ' lost' : ''));
      cell.appendChild(h('div', 'k', r.k));
      cell.appendChild(h('div', 'v', r.v));
      cell.appendChild(h('div', 'd', r.d));
      t.appendChild(cell);
    });
    box.appendChild(t);

    $('#costCaption').textContent = !haveWaste
      ? 'Nothing expired, so the plan did exactly what it was supposed to. Full price, full use — ' +
        money(st.costPerSwipeFull, true) + ' a swipe, no markup for anything you never touched.'
      : 'That is ' + money(st.wastedDollars) + ' of a ' + money(st.semesterCost) + ' semester spent on ' +
        'swipes that hit the reset untouched — about ' + money(st.wastedDollarsPerWeek) + ' every week, ' +
        'for nothing. A clean run prices out at ' + money(st.costPerSwipeFull, true) + ' a swipe; you ' +
        'ate ' + pct(st.usedShare * 100, 0) + ' of what you were given, so every swipe you actually ' +
        'had cost ' + money(st.costPerSwipeUsed, true) + ' — ' + pct(st.wastePremium * 100) + ' on the base price.';
  }

  /* ── swipe economy: what got added, what got used, what expired ── */
  function renderWaste(st) {
    var haveResets = st.added > 0;
    var weeks = st.weeksCovered;
    $('#wasteHeadline').textContent = !haveResets
      ? 'Your statement has no swipe resets.'
      : st.wasted === 0
        ? 'You wasted nothing. Every swipe got used.'
        : 'You wasted ' + num(st.wasted) + (st.wasted === 1 ? ' swipe.' : ' swipes.');

    var cards = [
      { k: 'Swipes added', v: haveResets ? num(st.added) : '—',
        d: !haveResets ? 'no reset rows in this file'
          : st.budgetKnown ? num(st.weeklyBudget) + ' a week across ' + plural(st.creditCount, 'week')
            : 'sum of the reset amounts' },
      { k: 'Swipes used', v: num(st.meals),
        d: haveResets ? pct(st.meals / st.added * 100) + ' of everything you were given' : 'every swipe in the file' },
      { k: 'Swipes wasted', v: haveResets ? num(st.wasted) : '—',
        d: haveResets ? 'expired at the reset, never swiped' : 'unknown without reset rows' },
      { k: 'Wasted per week', v: haveResets ? st.wastedPerWeek.toFixed(1) : '—',
        d: haveResets ? 'averaged over ' + plural(Math.round(weeks), 'week') : 'unknown without reset rows' }
    ];
    var box = $('#wasteCards');
    box.innerHTML = '';
    cards.forEach(function (c) {
      var card = h('div', 'card');
      card.appendChild(h('div', 'k', c.k));
      card.appendChild(h('div', 'v', c.v));
      card.appendChild(h('div', 'd', c.d));
      box.appendChild(card);
    });

    var pdc = $('#perDayCard');
    pdc.innerHTML = '<h3>Meals per day</h3><p class="sub">Every calendar day you were enrolled, ' +
      'including the ones you never swiped.</p>';
    pdc.appendChild(perDayChart(st));

    var b = st.perDayBuckets;
    var mode = b.indexOf(Math.max.apply(null, b.slice(1))); // most common non-zero day
    var modeLabel = mode === 4 ? '4+ meals' : mode + (mode === 1 ? ' meal' : ' meals');
    var cap;
    if (!haveResets) {
      cap = 'This statement lists no swipe resets, so wasted swipes can’t be worked out. ' +
        'Add the earlier statement too if the resets live in a different export.';
    } else if (st.wasted === 0) {
      cap = 'Nothing expired. ' + (b[0] ? plural(b[0], 'day') + ' went completely unused, but every ' +
        'swipe you were given found a plate.' : 'Not one day went unused, and not one swipe expired.');
    } else {
      cap = (st.budgetKnown
        ? 'Your balance lands on ' + num(st.weeklyBudget) + ' after every reset, so that is the weekly ' +
          'allowance; the reset amounts are just the top-up. Over ' + plural(st.creditCount, 'week') +
          ' that is ' + num(st.added) + ' swipes. '
        : '') +
        'That’s about ' + st.wastedPerWeek.toFixed(1) + ' swipes a week expiring untouched. ' +
        'Your most common day was ' + modeLabel + ' (' + plural(b[mode], 'day') + '), and ' +
        (b[0] ? plural(b[0], 'day') + ' had no swipe on them at all.'
              : 'you never went a whole day without one.');
    }
    $('#wasteCaption').textContent = cap;
    renderCost(st);
  }

  /* histogram: how many days you used 0, 1, 2, 3 or 4+ swipes */
  function perDayChart(st) {
    var labels = ['0', '1', '2', '3', '4+'];
    var vals = st.perDayBuckets;
    var W = 900, H = 300, m = { t: 26, r: 20, b: 46, l: 46 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = Math.max.apply(null, vals) || 1;
    var bw = iw / vals.length;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.appendChild(el('title', {}, [document.createTextNode('Days by number of meals swiped')]));

    niceTicks(max, 4).forEach(function (v) {
      if (v > max) return;
      var y = m.t + ih - (v / max) * ih;
      svg.appendChild(el('line', { x1: m.l, x2: m.l + iw, y1: y, y2: y, stroke: '#ffffff', 'stroke-opacity': .09 }));
      var t = el('text', { x: m.l - 9, y: y + 4, class: 'axis', 'text-anchor': 'end' });
      t.textContent = v;
      svg.appendChild(t);
    });

    vals.forEach(function (v, i) {
      var bh = (v / max) * ih;
      var x = m.l + i * bw, g = el('g');
      g.appendChild(el('rect', {
        x: x + bw * 0.16, y: m.t + ih - bh, width: bw * 0.68,
        height: Math.max(bh, 2), rx: 7,
        class: 'bar', fill: i === 0 ? '#ff6b9d' : 'url(#pdgrad)'
      }));
      var vt = el('text', { x: x + bw / 2, y: m.t + ih - bh - 9, class: 'axis mid',
        fill: '#fff', 'font-weight': 700 });
      vt.textContent = num(v);
      svg.appendChild(vt);
      var lt = el('text', { x: x + bw / 2, y: H - 20, class: 'axis mid' });
      lt.textContent = labels[i] + (i === 4 ? ' meals' : i === 1 ? ' meal' : ' meals');
      svg.appendChild(lt);
      g.addEventListener('mousemove', function (e) {
        showTip(e, '<b>' + labels[i] + (i === 4 ? '+' : '') + ' ' + (i === 1 ? 'meal' : 'meals') + '</b>' +
          '<div class="r"><span>Days</span><span>' + num(v) + '</span></div>' +
          '<div class="r"><span>Share</span><span>' + pct(st.spanDays ? v / st.spanDays * 100 : 0) + '</span></div>');
      });
      g.addEventListener('mouseleave', hideTip);
      svg.appendChild(g);
    });

    var defs = el('defs');
    var g1 = el('linearGradient', { id: 'pdgrad', x1: 0, y1: 0, x2: 0, y2: 1 });
    g1.appendChild(el('stop', { offset: '0%', 'stop-color': '#c4b5fd' }));
    g1.appendChild(el('stop', { offset: '100%', 'stop-color': '#6d28d9' }));
    defs.appendChild(g1);
    svg.appendChild(defs);
    return svg;
  }

  function quietestNote(st) {
    var deadByDow = new Array(7).fill(0), dead = 0;
    for (var d = 0; d < 7; d++) {
      for (var hr = 0; hr < 24; hr++) if (!st.dowHour[d][hr]) { deadByDow[d]++; dead++; }
    }
    if (!dead) return 'You touched every single weekday-hour square. That is not normal.';
    var emptiest = 0;
    for (var i = 1; i < 7; i++) if (deadByDow[i] > deadByDow[emptiest]) emptiest = i;
    return dead + ' of 168 weekday-hour squares are empty. ' + DOWS[emptiest] + ' is your quietest day.';
  }
  function persona(st) {
    var dp = st.topDaypart.name;
    if (dp === 'Late night') return 'Midnight Person';
    if (dp === 'Dinner') return 'Evening Person';
    if (dp === 'Lunch') return 'Lunch Loyalist';
    return 'Early Bird';
  }

  function summaryText(st, sources) {
    var L = [];
    var months = st.months.length;
    L.push('DINING WRAPPED · ' + monthLabel(st.months[0]) + ' – ' + monthLabel(st.months[months - 1]));
    L.push('');
    L.push(num(st.meals) + ' meals across ' + st.activeDays + ' days on campus (' + st.perWeek.toFixed(1) + ' a week).');
    L.push('Hall ranking: ' + st.halls.map(function (H, i) {
      return (i + 1) + '. ' + H.name + ' ' + pct(H.share * 100);
    }).join('  ·  '));
    L.push('Peak hour: ' + clock(st.peakHour) + ' · busiest weekday: ' + DOWS[st.peakDow] +
      ' · busiest month: ' + monthLabel(busiestMonth(st)));
    L.push('Earliest swipe ' + clock(st.earliestH % 24, st.earliest.getMinutes()) +
      ' · latest swipe ' + clock(st.latestH % 24, st.latest.getMinutes()))
    if (st.added > 0) {
      L.push('Swipes: ' + num(st.weeklyBudget) + '/week across ' + plural(st.creditCount, 'week') +
        ' = ' + num(st.added) + ' added, ' + num(st.meals) + ' used, ' + num(st.wasted) +
        ' wasted (' + st.wastedPerWeek.toFixed(1) + ' a week).');
    }
    L.push('Days by meals: ' + st.perDayBuckets.map(function (v, i) {
      return (i === 4 ? '4+' : i) + '=' + v;
    }).join(' · '));
    L.push('Biggest day: ' + num(st.bestDayCount) + ' meals on ' + longDate(new Date(st.bestDay + 'T12:00:00')) +
      ' · longest streak: ' + plural(st.longestStreak, 'day'));
    var first = st.leaderByMonth[0], last = st.leaderByMonth[st.leaderByMonth.length - 1];
    if (first.leader && last.leader) {
      L.push('First month you were ' + article(first.leader) + ' ' + first.leader + ' person; by ' +
        monthLabel(last.key) + ' you were ' + article(last.leader) + ' ' + last.leader + ' person.');
    }
    if (st.crossover) {
      L.push('The turn: ' + st.crossover.to + ' overtook ' + st.crossover.from + ' in ' +
        monthLabelLong(st.crossover.month) + '.');
    }
    var movers = st.halls.slice().sort(function (a, b) { return b.delta - a.delta; });
    if (movers.length > 1 && Math.abs(movers[0].delta) > 0.03) {
      L.push('Biggest riser: ' + movers[0].name + ' (+' + Math.round(movers[0].delta * 100) +
        ' pts of share). Biggest faller: ' + movers[movers.length - 1].name + ' (' +
        Math.round(movers[movers.length - 1].delta * 100) + ' pts).');
    }
    L.push('');
    L.push('From ' + plural(sources.length, 'statement') + ' parsed locally.');
    return L.join('\n');
  }

  /* flow section + toggle */
  var flowMode = 'share';
function renderFlow(st) {
    var isWeek = flowMode === 'week';
    var periods = isWeek ? st.weekKeys : st.months;
    var leaders = isWeek ? st.leaderByWeek : st.leaderByMonth;
    var label = isWeek ? 'week' : 'month';
    var lead = leaders[leaders.length - 1].leader || st.topHall.name;
    $('#flowHeadline').innerHTML = periods.length >= 2
      ? 'You started ' + article(st.topHall.name) + ' <span style="color:' + st.topHall.color + '">' + st.topHall.name +
        '</span> person and finished ' + article(lead) + ' <span style="color:' + colorOf(st, lead) + '">' + lead + '</span> person.'
      : 'One ' + label + ' of data \u2014 here\u2019s the breakdown.';
    var card = $('#flowCard');
    var titles = { share: 'Share of meals, per hall', count: 'Swipes per ' + label + ', per hall', week: 'Share of meals, per hall (week)' };
    var subs = { share: 'Each band is one hall. Hover a ' + label + ' for the full split.',
      count: 'Each band is one hall. Hover a ' + label + ' for the full split.',
      week: 'Each band is one hall. Hover a week for the full split.' };
    card.innerHTML = '<h3>' + titles[flowMode] + '</h3><p class="sub">' + (periods.length >= 2
      ? subs[flowMode] : 'Upload a longer statement (or drop several files) to get the ' + label + '-to-' + label + ' flow.') + '</p>';
    if (periods.length >= 2) card.appendChild(flowChart(st, flowMode));
    else card.appendChild(monthlyBars(st));
  }
  function colorOf(st, name) {
    for (var i = 0; i < st.halls.length; i++) if (st.halls[i].name === name) return st.halls[i].color;
    return '#fff';
  }

  /* ─────────────────────────── nav + reveal ─────────────────────────── */

  function buildDots() {
    var nav = $('#dots');
    nav.innerHTML = '';
    Array.prototype.forEach.call(document.querySelectorAll('#report .screen'), function (sec) {
      var b = h('button', 'dot');
      b.type = 'button';
      b.innerHTML = '<span>' + sec.dataset.title + '</span><i></i>';
      b.addEventListener('click', function () { sec.scrollIntoView({ behavior: 'smooth' }); });
      nav.appendChild(b);
    });
    var secs = Array.prototype.slice.call(document.querySelectorAll('#report .screen'));
    var dots = Array.prototype.slice.call(nav.children);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = secs.indexOf(e.target);
        dots.forEach(function (d, j) { d.classList.toggle('on', i === j); });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    secs.forEach(function (s) { io.observe(s); });
  }

  var revealIO = null;
  function observe() {
    if (revealIO) revealIO.disconnect();
    revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
      });
    }, { threshold: 0.22 });
    Array.prototype.forEach.call(document.querySelectorAll('#report .screen'), function (s) {
      s.classList.add('reveal');
      revealIO.observe(s);
    });
  }

  /* ─────────────────────────── loading ─────────────────────────── */

  function msg(text, kind) {
    var m = $('#loadMsg');
    m.textContent = text;
    m.className = 'hint' + (kind ? ' ' + kind : '');
  }

  function loadFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) {
      return /\.(csv|txt|tsv)$/i.test(f.name) || /csv|text/i.test(f.type);
    });
    if (!list.length) { msg('Those files don’t look like CSVs.', 'err'); return; }
    var sets = [], credits = [], skipped = 0, done = 0;
    list.forEach(function (file) {
      var fr = new FileReader();
      fr.onload = function () {
        var grid = parseDelimited(String(fr.result));
        var r = extractSwipes(grid);
        if (!r.swipes.length) {
          msg('No swipes found in ' + file.name + ' — expected Date/Description/Amount columns.', 'err');
        } else {
          sets.push({ swipes: r.swipes, name: file.name });
          credits = credits.concat(r.credits);
          skipped += r.skipped;
        }
        if (++done === list.length && sets.length) {
          var swipes = mergeSets(sets);
          msg('Parsed ' + plural(swipes.length, 'swipe') + ' from ' + plural(sets.length, 'file') +
            (skipped ? ' · skipped ' + skipped + ' unreadable row' + (skipped === 1 ? '' : 's') : ''), 'ok');
          render(buildStats(swipes, credits), sets);
        }
      };
      fr.onerror = function () { msg('Could not read ' + file.name, 'err'); };
      fr.readAsText(file);
    });
  }

  /* deterministic demo data so the page is playable with no file at hand */
  function demoSwipes() {
    var seed = 987654321;
    function rnd() {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function pick(items, weights) {
      var total = weights.reduce(function (a, b) { return a + b; }, 0), r = rnd() * total;
      for (var i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
      return items[items.length - 1];
    }
    var halls = ['Andrews', "Jo's", 'Ivy Room', 'The Ratty', 'VDub'];
    var hours = {
      'Andrews': [[11, 5], [12, 13], [13, 14], [14, 9], [15, 5], [16, 5], [17, 8], [18, 9], [19, 6], [20, 3]],
      "Jo's": [[11, 2], [12, 5], [13, 7], [14, 6], [15, 5], [16, 6], [17, 6], [18, 7], [19, 6], [20, 5], [21, 5], [22, 4], [23, 3], [0, 3], [1, 2]],
      'Ivy Room': [[12, 5], [13, 8], [14, 7], [15, 5], [16, 5], [17, 6], [18, 5], [19, 4], [20, 3], [21, 3], [22, 2], [23, 2]],
      'The Ratty': [[11, 5], [12, 11], [13, 11], [14, 8], [15, 4], [16, 3], [17, 5], [18, 5], [19, 3]],
      'VDub': [[12, 7], [13, 10], [14, 8], [15, 5], [16, 3], [17, 5], [18, 4], [19, 3]]
    };
    var out = [], now = new Date(), end = new Date(now.getFullYear(), now.getMonth(), 28);
    end.setHours(12, 0, 0, 0);
    var start = new Date(end.getFullYear(), end.getMonth() - 10, 1);
    var perDay = [3, 3, 3, 2, 3, 2, 2];
    for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      var progress = (d - start) / (end - start);
      var mix = [0.60 - 0.44 * progress, 0.10 + 0.42 * progress, 0.11, 0.11, 0.08];
      var n = Math.max(0, Math.round(perDay[d.getDay()] + (rnd() - 0.5) * 1.6));
      if (rnd() < 0.07) n = 0;
      for (var i = 0; i < n; i++) {
        var hall = pick(halls, mix);
        var table = hours[hall].map(function (p) { return p[0]; });
        var weights = hours[hall].map(function (p) {
          var w = p[1];
          if (d.getDay() >= 5 && p[0] <= 14) w *= 0.5;
          if (hall === "Jo's" && (p[0] >= 21 || p[0] <= 1) && progress > 0.6) w *= 2;
          return w;
        });
        var hr = pick(table, weights);
        var t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hr, Math.floor(rnd() * 60));
        var suffix = hall === 'Andrews' ? (rnd() < .4 ? 1 : 2) : hall === 'The Ratty' ? (rnd() < .3 ? 2 : 5) : hall === 'VDub' ? 3 : 2;
        out.push({
          t: t, hall: hall,
          points: rnd() < 0.05 ? 2 : 1,
          raw: t.toISOString() + '|' + hall + ' ' + suffix
        });
      }
    }
    return out;
  }

  /* 20 weekly meals, refreshed Monday 3am — mirrors the real statement's resets */
  function demoCredits(swipes) {
    var out = [], seen = {};
    swipes.forEach(function (s) {
      var wk = weekKey(s.t);
      if (seen[wk]) return;
      seen[wk] = 1;
      var reset = new Date(s.t);
      reset.setDate(reset.getDate() - reset.getDay());
      reset.setHours(3, 0, 0, 0);
      out.push({ t: reset, amount: 20, label: 'Automated Reset' });
    });
    return out;
  }

  /* ─────────────────────────── wire up ─────────────────────────── */

  var drop = $('#drop'), fileInput = $('#fileInput');
  drop.addEventListener('click', function () { fileInput.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files.length) loadFiles(fileInput.files);
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  $('#demoBtn').addEventListener('click', function () {
    msg('Building a demo year…');
    var swipes = demoSwipes();
    setTimeout(function () {
      render(buildStats(swipes, demoCredits(swipes)), [{ name: 'demo' }]);
      msg('Demo data — drop a real CSV to replace it.', 'ok');
    }, 30);
  });

  $('#sampleBtn').addEventListener('click', function () {
    var names = [
      '20 Weekly Meals_statement_2026-03-01_to_2026-09-31.csv',
      '20 Weekly Meals_statement_2026-09-30_to_2027-02-28.csv'
    ];
    msg('Loading the statements from this folder…');
    Promise.all(names.map(function (n) {
      return fetch(encodeURIComponent(n)).then(function (r) {
        if (!r.ok) throw new Error('bad response');
        return r.text();
      });
    })).then(function (texts) {
      var sets = texts.map(function (t, i) {
        var r = extractSwipes(parseDelimited(t));
        return { swipes: r.swipes, credits: r.credits, name: names[i] };
      }).filter(function (s) { return s.swipes.length; });
      if (!sets.length) throw new Error('empty');
      var swipes = mergeSets(sets);
      var credits = sets.reduce(function (a, s) { return a.concat(s.credits); }, []);
      msg('Parsed ' + plural(swipes.length, 'swipe') + ' from the folder CSVs.', 'ok');
      render(buildStats(swipes, credits), sets);
    }).catch(function () {
      msg('Could not read the folder from here — browsers block file access. Drop the two CSVs in instead.', 'err');
    });
  });

  $('#flowToggle').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
    flowMode = b.dataset.mode;
    if (current) {
      renderFlow(current);
      $('#flowCard').parentNode.classList.add('in');
    }
  });

  $('#copyBtn').addEventListener('click', function () {
    var text = $('#summary').textContent;
    var btn = this;
    function done() {
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = 'Copy my recap'; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { btn.textContent = 'Select and copy manually'; }
      document.body.removeChild(ta);
    }
  });

  $('#againBtn').addEventListener('click', function () {
    $('#report').hidden = true;
    $('#intro').hidden = false;
    $('#loadMsg').textContent = '';
    window.scrollTo(0, 0);
  });

  window.addEventListener('scroll', function () { hideTip(); }, { passive: true });
})();
