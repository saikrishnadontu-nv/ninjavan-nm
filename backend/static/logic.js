/* Stock drift comparison logic. Pure functions on row objects, no page code,
   so it can be tested outside the browser. */
(function (root) {
  'use strict';

  const norm = h => String(h == null ? '' : h).replace(/^\uFEFF/, '').replace(/\s*\*\s*$/, '').trim();
  const K = s => String(s == null ? '' : s).trim().toUpperCase();
  const r3 = x => Math.round(x * 1000) / 1000;

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const m = String(v == null ? '' : v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  // "2,490 PIECES" -> {n: 2490, unit: "PIECES", raw: "2,490 PIECES"}
  function parseQty(v) {
    if (typeof v === 'number') return { n: v, unit: '', raw: String(v) };
    const s = String(v == null ? '' : v).trim();
    const m = s.match(/^(-?[\d,]*\.?\d+)\s*(.*)$/);
    if (!m) return null;
    return { n: parseFloat(m[1].replace(/,/g, '')), unit: m[2].trim().toUpperCase(), raw: s };
  }

  // Whole days from asOf (UTC midnight ms) to the expiry date. null if no usable date.
  function daysTo(v, asOf) {
    let y, mo, d;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      const t = new Date(v.getTime() + 12 * 3600 * 1000); // guards against timezone drift in spreadsheet dates
      y = t.getFullYear(); mo = t.getMonth(); d = t.getDate();
    } else {
      const m = String(v == null ? '' : v).match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; }
      else {
        const t = new Date(v);
        if (!v || isNaN(t)) return null;
        y = t.getFullYear(); mo = t.getMonth(); d = t.getDate();
      }
    }
    return Math.round((Date.UTC(y, mo, d) - asOf) / 86400000);
  }

  // ---- Unit conversion list (ITO bulk product template) ----
  function buildConv(rows) {
    const map = new Map();
    for (const r of rows) {
      const type = String(r['Row type (H/D)'] || '').trim().toUpperCase();
      const key = K(r['Product short code (AMAST code)']);
      if (!key) continue;
      if (type === 'H') {
        const baseUnit = K(r['Base UOM on AC2']);
        const lifeRaw = r['Outbound Life'];
        const life = (lifeRaw === '' || lifeRaw == null || isNaN(num(lifeRaw))) ? null : num(lifeRaw);
        const e = { life, units: new Map(), name: String(r['Product name'] || '') };
        if (baseUnit) e.units.set(baseUnit, 1);
        map.set(key, e);
      } else if (type === 'D') {
        const e = map.get(key);
        const u = K(r['UOM on AC2']);
        const f = num(r['UOM conversion']);
        if (e && u && f > 0) e.units.set(u, f);
      }
    }
    return map;
  }
  function convToJSON(map) {
    return [...map].map(([k, e]) => [k, { l: e.life, n: e.name, u: [...e.units] }]);
  }
  function convFromJSON(arr) {
    return new Map(arr.map(([k, e]) => [k, { life: e.l, name: e.n, units: new Map(e.u) }]));
  }

  // ---- AC2: add up lots per product, in base units ----
  function buildAc2(rows, conv, asOf) {
    const ac2 = new Map();
    for (const r of rows) {
      const key = K(r['Item']);
      if (!key) continue;
      let e = ac2.get(key);
      if (!e) { e = { key, name: String(r['Item Description'] || ''), total: 0, sell: 0, near: 0, dmg: 0, noConv: false, bad: new Set() }; ac2.set(key, e); }
      const q = parseQty(r['Available Qty']);
      if (!q || !q.n) continue;
      const c = conv.get(key);
      const f = c ? c.units.get(q.unit) : undefined;
      if (f === undefined) { e.noConv = true; e.bad.add(q.raw); continue; }
      const base = q.n * f;
      e.total += base;
      if (K(r['Location']).startsWith('DAMAGE')) { e.dmg += base; continue; }
      if (c.life != null) {
        const days = daysTo(r['Expiry Date'], asOf);
        if (days !== null && days <= c.life) { e.near += base; continue; }
      }
      e.sell += base;
    }
    for (const e of ac2.values()) { e.total = r3(e.total); e.sell = r3(e.sell); e.near = r3(e.near); e.dmg = r3(e.dmg); }
    return ac2;
  }

  // ---- ITO ----
  function buildIto(rows) {
    const out = { map: new Map(), dup: 0, warehouses: [] };
    const whs = [...new Set(rows.map(r => String(r['Warehouse'] || '').trim()).filter(Boolean))];
    out.warehouses = whs;
    const only1A = whs.length > 1 && whs.some(w => /^1A\b/i.test(w));
    for (const r of rows) {
      if (only1A && !/^1A\b/i.test(String(r['Warehouse'] || '').trim())) continue;
      const key = K(r['AMAST/WAVE code']);
      if (!key) continue;
      if (out.map.has(key)) { out.dup++; continue; }
      const avail = num(r['Available to sell (Base UOM Qty)']);
      const res = num(r['Reserved qty (Base UOM Qty)']);
      out.map.set(key, { key, name: String(r['Product'] || ''), avail, res, value: r3(avail + res), near: num(r['Near expiry qty (Base UOM Qty)']) });
    }
    out.filtered1A = only1A;
    return out;
  }

  // ---- AMAST ----
  function buildAmast(rows) {
    const out = { map: new Map(), dup: 0 };
    for (const r of rows) {
      const key = K(r['SKU_ID']);
      if (!key) continue;
      if (out.map.has(key)) { out.dup++; continue; }
      out.map.set(key, { key, name: String(r['SKU_NAME'] || ''), fresh: num(r['FRESH']), pending: num(r['NEW_ORDER']), avail: num(r['AVAILABLE']) });
    }
    return out;
  }

  const isClearance = (key, name) => key.startsWith('(CLR)') || /^\s*\(CLR\)/i.test(name || '');
  const isTest = (key, name) => /\b(QA|SMOKE|MART-SKU)\b|SMOKE-TEST|^P-QA/i.test(key + ' ' + (name || ''));

  // ---- The comparison ----
  function compare(ac2, ito, amast, opts) {
    opts = opts || {};
    const keys = new Set([...ac2.keys(), ...ito.map.keys(), ...amast.map.keys()]);
    const res = { rows: [], cannot: [], checked: 0, synced: 0, hiddenClearance: 0, hiddenTest: 0 };
    for (const key of keys) {
      const a = ac2.get(key), i = ito.map.get(key), m = amast.map.get(key);
      const name = (m && m.name) || (i && i.name) || (a && a.name) || '';
      if (isClearance(key, name)) { res.hiddenClearance++; continue; }
      if (!opts.includeTest && isTest(key, name)) { res.hiddenTest++; continue; }
      res.checked++;

      if (a && a.noConv) {
        res.cannot.push({ key, name, bad: [...a.bad].slice(0, 3).join('; '), ito: i ? i.value : null, amast: m ? m.fresh : null });
        continue;
      }
      const A = a ? a.sell : 0;
      const I = i ? i.value : null;
      const M = m ? m.fresh : null;
      const tags = [];
      const d1 = I == null ? null : r3(I - A);          // AC2 -> ITO
      const d2 = (I == null || M == null) ? null : r3(M - I); // ITO -> AMAST
      const dE = M == null ? null : r3(M - A);           // AMAST vs AC2, end to end
      const gap1 = d1 !== null && d1 !== 0;
      const gap2 = d2 !== null && d2 !== 0;
      const gapE = I == null && dE !== null && dE !== 0;
      const negative = m && (m.fresh < 0 || m.avail < 0);
      const missITO = I == null && (A > 0 || (M || 0) > 0);
      const missAMAST = M == null && (A > 0 || (I || 0) > 0);
      if (!a && (I > 0 || M > 0)) tags.push('Not in AC2 file (counted as 0)');
      if (negative) tags.push('Negative in AMAST');

      let cat = null;
      if (missITO || missAMAST) cat = 'missing';
      else if (dE !== null && dE > 0 && (gap1 || gap2 || gapE)) cat = 'over';
      else if (dE !== null && dE < 0 && (gap1 || gap2 || gapE)) cat = 'under';
      else if (gap1 || gap2 || gapE) cat = 'mid';
      else if (negative) cat = 'neg';
      if (!cat) { res.synced++; continue; }

      let where = '';
      if (gap1 && gap2) where = 'Both steps';
      else if (gap1) where = 'AC2 → ITO';
      else if (gap2) where = 'ITO → AMAST';
      else if (gapE) where = 'AC2 → AMAST (not in ITO)';
      if (missITO) { where = 'Missing in ITO'; tags.push('Missing in ITO'); }
      if (missAMAST) { where = 'Missing in AMAST'; tags.push('Missing in AMAST'); }
      if (cat === 'neg' && !where) where = 'AMAST only';

      const size = Math.max(Math.abs(d1 || 0), Math.abs(d2 || 0), Math.abs(dE || 0), cat === 'missing' ? Math.max(A, I || 0, M || 0) : 0);
      res.rows.push({
        key, name, cat, where, tags, size,
        ac2: a ? A : null, ac2Near: a ? a.near : 0, ito: I, amast: M,
        pending: m ? m.pending : null, amastAvail: m ? m.avail : null,
        d1, d2, dE: dE
      });
    }
    return res;
  }

  // Read the first sheet into row objects. Some exports declare a wrong sheet size
  // (for example only 3 columns), so the real range is rebuilt from the cells themselves.
  function rowsFromWorkbook(XLSX, wb) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
    for (const k of Object.keys(ws)) {
      if (k[0] === '!') continue;
      const c = XLSX.utils.decode_cell(k);
      if (c.r < minR) minR = c.r; if (c.c < minC) minC = c.c;
      if (c.r > maxR) maxR = c.r; if (c.c > maxC) maxC = c.c;
    }
    if (maxR < 0) return [];
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
    return XLSX.utils.sheet_to_json(ws, { defval: '' }).map(r => {
      const o = {};
      for (const k in r) o[norm(k)] = r[k];
      return o;
    });
  }

  const api = { rowsFromWorkbook, norm, K, num, parseQty, daysTo, buildConv, convToJSON, convFromJSON, buildAc2, buildIto, buildAmast, compare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StockLogic = api;
})(typeof window !== 'undefined' ? window : this);
