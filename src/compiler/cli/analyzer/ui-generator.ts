/**
 * Thane Bundle Analyzer — Self-Contained UI Generator
 *
 * Generates a single HTML page with embedded CSS and JavaScript.
 * The interactive UI is powered by Thane's own signal system —
 * a minimal copy is embedded directly in the page.
 *
 * Features:
 *   • Squarified treemap visualization (canvas)
 *   • Force-directed dependency graph (SVG)
 *   • Hierarchical component tree (SVG, NX-style)
 *   • Sortable / searchable module table
 *   • Dev ↔ Prod comparison view
 *   • Responsive dark theme
 *
 * @internal
 */

import type { AnalyzerReport } from './types.js';

// ============================================================================
// Public API
// ============================================================================

export function generateAnalyzerHTML(report: AnalyzerReport): string {
  const dataJson = JSON.stringify(report).replace(/<\//g, '<\\/');
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>Thane Bundle Analyzer — ' + report.projectName + '</title>\n'
    + '<style>\n' + CSS + '\n</style>\n'
    + '</head>\n<body>\n'
    + HTML_BODY + '\n'
    + '<script>\n"use strict";\nvar REPORT=' + dataJson + ';\n' + JS_CORE + '\n</script>\n'
    + '</body>\n</html>';
}

// ============================================================================
// Embedded CSS
// ============================================================================

const CSS = `
:root{
  --bg:#0d1117;--surface:#161b22;--surface2:#1c2129;--border:#30363d;
  --text:#e6edf3;--dim:#8b949e;--accent:#58a6ff;--green:#3fb950;
  --red:#f85149;--yellow:#d29922;--purple:#bc8cff;--cyan:#79c0ff;
  --radius:8px;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--text);line-height:1.5;overflow-x:hidden}
.header{display:flex;align-items:center;justify-content:space-between;
  padding:16px 24px;border-bottom:1px solid var(--border);background:var(--surface)}
.header h1{font-size:18px;font-weight:600;display:flex;align-items:center;gap:8px}
.header h1 span{font-size:22px}
.build-toggle{display:flex;gap:4px;background:var(--bg);border-radius:var(--radius);padding:3px}
.build-toggle button{padding:5px 14px;border:none;border-radius:6px;cursor:pointer;
  font-size:13px;font-weight:500;color:var(--dim);background:transparent;transition:.15s}
.build-toggle button.active{color:var(--text);background:var(--surface2)}
.build-toggle button:hover:not(.active){color:var(--text)}
.stats{display:flex;gap:12px;padding:14px 24px;border-bottom:1px solid var(--border);
  overflow-x:auto;background:var(--surface)}
.stat-card{padding:10px 16px;border-radius:var(--radius);background:var(--bg);
  border:1px solid var(--border);min-width:140px;flex-shrink:0}
.stat-card .label{font-size:11px;text-transform:uppercase;color:var(--dim);letter-spacing:.5px}
.stat-card .value{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.stat-card .sub{font-size:11px;color:var(--dim)}
.tabs{display:flex;gap:2px;padding:8px 24px;border-bottom:1px solid var(--border);background:var(--surface)}
.tab{padding:7px 16px;border:none;border-radius:6px;cursor:pointer;font-size:13px;
  font-weight:500;color:var(--dim);background:transparent;transition:.15s}
.tab.active{color:var(--accent);background:rgba(88,166,255,.1)}
.tab:hover:not(.active){color:var(--text)}
.content{position:relative;min-height:calc(100vh - 230px)}
.view{display:none;padding:20px 24px}
.view.active{display:block}
#treemap-canvas{width:100%;border-radius:var(--radius);cursor:pointer;display:block}
.search-bar{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.search-bar input{flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;
  background:var(--bg);color:var(--text);font-size:13px;outline:none}
.search-bar input:focus{border-color:var(--accent)}
.search-bar .count{font-size:12px;color:var(--dim);white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;border-bottom:2px solid var(--border);color:var(--dim);
  font-weight:600;cursor:pointer;user-select:none;white-space:nowrap;font-size:12px;
  text-transform:uppercase;letter-spacing:.4px}
th:hover{color:var(--text)}
th .arrow{margin-left:4px;font-size:10px}
td{padding:7px 12px;border-bottom:1px solid var(--border)}
tr:hover td{background:var(--surface2)}
.cat-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:500}
.cat-component{background:rgba(88,166,255,.15);color:var(--accent)}
.cat-style{background:rgba(63,185,80,.15);color:var(--green)}
.cat-route{background:rgba(210,153,34,.15);color:var(--yellow)}
.cat-library{background:rgba(248,81,73,.15);color:var(--red)}
.cat-runtime{background:rgba(188,140,255,.15);color:var(--purple)}
.cat-signal{background:rgba(121,192,255,.15);color:var(--cyan)}
.cat-other{background:rgba(139,148,158,.15);color:var(--dim)}
#graph-svg,#comp-svg{width:100%;border-radius:var(--radius);background:var(--bg);
  border:1px solid var(--border)}
.node-label{font-size:11px;fill:var(--text);pointer-events:none;font-weight:500}
.edge-line{stroke:var(--border);stroke-width:1.5;fill:none}
.edge-line.highlight{stroke:var(--accent);stroke-width:2}
.graph-node{cursor:pointer;transition:opacity .15s}
.graph-node:hover{opacity:.85}
.comp-node{cursor:pointer}
.comp-node rect{rx:8;ry:8;stroke-width:2;transition:all .15s}
.comp-node:hover rect{filter:brightness(1.2)}
.comp-node text{font-size:12px;fill:var(--text);font-weight:500;pointer-events:none}
.comp-size{font-size:10px;fill:var(--dim)}
.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.compare-col{background:var(--surface);border-radius:var(--radius);padding:16px;
  border:1px solid var(--border)}
.compare-col h3{margin-bottom:12px;font-size:14px;display:flex;align-items:center;gap:6px}
.compare-bar{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px}
.compare-bar .bar{flex:1;height:20px;background:var(--bg);border-radius:4px;overflow:hidden}
.compare-bar .fill{height:100%;border-radius:4px;transition:width .3s}
.compare-delta{padding:16px;grid-column:1/-1;background:var(--surface);
  border-radius:var(--radius);border:1px solid var(--border)}
.delta-positive{color:var(--red)}
.delta-negative{color:var(--green)}
.tooltip{position:fixed;pointer-events:none;z-index:100;padding:10px 14px;
  background:rgba(22,27,34,.96);border:1px solid var(--border);border-radius:var(--radius);
  font-size:12px;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.tooltip .tp-name{font-weight:600;margin-bottom:4px;word-break:break-all}
.tooltip .tp-row{display:flex;justify-content:space-between;gap:16px;color:var(--dim)}
.tooltip .tp-val{color:var(--text);font-variant-numeric:tabular-nums}
.footer{text-align:center;padding:14px;font-size:11px;color:var(--dim);
  border-top:1px solid var(--border)}
.footer a{color:var(--accent);text-decoration:none}
.empty-state{text-align:center;padding:60px 20px;color:var(--dim)}
.empty-state .icon{font-size:48px;margin-bottom:12px}
.graph-controls{display:flex;gap:8px;margin-bottom:12px}
.graph-controls button{padding:5px 12px;border:1px solid var(--border);border-radius:6px;
  background:var(--surface);color:var(--text);font-size:12px;cursor:pointer}
.graph-controls button:hover{background:var(--surface2)}
@media(max-width:768px){
  .compare-grid{grid-template-columns:1fr}
  .stats{flex-wrap:wrap}
}
`;

// ============================================================================
// Embedded HTML Body
// ============================================================================

const HTML_BODY = `
<div id="app">
  <header class="header">
    <h1><span>🔍</span> Thane Bundle Analyzer</h1>
    <div id="build-toggle" class="build-toggle"></div>
  </header>
  <div id="stats-bar" class="stats"></div>
  <nav class="tabs" id="tab-bar"></nav>
  <main class="content">
    <div id="view-treemap" class="view active"></div>
    <div id="view-modules" class="view"></div>
    <div id="view-deps" class="view"></div>
    <div id="view-components" class="view"></div>
    <div id="view-compare" class="view"></div>
  </main>
  <div id="tooltip" class="tooltip" style="display:none"></div>
  <footer class="footer">
    Powered by <a href="https://github.com/timlouw/thane">Thane</a> Signals &bull;
    <span id="ts-label"></span>
  </footer>
</div>
`;

// ============================================================================
// Embedded JavaScript (Thane-powered)
// ============================================================================

const JS_CORE = `
// ====================================================================
// Thane Signal System (embedded runtime — same algorithm as thane/signal.ts)
// ====================================================================
var signal = function(v) {
  var fn = function() {
    if (arguments.length === 0) return fn._v;
    if (fn._v !== arguments[0]) {
      fn._v = arguments[0];
      if (fn._s) { for (var i = 0; i < fn._s.length; i++) fn._s[i](fn._v); }
    }
    return fn._v;
  };
  fn._v = v; fn._s = null;
  fn.subscribe = function(cb, skip) {
    if (!fn._s) fn._s = [];
    fn._s.push(cb);
    if (!skip) cb(fn._v);
    return function() { var i = fn._s ? fn._s.indexOf(cb) : -1; if (i > -1) fn._s.splice(i, 1); };
  };
  return fn;
};

// ====================================================================
// Utility Functions
// ====================================================================
var COLORS = {
  component:'#58a6ff', style:'#3fb950', route:'#d29922',
  library:'#f85149', runtime:'#bc8cff', signal:'#79c0ff', other:'#8b949e'
};
function fmtSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function fmtMs(ms) { return ms < 1000 ? ms.toFixed(0) + 'ms' : (ms / 1000).toFixed(2) + 's'; }
function pct(part, total) { return total ? (part / total * 100).toFixed(1) + '%' : '0%'; }
function shortName(p) {
  var parts = p.replace(/\\\\/g, '/').split('/');
  return parts.length > 2 ? parts.slice(-2).join('/') : parts[parts.length - 1] || p;
}
function $(id) { return document.getElementById(id); }
function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ====================================================================
// State (Thane Signals)
// ====================================================================
var builds = REPORT.builds;
var hasDev = !!builds.dev;
var hasProd = !!builds.prod;
var hasBoth = hasDev && hasProd;
var activeBuild = signal(hasProd ? 'prod' : 'dev');
var activeTab = signal('treemap');
var searchQuery = signal('');
var sortCol = signal('size');
var sortAsc = signal(false);
var hoveredRect = signal(-1);
var selectedModule = signal(null);
var treemapRects = [];

function getBuild() { return activeBuild() === 'prod' ? builds.prod : builds.dev; }

// ====================================================================
// Timestamp
// ====================================================================
$('ts-label').textContent = new Date(REPORT.timestamp).toLocaleString();

// ====================================================================
// Build Toggle
// ====================================================================
(function() {
  var container = $('build-toggle');
  if (hasDev) {
    var bd = el('button', hasProd ? '' : 'active', 'Dev');
    bd.onclick = function() { activeBuild('dev'); };
    container.appendChild(bd);
  }
  if (hasProd) {
    var bp = el('button', 'active', 'Prod');
    bp.onclick = function() { activeBuild('prod'); };
    container.appendChild(bp);
  }
  if (hasBoth) {
    activeBuild.subscribe(function(mode) {
      var btns = container.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        btns[i].className = btns[i].textContent.toLowerCase() === mode ? 'active' : '';
      }
    }, true);
  }
})();

// ====================================================================
// Stats Bar
// ====================================================================
function renderStats() {
  var b = getBuild();
  if (!b) return;
  var bar = $('stats-bar');
  bar.innerHTML = '';
  var cards = [
    { label:'Total Size', value:fmtSize(b.totalSize), sub:fmtSize(b.totalGzipSize) + ' gzip' },
    { label:'Chunks', value:b.chunks.length, sub:b.chunks.filter(function(c){return c.isEntry}).length + ' entry' },
    { label:'Modules', value:b.moduleCount, sub:b.modules.length + ' in output' },
    { label:'Largest Chunk', value:b.chunks[0] ? fmtSize(b.chunks[0].size) : '-', sub:b.chunks[0] ? b.chunks[0].name : '' },
    { label:'Build Time', value:fmtMs(b.buildTimeMs), sub:b.mode + ' build' },
  ];
  if (hasBoth) {
    var other = activeBuild() === 'prod' ? builds.dev : builds.prod;
    if (other) {
      var delta = b.totalSize - other.totalSize;
      cards.push({
        label:'vs ' + other.mode,
        value:(delta > 0 ? '+' : '') + fmtSize(Math.abs(delta)),
        sub: pct(Math.abs(delta), other.totalSize) + (delta > 0 ? ' larger' : ' smaller')
      });
    }
  }
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var d = el('div','stat-card');
    d.innerHTML = '<div class="label">' + c.label + '</div>'
      + '<div class="value">' + c.value + '</div>'
      + '<div class="sub">' + c.sub + '</div>';
    bar.appendChild(d);
  }
}
activeBuild.subscribe(renderStats);

// ====================================================================
// Tabs
// ====================================================================
(function() {
  var tabs = [
    { id:'treemap', label:'Treemap' },
    { id:'modules', label:'Modules' },
    { id:'deps', label:'Dependencies' },
    { id:'components', label:'Components' },
  ];
  if (hasBoth) tabs.push({ id:'compare', label:'Compare' });
  var bar = $('tab-bar');
  for (var i = 0; i < tabs.length; i++) {
    (function(t) {
      var btn = el('button', 'tab' + (t.id === 'treemap' ? ' active' : ''), t.label);
      btn.setAttribute('data-tab', t.id);
      btn.onclick = function() { activeTab(t.id); };
      bar.appendChild(btn);
    })(tabs[i]);
  }
  activeTab.subscribe(function(id) {
    var btns = bar.querySelectorAll('.tab');
    for (var j = 0; j < btns.length; j++) {
      btns[j].className = 'tab' + (btns[j].getAttribute('data-tab') === id ? ' active' : '');
    }
    var views = document.querySelectorAll('.view');
    for (var j = 0; j < views.length; j++) {
      views[j].className = 'view' + (views[j].id === 'view-' + id ? ' active' : '');
    }
  }, true);
})();

// ====================================================================
// Squarified Treemap
// ====================================================================
function worstAspect(row, length, totalArea) {
  if (!row.length || !length || !totalArea) return Infinity;
  var rw = totalArea / length, worst = 0;
  for (var i = 0; i < row.length; i++) {
    var h = row[i].area / rw;
    var r = h > rw ? h / rw : rw / h;
    if (r > worst) worst = r;
  }
  return worst;
}

function squarify(items, rect, out) {
  if (!items.length) return;
  if (items.length === 1) {
    out.push({ data:items[0].data, area:items[0].area, x:rect.x, y:rect.y, w:rect.w, h:rect.h });
    return;
  }
  var short = Math.min(rect.w, rect.h);
  var row = [items[0]], rowArea = items[0].area;
  var i = 1;
  while (i < items.length) {
    var newArea = rowArea + items[i].area;
    if (worstAspect(row.concat(items[i]), short, newArea) <= worstAspect(row, short, rowArea)) {
      row.push(items[i]); rowArea = newArea; i++;
    } else break;
  }
  var horiz = rect.w >= rect.h;
  var rowLen = rowArea / short;
  var off = 0;
  for (var j = 0; j < row.length; j++) {
    var itemLen = row[j].area / rowLen;
    if (horiz) {
      out.push({ data:row[j].data, area:row[j].area, x:rect.x, y:rect.y + off, w:rowLen, h:itemLen });
    } else {
      out.push({ data:row[j].data, area:row[j].area, x:rect.x + off, y:rect.y, w:itemLen, h:rowLen });
    }
    off += itemLen;
  }
  var rest = items.slice(i);
  if (rest.length) {
    var nr = horiz
      ? { x:rect.x + rowLen, y:rect.y, w:rect.w - rowLen, h:rect.h }
      : { x:rect.x, y:rect.y + rowLen, w:rect.w, h:rect.h - rowLen };
    squarify(rest, nr, out);
  }
}

function layoutTreemap(modules, w, h) {
  var total = 0;
  for (var i = 0; i < modules.length; i++) total += modules[i].size;
  if (!total) return [];
  var sorted = modules.slice().sort(function(a, b) { return b.size - a.size; });
  var scale = (w * h) / total;
  var items = [];
  for (var i = 0; i < sorted.length; i++) {
    items.push({ data: sorted[i], area: sorted[i].size * scale });
  }
  var out = [];
  squarify(items, { x:0, y:0, w:w, h:h }, out);
  return out;
}

function renderTreemap() {
  var b = getBuild();
  if (!b) return;
  var container = $('view-treemap');
  container.innerHTML = '';
  var canvas = document.createElement('canvas');
  canvas.id = 'treemap-canvas';
  var dpr = window.devicePixelRatio || 1;
  var cw = container.clientWidth || 900;
  var ch = Math.max(450, window.innerHeight - 320);
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  container.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  treemapRects = layoutTreemap(b.modules, cw, ch);

  function draw(hoverIdx) {
    ctx.clearRect(0, 0, cw, ch);
    for (var i = 0; i < treemapRects.length; i++) {
      var r = treemapRects[i];
      var color = COLORS[r.data.category] || COLORS.other;
      ctx.fillStyle = color;
      ctx.globalAlpha = (hoverIdx === i) ? 1 : 0.75;
      ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.globalAlpha = 1;
      // Border
      ctx.strokeStyle = '#0d1117';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      // Labels
      if (r.w > 55 && r.h > 18) {
        ctx.fillStyle = '#fff';
        ctx.font = '600 11px -apple-system,sans-serif';
        var label = shortName(r.data.path);
        if (ctx.measureText(label).width > r.w - 8) {
          label = label.split('/').pop() || label;
        }
        if (ctx.measureText(label).width < r.w - 8) {
          ctx.fillText(label, r.x + 4, r.y + 14);
        }
        if (r.h > 32) {
          ctx.fillStyle = 'rgba(255,255,255,.6)';
          ctx.font = '10px monospace';
          ctx.fillText(fmtSize(r.data.size), r.x + 4, r.y + 26);
        }
      }
    }
    // Hover highlight border
    if (hoverIdx >= 0 && hoverIdx < treemapRects.length) {
      var hr = treemapRects[hoverIdx];
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(hr.x, hr.y, hr.w, hr.h);
    }
  }

  draw(-1);

  // Hover detection
  var tip = $('tooltip');
  canvas.onmousemove = function(e) {
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var found = -1;
    for (var i = 0; i < treemapRects.length; i++) {
      var r = treemapRects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { found = i; break; }
    }
    if (found !== hoveredRect()) {
      hoveredRect(found);
      draw(found);
      if (found >= 0) {
        var d = treemapRects[found].data;
        tip.style.display = 'block';
        tip.innerHTML = '<div class="tp-name">' + d.path + '</div>'
          + '<div class="tp-row"><span>Size</span><span class="tp-val">' + fmtSize(d.size) + '</span></div>'
          + '<div class="tp-row"><span>Original</span><span class="tp-val">' + fmtSize(d.originalSize) + '</span></div>'
          + '<div class="tp-row"><span>Category</span><span class="tp-val">' + d.category + '</span></div>'
          + '<div class="tp-row"><span>Chunk</span><span class="tp-val">' + (d.chunk || '-') + '</span></div>';
      } else {
        tip.style.display = 'none';
      }
    }
    if (found >= 0) {
      tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 380) + 'px';
      tip.style.top = (e.clientY + 12) + 'px';
    }
  };
  canvas.onmouseleave = function() {
    hoveredRect(-1); draw(-1); tip.style.display = 'none';
  };
  canvas.onclick = function(e) {
    var idx = hoveredRect();
    if (idx >= 0) selectedModule(treemapRects[idx].data);
  };
}

// ====================================================================
// Module Table
// ====================================================================
function renderModuleTable() {
  var b = getBuild();
  if (!b) return;
  var container = $('view-modules');
  container.innerHTML = '';

  // Search bar
  var searchDiv = el('div', 'search-bar');
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search modules...';
  input.oninput = function() { searchQuery(input.value); };
  var countEl = el('span', 'count');
  searchDiv.appendChild(input);
  searchDiv.appendChild(countEl);
  container.appendChild(searchDiv);

  // Table
  var table = document.createElement('table');
  var thead = document.createElement('thead');
  var headerRow = document.createElement('tr');
  var cols = [
    { key:'path', label:'Module' },
    { key:'size', label:'Size' },
    { key:'originalSize', label:'Original' },
    { key:'category', label:'Category' },
    { key:'chunk', label:'Chunk' },
    { key:'imports', label:'Imports' },
    { key:'importedBy', label:'Imported By' },
  ];
  for (var c = 0; c < cols.length; c++) {
    (function(col) {
      var th = document.createElement('th');
      th.innerHTML = col.label + '<span class="arrow"></span>';
      th.onclick = function() {
        if (sortCol() === col.key) { sortAsc(!sortAsc()); }
        else { sortCol(col.key); sortAsc(false); }
      };
      headerRow.appendChild(th);
    })(cols[c]);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  table.appendChild(tbody);
  container.appendChild(table);

  function renderRows() {
    var query = searchQuery().toLowerCase();
    var col = sortCol();
    var asc = sortAsc();
    var mods = b.modules.filter(function(m) {
      return !query || m.path.toLowerCase().indexOf(query) !== -1;
    });
    mods.sort(function(a, b) {
      var av = a[col], bv = b[col];
      if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
      if (Array.isArray(av)) { av = av.length; bv = bv.length; }
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
    countEl.textContent = mods.length + ' / ' + b.modules.length + ' modules';
    // Update sort arrows
    var ths = headerRow.querySelectorAll('th');
    for (var i = 0; i < ths.length; i++) {
      var arrow = ths[i].querySelector('.arrow');
      if (cols[i].key === col) { arrow.textContent = asc ? ' ▲' : ' ▼'; }
      else { arrow.textContent = ''; }
    }
    tbody.innerHTML = '';
    for (var i = 0; i < mods.length; i++) {
      var m = mods[i];
      var tr = document.createElement('tr');
      tr.innerHTML = '<td title="' + m.path + '">' + shortName(m.path) + '</td>'
        + '<td>' + fmtSize(m.size) + '</td>'
        + '<td>' + fmtSize(m.originalSize) + '</td>'
        + '<td><span class="cat-badge cat-' + m.category + '">' + m.category + '</span></td>'
        + '<td>' + (m.chunk || '-') + '</td>'
        + '<td>' + m.imports.length + '</td>'
        + '<td>' + m.importedBy.length + '</td>';
      tbody.appendChild(tr);
    }
  }

  renderRows();
  searchQuery.subscribe(renderRows, true);
  sortCol.subscribe(renderRows, true);
  sortAsc.subscribe(renderRows, true);
}

// ====================================================================
// Force-Directed Dependency Graph (SVG)
// ====================================================================
function renderDepGraph() {
  var b = getBuild();
  if (!b || !b.dependencies.length) {
    $('view-deps').innerHTML = '<div class="empty-state"><div class="icon">🔗</div><p>No module dependencies found.</p></div>';
    return;
  }
  var container = $('view-deps');
  container.innerHTML = '';

  // Controls
  var controls = el('div', 'graph-controls');
  controls.innerHTML = '<button id="graph-reset">Reset Zoom</button>'
    + '<span style="color:var(--dim);font-size:12px;line-height:30px">Scroll to zoom · Drag to pan · Click a node for details</span>';
  container.appendChild(controls);

  var width = container.clientWidth || 900;
  var height = Math.max(500, window.innerHeight - 350);
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'graph-svg';
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  container.appendChild(svg);

  // Collect unique nodes (limit to top 120 for performance)
  var nodeSet = {};
  var edges = b.dependencies;
  var mods = b.modules.slice(0, 120);
  var modSet = {};
  for (var i = 0; i < mods.length; i++) modSet[mods[i].path] = mods[i];

  var nodeArr = [];
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    if (!nodeSet[m.path]) {
      nodeSet[m.path] = { id:m.path, x:width/2+(Math.random()-.5)*width*.6,
        y:height/2+(Math.random()-.5)*height*.6, vx:0, vy:0, fx:0, fy:0,
        data:m, idx:nodeArr.length };
      nodeArr.push(nodeSet[m.path]);
    }
  }

  var edgeArr = [];
  for (var i = 0; i < edges.length; i++) {
    var s = nodeSet[edges[i].source], t = nodeSet[edges[i].target];
    if (s && t) edgeArr.push({ source:s, target:t });
  }

  // Force simulation (200 iterations)
  var k = Math.sqrt(width * height / (nodeArr.length || 1));
  for (var iter = 0; iter < 200; iter++) {
    var temp = 1 - iter / 200;
    for (var i = 0; i < nodeArr.length; i++) { nodeArr[i].fx = 0; nodeArr[i].fy = 0; }
    // Repulsion
    for (var i = 0; i < nodeArr.length; i++) {
      for (var j = i + 1; j < nodeArr.length; j++) {
        var dx = nodeArr[i].x - nodeArr[j].x;
        var dy = nodeArr[i].y - nodeArr[j].y;
        var dist = Math.sqrt(dx*dx + dy*dy) || 1;
        var force = (k * k) / dist;
        var fx = (dx / dist) * force;
        var fy = (dy / dist) * force;
        nodeArr[i].fx += fx; nodeArr[i].fy += fy;
        nodeArr[j].fx -= fx; nodeArr[j].fy -= fy;
      }
    }
    // Attraction
    for (var i = 0; i < edgeArr.length; i++) {
      var s = edgeArr[i].source, t = edgeArr[i].target;
      var dx = t.x - s.x, dy = t.y - s.y;
      var dist = Math.sqrt(dx*dx + dy*dy) || 1;
      var force = (dist * dist) / k * 0.15;
      var fx = (dx / dist) * force, fy = (dy / dist) * force;
      s.fx += fx; s.fy += fy; t.fx -= fx; t.fy -= fy;
    }
    // Centering
    for (var i = 0; i < nodeArr.length; i++) {
      nodeArr[i].fx += (width/2 - nodeArr[i].x) * 0.01;
      nodeArr[i].fy += (height/2 - nodeArr[i].y) * 0.01;
    }
    // Apply
    for (var i = 0; i < nodeArr.length; i++) {
      var n = nodeArr[i];
      var disp = Math.sqrt(n.fx*n.fx + n.fy*n.fy) || 1;
      var maxD = temp * 50;
      n.x += (n.fx / disp) * Math.min(disp, maxD);
      n.y += (n.fy / disp) * Math.min(disp, maxD);
      n.x = Math.max(40, Math.min(width - 40, n.x));
      n.y = Math.max(40, Math.min(height - 40, n.y));
    }
  }

  // Render SVG
  var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', 'graph-group');

  // Arrowhead marker
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<marker id="arrow" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + '#30363d' + '"/></marker>';
  svg.appendChild(defs);

  // Edges
  for (var i = 0; i < edgeArr.length; i++) {
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', edgeArr[i].source.x);
    line.setAttribute('y1', edgeArr[i].source.y);
    line.setAttribute('x2', edgeArr[i].target.x);
    line.setAttribute('y2', edgeArr[i].target.y);
    line.setAttribute('class', 'edge-line');
    line.setAttribute('marker-end', 'url(#arrow)');
    line.setAttribute('data-src', edgeArr[i].source.id);
    line.setAttribute('data-tgt', edgeArr[i].target.id);
    g.appendChild(line);
  }

  // Nodes
  var nodeRadius = Math.max(4, Math.min(10, 800 / (nodeArr.length || 1)));
  for (var i = 0; i < nodeArr.length; i++) {
    var n = nodeArr[i];
    var ng = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ng.setAttribute('class', 'graph-node');
    ng.setAttribute('data-id', n.id);
    var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', n.x);
    circle.setAttribute('cy', n.y);
    circle.setAttribute('r', nodeRadius);
    circle.setAttribute('fill', COLORS[n.data.category] || COLORS.other);
    ng.appendChild(circle);
    if (nodeArr.length < 50) {
      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', n.x);
      text.setAttribute('y', n.y - nodeRadius - 3);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'node-label');
      text.textContent = shortName(n.id);
      ng.appendChild(text);
    }
    (function(node) {
      ng.onmouseenter = function() {
        var tip = $('tooltip');
        tip.style.display = 'block';
        tip.innerHTML = '<div class="tp-name">' + node.id + '</div>'
          + '<div class="tp-row"><span>Size</span><span class="tp-val">' + fmtSize(node.data.size) + '</span></div>'
          + '<div class="tp-row"><span>Imports</span><span class="tp-val">' + node.data.imports.length + '</span></div>'
          + '<div class="tp-row"><span>Imported By</span><span class="tp-val">' + node.data.importedBy.length + '</span></div>';
        // Highlight edges
        var lines = svg.querySelectorAll('.edge-line');
        for (var j = 0; j < lines.length; j++) {
          var isSrc = lines[j].getAttribute('data-src') === node.id;
          var isTgt = lines[j].getAttribute('data-tgt') === node.id;
          lines[j].setAttribute('class', 'edge-line' + (isSrc || isTgt ? ' highlight' : ''));
        }
      };
      ng.onmouseleave = function() {
        $('tooltip').style.display = 'none';
        var lines = svg.querySelectorAll('.edge-line');
        for (var j = 0; j < lines.length; j++) lines[j].setAttribute('class', 'edge-line');
      };
      ng.onmousemove = function(e) {
        var tip = $('tooltip');
        tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 380) + 'px';
        tip.style.top = (e.clientY + 12) + 'px';
      };
    })(nodeArr[i]);
    g.appendChild(ng);
  }
  svg.appendChild(g);

  // Pan & zoom
  var vx = 0, vy = 0, vw = width, vh = height;
  svg.onwheel = function(e) {
    e.preventDefault();
    var factor = e.deltaY > 0 ? 1.1 : 0.9;
    var rect = svg.getBoundingClientRect();
    var mx = (e.clientX - rect.left) / rect.width;
    var my = (e.clientY - rect.top) / rect.height;
    var nw = vw * factor, nh = vh * factor;
    vx += (vw - nw) * mx;
    vy += (vh - nh) * my;
    vw = nw; vh = nh;
    svg.setAttribute('viewBox', vx + ' ' + vy + ' ' + vw + ' ' + vh);
  };
  var dragging = false, dx = 0, dy = 0;
  svg.onmousedown = function(e) {
    if (e.target.tagName === 'svg' || e.target.tagName === 'line') {
      dragging = true; dx = e.clientX; dy = e.clientY;
      svg.style.cursor = 'grabbing';
    }
  };
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var rect = svg.getBoundingClientRect();
    var sx = vw / rect.width, sy = vh / rect.height;
    vx -= (e.clientX - dx) * sx;
    vy -= (e.clientY - dy) * sy;
    dx = e.clientX; dy = e.clientY;
    svg.setAttribute('viewBox', vx + ' ' + vy + ' ' + vw + ' ' + vh);
  });
  document.addEventListener('mouseup', function() {
    dragging = false; svg.style.cursor = '';
  });
  $('graph-reset').onclick = function() {
    vx = 0; vy = 0; vw = width; vh = height;
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  };
}

// ====================================================================
// Component Tree (NX-style Hierarchical Graph)
// ====================================================================
function renderComponentTree() {
  var comps = REPORT.componentTree;
  if (!comps || !comps.length) {
    $('view-components').innerHTML = '<div class="empty-state"><div class="icon">🌳</div><p>No Thane components found.<br>Components using <code>defineComponent</code> will appear here.</p></div>';
    return;
  }
  var container = $('view-components');
  container.innerHTML = '';

  var controls = el('div', 'graph-controls');
  controls.innerHTML = '<button id="comp-reset">Reset Zoom</button>'
    + '<span style="color:var(--dim);font-size:12px;line-height:30px">' + comps.length + ' components · Hover for details</span>';
  container.appendChild(controls);

  var width = container.clientWidth || 900;
  var height = Math.max(400, Math.min(comps.length * 70 + 100, window.innerHeight - 300));

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'comp-svg';
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  container.appendChild(svg);

  // Build adjacency
  var bySelector = {};
  for (var i = 0; i < comps.length; i++) bySelector[comps[i].selector] = comps[i];

  // Compute layers (BFS from roots)
  var inDeg = {};
  for (var i = 0; i < comps.length; i++) inDeg[comps[i].selector] = 0;
  for (var i = 0; i < comps.length; i++) {
    var deps = comps[i].dependencies;
    for (var j = 0; j < deps.length; j++) {
      if (inDeg[deps[j]] !== undefined) inDeg[deps[j]]++;
    }
  }
  var roots = [];
  for (var i = 0; i < comps.length; i++) {
    if (inDeg[comps[i].selector] === 0) roots.push(comps[i].selector);
  }
  if (!roots.length) roots.push(comps[0].selector);

  var layers = {};
  var queue = roots.map(function(r) { return { id:r, layer:0 }; });
  var visited = {};
  var maxLayer = 0;
  while (queue.length) {
    var cur = queue.shift();
    if (visited[cur.id]) continue;
    visited[cur.id] = true;
    layers[cur.id] = cur.layer;
    if (cur.layer > maxLayer) maxLayer = cur.layer;
    var comp = bySelector[cur.id];
    if (comp) {
      for (var i = 0; i < comp.dependencies.length; i++) {
        queue.push({ id:comp.dependencies[i], layer:cur.layer + 1 });
      }
    }
  }
  for (var i = 0; i < comps.length; i++) {
    if (!visited[comps[i].selector]) {
      layers[comps[i].selector] = maxLayer + 1;
      maxLayer++;
      visited[comps[i].selector] = true;
    }
  }

  // Group by layer
  var layerGroups = [];
  for (var l = 0; l <= maxLayer; l++) layerGroups.push([]);
  for (var i = 0; i < comps.length; i++) {
    layerGroups[layers[comps[i].selector]].push(comps[i]);
  }

  // Position
  var nodeW = 160, nodeH = 50;
  var layerH = height / (maxLayer + 2);
  var positions = {};
  for (var l = 0; l <= maxLayer; l++) {
    var group = layerGroups[l];
    var spacing = width / (group.length + 1);
    for (var i = 0; i < group.length; i++) {
      positions[group[i].selector] = {
        x: spacing * (i + 1) - nodeW / 2,
        y: layerH * (l + 1) - nodeH / 2,
        cx: spacing * (i + 1),
        cy: layerH * (l + 1)
      };
    }
  }

  var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('id', 'comp-group');

  // Arrow marker
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = '<marker id="comp-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#58a6ff"/></marker>';
  svg.appendChild(defs);

  // Edges (curved)
  for (var i = 0; i < comps.length; i++) {
    var comp = comps[i];
    var from = positions[comp.selector];
    if (!from) continue;
    for (var j = 0; j < comp.dependencies.length; j++) {
      var to = positions[comp.dependencies[j]];
      if (!to) continue;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      var midY = (from.cy + nodeH/2 + to.cy - nodeH/2) / 2;
      var d = 'M' + from.cx + ' ' + (from.cy + nodeH/2)
        + ' C' + from.cx + ' ' + midY
        + ' ' + to.cx + ' ' + midY
        + ' ' + to.cx + ' ' + (to.cy - nodeH/2);
      path.setAttribute('d', d);
      path.setAttribute('class', 'edge-line');
      path.setAttribute('marker-end', 'url(#comp-arrow)');
      path.setAttribute('data-from', comp.selector);
      path.setAttribute('data-to', comp.dependencies[j]);
      g.appendChild(path);
    }
  }

  // Nodes
  for (var i = 0; i < comps.length; i++) {
    var comp = comps[i];
    var pos = positions[comp.selector];
    if (!pos) continue;
    var ng = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ng.setAttribute('class', 'comp-node');
    ng.setAttribute('data-sel', comp.selector);

    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', pos.x);
    rect.setAttribute('y', pos.y);
    rect.setAttribute('width', nodeW);
    rect.setAttribute('height', nodeH);
    rect.setAttribute('fill', '#161b22');
    rect.setAttribute('stroke', COLORS.component);
    ng.appendChild(rect);

    var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', pos.cx);
    text.setAttribute('y', pos.cy - 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('class', 'comp-node');
    text.setAttribute('fill', '#e6edf3');
    text.textContent = comp.name;
    ng.appendChild(text);

    var sizeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sizeText.setAttribute('x', pos.cx);
    sizeText.setAttribute('y', pos.cy + 14);
    sizeText.setAttribute('text-anchor', 'middle');
    sizeText.setAttribute('class', 'comp-size');
    sizeText.textContent = fmtSize(comp.size);
    ng.appendChild(sizeText);

    (function(c) {
      ng.onmouseenter = function() {
        var tip = $('tooltip');
        tip.style.display = 'block';
        tip.innerHTML = '<div class="tp-name">' + c.name + '</div>'
          + '<div class="tp-row"><span>Selector</span><span class="tp-val">&lt;' + c.selector + '&gt;</span></div>'
          + '<div class="tp-row"><span>File</span><span class="tp-val">' + c.filePath + '</span></div>'
          + '<div class="tp-row"><span>Size</span><span class="tp-val">' + fmtSize(c.size) + '</span></div>'
          + '<div class="tp-row"><span>Uses</span><span class="tp-val">' + c.dependencies.join(', ') + (c.dependencies.length ? '' : 'none') + '</span></div>'
          + '<div class="tp-row"><span>Used By</span><span class="tp-val">' + c.dependents.join(', ') + (c.dependents.length ? '' : 'none') + '</span></div>';
        // Highlight connected edges
        var edges = svg.querySelectorAll('.edge-line');
        for (var e = 0; e < edges.length; e++) {
          var isFrom = edges[e].getAttribute('data-from') === c.selector;
          var isTo = edges[e].getAttribute('data-to') === c.selector;
          edges[e].setAttribute('class', 'edge-line' + (isFrom || isTo ? ' highlight' : ''));
        }
      };
      ng.onmouseleave = function() {
        $('tooltip').style.display = 'none';
        var edges = svg.querySelectorAll('.edge-line');
        for (var e = 0; e < edges.length; e++) edges[e].setAttribute('class', 'edge-line');
      };
      ng.onmousemove = function(e) {
        var tip = $('tooltip');
        tip.style.left = Math.min(e.clientX + 12, window.innerWidth - 380) + 'px';
        tip.style.top = (e.clientY + 12) + 'px';
      };
    })(comp);
    g.appendChild(ng);
  }
  svg.appendChild(g);

  // Pan & zoom
  var cvx = 0, cvy = 0, cvw = width, cvh = height;
  svg.onwheel = function(e) {
    e.preventDefault();
    var factor = e.deltaY > 0 ? 1.1 : 0.9;
    var rect = svg.getBoundingClientRect();
    var mx = (e.clientX - rect.left) / rect.width;
    var my = (e.clientY - rect.top) / rect.height;
    var nw = cvw * factor, nh = cvh * factor;
    cvx += (cvw - nw) * mx; cvy += (cvh - nh) * my;
    cvw = nw; cvh = nh;
    svg.setAttribute('viewBox', cvx + ' ' + cvy + ' ' + cvw + ' ' + cvh);
  };
  var cd = false, cdx = 0, cdy = 0;
  svg.onmousedown = function(e) {
    if (e.target.tagName === 'svg') { cd = true; cdx = e.clientX; cdy = e.clientY; svg.style.cursor = 'grabbing'; }
  };
  document.addEventListener('mousemove', function(e) {
    if (!cd) return;
    var rect = svg.getBoundingClientRect();
    cvx -= (e.clientX - cdx) * (cvw / rect.width);
    cvy -= (e.clientY - cdy) * (cvh / rect.height);
    cdx = e.clientX; cdy = e.clientY;
    svg.setAttribute('viewBox', cvx + ' ' + cvy + ' ' + cvw + ' ' + cvh);
  });
  document.addEventListener('mouseup', function() { cd = false; svg.style.cursor = ''; });
  $('comp-reset').onclick = function() {
    cvx = 0; cvy = 0; cvw = width; cvh = height;
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  };
}

// ====================================================================
// Compare View (Dev vs Prod)
// ====================================================================
function renderCompare() {
  if (!hasBoth) {
    $('view-compare').innerHTML = '<div class="empty-state"><div class="icon">⚖️</div><p>Run with <code>thane analyze --compare</code> to see dev vs prod comparison.</p></div>';
    return;
  }
  var container = $('view-compare');
  container.innerHTML = '';
  var dev = builds.dev, prod = builds.prod;
  var grid = el('div', 'compare-grid');

  // Dev column
  var devCol = el('div', 'compare-col');
  devCol.innerHTML = '<h3>🔧 Development Build</h3>';
  devCol.innerHTML += buildCompareCard(dev);
  grid.appendChild(devCol);

  // Prod column
  var prodCol = el('div', 'compare-col');
  prodCol.innerHTML = '<h3>🚀 Production Build</h3>';
  prodCol.innerHTML += buildCompareCard(prod);
  grid.appendChild(prodCol);

  // Delta summary
  var delta = el('div', 'compare-delta');
  var sizeDelta = prod.totalSize - dev.totalSize;
  var gzipDelta = prod.totalGzipSize - dev.totalGzipSize;
  var savings = dev.totalSize - prod.totalSize;
  delta.innerHTML = '<h3>📊 Analysis</h3>'
    + '<div class="compare-bar"><span>Size reduction</span><span class="' + (savings > 0 ? 'delta-negative' : 'delta-positive') + '">' + fmtSize(Math.abs(savings)) + ' (' + pct(Math.abs(savings), dev.totalSize) + ')</span></div>'
    + '<div class="compare-bar"><span>Gzip reduction</span><span class="' + (gzipDelta < 0 ? 'delta-negative' : 'delta-positive') + '">' + fmtSize(Math.abs(gzipDelta)) + ' (' + pct(Math.abs(gzipDelta), dev.totalGzipSize) + ')</span></div>'
    + '<div class="compare-bar"><span>Build time delta</span><span>' + fmtMs(Math.abs(prod.buildTimeMs - dev.buildTimeMs)) + (prod.buildTimeMs > dev.buildTimeMs ? ' slower' : ' faster') + '</span></div>'
    + '<div class="compare-bar"><span>Module count</span><span>Dev: ' + dev.moduleCount + ' → Prod: ' + prod.moduleCount + '</span></div>';

  // Top chunks comparison
  var maxChunks = Math.max(dev.chunks.length, prod.chunks.length);
  var maxSize = 0;
  for (var i = 0; i < dev.chunks.length; i++) if (dev.chunks[i].size > maxSize) maxSize = dev.chunks[i].size;
  for (var i = 0; i < prod.chunks.length; i++) if (prod.chunks[i].size > maxSize) maxSize = prod.chunks[i].size;

  delta.innerHTML += '<h4 style="margin-top:14px;margin-bottom:8px;font-size:13px;color:var(--dim)">Chunk Comparison</h4>';
  for (var i = 0; i < Math.min(maxChunks, 10); i++) {
    var dc = dev.chunks[i], pc = prod.chunks[i];
    if (dc) {
      delta.innerHTML += '<div class="compare-bar">'
        + '<span style="min-width:80px;color:var(--accent)">' + dc.name + '</span>'
        + '<div class="bar"><div class="fill" style="width:' + (dc.size/maxSize*100) + '%;background:var(--yellow)"></div></div>'
        + '<span style="min-width:65px;text-align:right">' + fmtSize(dc.size) + '</span>'
        + '</div>';
    }
    if (pc) {
      delta.innerHTML += '<div class="compare-bar">'
        + '<span style="min-width:80px;color:var(--green)">' + pc.name + '</span>'
        + '<div class="bar"><div class="fill" style="width:' + (pc.size/maxSize*100) + '%;background:var(--green)"></div></div>'
        + '<span style="min-width:65px;text-align:right">' + fmtSize(pc.size) + '</span>'
        + '</div>';
    }
  }
  grid.appendChild(delta);
  container.appendChild(grid);
}

function buildCompareCard(b) {
  return '<div class="compare-bar"><span>Total</span><span>' + fmtSize(b.totalSize) + '</span></div>'
    + '<div class="compare-bar"><span>Gzipped</span><span>' + fmtSize(b.totalGzipSize) + '</span></div>'
    + '<div class="compare-bar"><span>Chunks</span><span>' + b.chunks.length + '</span></div>'
    + '<div class="compare-bar"><span>Modules</span><span>' + b.moduleCount + '</span></div>'
    + '<div class="compare-bar"><span>Build Time</span><span>' + fmtMs(b.buildTimeMs) + '</span></div>';
}

// ====================================================================
// Render Orchestration
// ====================================================================
var rendered = {};
function renderView(id) {
  if (id === 'treemap') { renderTreemap(); rendered.treemap = true; }
  if (id === 'modules' && !rendered.modules) { renderModuleTable(); rendered.modules = true; }
  if (id === 'deps' && !rendered.deps) { renderDepGraph(); rendered.deps = true; }
  if (id === 'components' && !rendered.components) { renderComponentTree(); rendered.components = true; }
  if (id === 'compare' && !rendered.compare) { renderCompare(); rendered.compare = true; }
}

activeTab.subscribe(function(id) { renderView(id); });
activeBuild.subscribe(function() {
  rendered = {};
  renderView(activeTab());
});

// Initial render
renderView('treemap');

// Resize handler
var resizeTimer;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    rendered = {};
    renderView(activeTab());
  }, 250);
});
`;
