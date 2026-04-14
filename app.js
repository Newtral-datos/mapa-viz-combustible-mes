/* ── Configuración ── */
const INITIAL_CENTER = [-3.7, 40.3];
const INITIAL_ZOOM   = 5;

/* Paleta divergente variación: verde (bajada) → rojo (subida) */
const VAR_COLORS = [
  '#00745b', '#019b7a', '#01f3b3', '#b8fff1',  // verde oscuro → claro (bajadas)
  '#fee2e2', '#fca5a5', '#ef4444', '#7f1d1d'   // rojo claro → oscuro (subidas)
];

/* Paletas precio por combustible (modo precio) */
const GAS_COLORS    = ['#b8fff1','#88ffe5','#5df7d4','#3ceec4','#22ddb1','#09c39a','#019b7a','#00745b'];
const DIESEL_COLORS = ['#fff4c2','#ffe79a','#ffd76a','#ffca3a','#f3b61f','#d79a00','#a87200','#6f4d00'];

/* Breaks de variación — se calculan dinámicamente desde los datos */
const VAR_BREAKS = {
  total:  { g95: [-0.10,-0.06,-0.03,0,0.04,0.08,0.14], diesel: [-0.10,-0.06,-0.03,0,0.04,0.08,0.14] },
  before: { g95: [-0.10,-0.06,-0.03,0,0.04,0.08,0.14], diesel: [-0.10,-0.06,-0.03,0,0.04,0.08,0.14] },
  after:  { g95: [-0.10,-0.06,-0.03,0,0.04,0.08,0.14], diesel: [-0.10,-0.06,-0.03,0,0.04,0.08,0.14] }
};
let SLIDER_RANGE = {
  total:  { g95: { min: -0.20, max: 0.25 }, diesel: { min: -0.20, max: 0.25 } },
  before: { g95: { min: -0.10, max: 0.15 }, diesel: { min: -0.10, max: 0.15 } },
  after:  { g95: { min: -0.20, max: 0.15 }, diesel: { min: -0.20, max: 0.15 } }
};

/* Breaks de precio por combustible y fecha — calculados del GeoJSON al cargar */
const PRICE_BREAKS = { g95: {}, diesel: {} };

/* Campos detectados dinámicamente */
const FLD = {
  municipio:  'Municipio',
  provincia:  'Provincia',
  rotulo:     'Rótulo',
  ideess:     'IDEESS',
  gas95: null, diesel: null, gas95First: null, dieselFirst: null
};

/* Estado */
let currentFuel    = 'g95';
let currentMode    = 'variacion';
let currentDateKey = null;
let currentPeriod  = 'total';       // 'total' | 'before' | 'after'
let availableDates = [];            // ['04_03','05_03',...]

const STATION_PROPS = {};

/* UI refs */
const tabs     = document.querySelectorAll('#fuel-tabs .tab');
const rangeEl  = document.getElementById('range');
const minLabel = document.getElementById('min-label');
const maxLabel = document.getElementById('max-label');

/* ── Helpers columnas DD_MM ── */
function compareDateKey(a, b) {
  const parse = s => { const p = s.split('_'); return parseInt(p[p.length-1])*100 + parseInt(p[p.length-2]); };
  return parse(a) - parse(b);
}
function keysFor(prefix, props) {
  return Object.keys(props).filter(k => k.startsWith(prefix)).sort(compareDateKey);
}
function detectFields(props) {
  const gk = keysFor('Gasolina95_', props);
  const dk = keysFor('GasoleoA_',   props);
  if (gk.length) {
    FLD.gas95      = gk[gk.length-1];
    FLD.gas95First = gk[0];
    availableDates = gk.map(k => k.replace('Gasolina95_', ''));
  }
  if (dk.length) { FLD.diesel = dk[dk.length-1]; FLD.dieselFirst = dk[0]; }
}

/* ── Breaks de precio desde datos reales ── */
function calcPercentileBreaks(vals, numBins) {
  if (!vals.length) return [0,0,0,0,0,0,0];
  const sorted = vals.slice().sort((a, b) => a - b);
  return Array.from({length: numBins - 1}, (_, i) =>
    +sorted[Math.floor((i + 1) * sorted.length / numBins)].toFixed(3)
  );
}
function computePriceBreaks() {
  const features = window.ESTACIONES_GEOJSON.features;
  availableDates.forEach(dd_mm => {
    const gk = 'Gasolina95_' + dd_mm;
    const dk = 'GasoleoA_'   + dd_mm;
    const gv = [], dv = [];
    features.forEach(f => {
      const p = f.properties;
      if (p[gk] != null && +p[gk] > 0.5) gv.push(+p[gk]);
      if (p[dk] != null && +p[dk] > 0.5) dv.push(+p[dk]);
    });
    PRICE_BREAKS.g95[dd_mm]    = calcPercentileBreaks(gv, 8);
    PRICE_BREAKS.diesel[dd_mm] = calcPercentileBreaks(dv, 8);
  });
}

/* ── Rangos reales del slider calculados desde los datos ── */
const REF_FIELD = { g95: 'Gasolina95_21_03', diesel: 'GasoleoA_21_03' };

/* Breaks anclados en 0: 3 en negativo + 0 + 3 en positivo */
function breaksAroundZero(arr) {
  const neg = arr.filter(v => v < 0).sort((a, b) => a - b);
  const pos = arr.filter(v => v > 0).sort((a, b) => a - b);
  const nb = neg.length >= 3
    ? [0.25, 0.50, 0.75].map(p => +neg[Math.floor(p * neg.length)].toFixed(3))
    : [-0.08, -0.04, -0.01];
  const pb = pos.length >= 3
    ? [0.25, 0.50, 0.75].map(p => +pos[Math.floor(p * pos.length)].toFixed(3))
    : [0.01, 0.05, 0.10];
  return [...nb, 0, ...pb];
}

function computeSliderRanges() {
  const features = window.ESTACIONES_GEOJSON.features;
  const deltas = {
    total:  { g95: [], diesel: [] },
    before: { g95: [], diesel: [] },
    after:  { g95: [], diesel: [] }
  };
  features.forEach(f => {
    const p = f.properties;
    const g0 = +p[FLD.gas95First], g1 = +p[FLD.gas95], gr = +p[REF_FIELD.g95];
    const d0 = +p[FLD.dieselFirst], d1 = +p[FLD.diesel], dr = +p[REF_FIELD.diesel];
    if (g0 > 0.5 && g1 > 0.5) deltas.total.g95.push(g1 - g0);
    if (d0 > 0.5 && d1 > 0.5) deltas.total.diesel.push(d1 - d0);
    if (g0 > 0.5 && gr > 0.5) deltas.before.g95.push(gr - g0);
    if (d0 > 0.5 && dr > 0.5) deltas.before.diesel.push(dr - d0);
    if (gr > 0.5 && g1 > 0.5) deltas.after.g95.push(g1 - gr);
    if (dr > 0.5 && d1 > 0.5) deltas.after.diesel.push(d1 - dr);
  });
  ['total','before','after'].forEach(period => {
    ['g95','diesel'].forEach(fuel => {
      const arr = deltas[period][fuel];
      if (!arr.length) return;
      const sorted = arr.slice().sort((a, b) => a - b);
      SLIDER_RANGE[period][fuel] = {
        min: Math.floor(sorted[0] * 100) / 100,
        max: Math.ceil(sorted[sorted.length - 1] * 100) / 100
      };
      VAR_BREAKS[period][fuel] = breaksAroundZero(arr);
    });
  });
}

/* ── Mapa ── */
const map = new maplibregl.Map({
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  center: INITIAL_CENTER, zoom: INITIAL_ZOOM, antialias: true
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');

map.on('load', () => {
  map.addSource('basemap', {
    type: 'raster',
    tiles: ['https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}{r}.png'],
    tileSize: 256,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>'
  });
  map.addLayer({ id: 'basemap', type: 'raster', source: 'basemap' });

  map.addSource('stations', { type: 'geojson', data: window.ESTACIONES_GEOJSON });
  map.addLayer({
    id: 'stations-circles', type: 'circle', source: 'stations',
    paint: {
      'circle-radius':       ['interpolate', ['linear'], ['zoom'], 4, 0.6, 6, 2, 8, 3.5, 10, 5],
      'circle-color':        GAS_COLORS[4],
      'circle-stroke-color': GAS_COLORS[4],
      'circle-stroke-width': 0.6,
      'circle-opacity':      0.95
    }
  });

  const first = window.ESTACIONES_GEOJSON.features[0];
  if (first) {
    detectFields(first.properties);
    computePriceBreaks();
    computeSliderRanges();
    updateLegendTitle();
    buildLegend();
    restyleLayer();
    initSlider();
  }

  map.on('mousemove', 'stations-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'stations-circles', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'stations-circles', e => {
    if (!e.features?.length) return;
    const props = e.features[0].properties || {};
    const ideess = props[FLD.ideess];
    if (ideess) STATION_PROPS[ideess] = props;
    showPopup(e.lngLat, popupHTML(props));
    if (ideess) loadChart(ideess);
  });
});

/* ── Botones de fecha ── */
function buildDateBar() {
  const bar = document.getElementById('date-bar');
  if (!bar) return;

  const btnVar = document.createElement('button');
  btnVar.className = 'date-btn is-active';
  btnVar.dataset.mode = 'variacion';
  btnVar.textContent = window.innerWidth < 900 ? 'Var.' : 'Variación';
  btnVar.addEventListener('click', () => setMode('variacion', null));
  bar.appendChild(btnVar);

  availableDates.forEach(dd_mm => {
    const [dd, mm] = dd_mm.split('_');
    const btn = document.createElement('button');
    btn.className = 'date-btn';
    btn.dataset.mode = 'precio';
    btn.dataset.date = dd_mm;
    btn.textContent = `${dd}/${mm}`;
    btn.addEventListener('click', () => setMode('precio', dd_mm));
    bar.appendChild(btn);
  });
}

function setMode(mode, dd_mm) {
  currentMode    = mode;
  currentDateKey = dd_mm;

  document.querySelectorAll('#date-bar .date-btn').forEach(btn => {
    btn.classList.toggle('is-active',
      mode === 'variacion' ? btn.dataset.mode === 'variacion' : btn.dataset.date === dd_mm
    );
  });

  const sliderWrap = document.getElementById('slider');
  if (sliderWrap) sliderWrap.classList.toggle('slider-disabled', mode === 'precio');

  updateLegendTitle();
  buildLegend();
  restyleLayer();
  applyFilters();
}

/* ── Expresiones de color ── */
function safeDeltaExpr(firstField, lastField) {
  const f = ['to-number', ['get', firstField], 0];
  const l = ['to-number', ['get', lastField],  0];
  return ['case', ['all', ['>', f, 0.5], ['>', l, 0.5]], ['-', l, f], 0];
}

function deltaExprForPeriod(fuel, period) {
  const lastField  = fuel === 'g95' ? FLD.gas95      : FLD.diesel;
  const firstField = fuel === 'g95' ? FLD.gas95First : FLD.dieselFirst;
  const refField   = REF_FIELD[fuel];
  const f = ['to-number', ['get', firstField], 0];
  const l = ['to-number', ['get', lastField],  0];
  const r = ['to-number', ['get', refField],   0];
  if (period === 'before') return ['case', ['all', ['>', f, 0.5], ['>', r, 0.5]], ['-', r, f], 0];
  if (period === 'after')  return ['case', ['all', ['>', r, 0.5], ['>', l, 0.5]], ['-', l, r], 0];
  return ['case', ['all', ['>', f, 0.5], ['>', l, 0.5]], ['-', l, f], 0];
}

function circleColorExpr(fuel) {
  const B = VAR_BREAKS[currentPeriod][fuel];
  if (!B) return VAR_COLORS[4];
  const delta = deltaExprForPeriod(fuel, currentPeriod);
  return ['step', delta,
    VAR_COLORS[0], B[0], VAR_COLORS[1], B[1], VAR_COLORS[2], B[2], VAR_COLORS[3],
    B[3], VAR_COLORS[4], B[4], VAR_COLORS[5], B[5], VAR_COLORS[6], B[6], VAR_COLORS[7]
  ];
}

function circleColorExprPrecio(fuel, dd_mm) {
  const field  = (fuel === 'g95' ? 'Gasolina95_' : 'GasoleoA_') + dd_mm;
  const COLORS = fuel === 'g95' ? GAS_COLORS : DIESEL_COLORS;
  const B      = PRICE_BREAKS[fuel][dd_mm];
  if (!B) return COLORS[4];
  const val = ['to-number', ['get', field], 0];
  return ['case', ['>', val, 0.5],
    ['step', val,
      COLORS[0], B[0], COLORS[1], B[1], COLORS[2], B[2], COLORS[3],
      B[3], COLORS[4], B[4], COLORS[5], B[5], COLORS[6], B[6], COLORS[7]
    ],
    'rgba(0,0,0,0)'
  ];
}

function restyleLayer() {
  if (!map.getLayer('stations-circles')) return;
  let expr;
  if (currentMode === 'precio') {
    const dd_mm = currentDateKey || availableDates[availableDates.length - 1];
    expr = circleColorExprPrecio(currentFuel, dd_mm);
  } else {
    expr = circleColorExpr(currentFuel);
  }
  map.setPaintProperty('stations-circles', 'circle-color',        expr);
  map.setPaintProperty('stations-circles', 'circle-stroke-color', expr);
}

/* ── Leyenda ── */
function buildLegend() {
  const container = document.getElementById('legend-items');
  container.innerHTML = '';
  const COLORS = currentFuel === 'g95' ? GAS_COLORS : DIESEL_COLORS;

  const B = VAR_BREAKS[currentPeriod][currentFuel];
  const PALETTE = VAR_COLORS;
  const labels = ['< '+fmtVar(B[0]), fmtVar(B[0]), fmtVar(B[1]), fmtVar(B[2]),
                  fmtVar(B[3]), fmtVar(B[4]), fmtVar(B[5]), '> '+fmtVar(B[6])];

  PALETTE.forEach((color, i) => {
    const item = document.createElement('div'); item.className = 'legend-item';
    const sw   = document.createElement('div'); sw.className = 'sw'; sw.style.background = color;
    const lbl  = document.createElement('span'); lbl.textContent = labels[i];
    item.appendChild(sw); item.appendChild(lbl); container.appendChild(item);
  });
}

function updateLegendTitle() {
  const t = document.getElementById('legend-title-text');
  if (!t) return;
  const fl = currentFuel === 'g95' ? 'la gasolina 95' : 'el diésel';
  const periodLabel = currentPeriod === 'before' ? ' hasta el 21/03'
    : currentPeriod === 'after' ? ' desde el 21/03' : '';
  t.textContent = `Cómo ha evolucionado el precio de ${fl}${periodLabel}`;
}

/* ── Slider ── */
function initSlider() {
  const { min, max } = SLIDER_RANGE[currentPeriod][currentFuel];
  noUiSlider.create(rangeEl, {
    start: [min, max], connect: true, step: 0.01,
    range: { min, max }
  });
  rangeEl.noUiSlider.on('update', ([a, b]) => {
    minLabel.textContent = fmtVar(+a);
    maxLabel.textContent = fmtVar(+b);
  });
  rangeEl.noUiSlider.on('change', applyFilters);
}

function updateSlider() {
  const { min, max } = SLIDER_RANGE[currentPeriod][currentFuel];
  rangeEl.noUiSlider.updateOptions({ range: { min, max }, start: [min, max] }, true);
}

/* ── Filtros ── */
function applyFilters() {
  if (!map.getLayer('stations-circles')) return;
  const [minV, maxV] = rangeEl.noUiSlider.get().map(Number);
  const delta = deltaExprForPeriod(currentFuel, currentPeriod);
  map.setFilter('stations-circles', ['all', ['>=', delta, minV], ['<=', delta, maxV]]);
}

/* ── Periodo (total / antes / después del 21/03) ── */
function setPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b =>
    b.classList.toggle('is-active', b.dataset.period === period)
  );
  updateLegendTitle();
  buildLegend();
  restyleLayer();
  updateSlider();
  applyFilters();
}
document.querySelectorAll('.period-btn').forEach(b =>
  b.addEventListener('click', () => setPeriod(b.dataset.period))
);

/* ── Tabs ── */
tabs.forEach(btn => btn.addEventListener('click', () => {
  if (btn.classList.contains('is-active')) return;
  tabs.forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
  btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');
  currentFuel = btn.dataset.fuel;
  updateLegendTitle();
  buildLegend();
  restyleLayer();
  updateSlider();
  applyFilters();
}));

/* ── Popup ── */
let popup;
let activeChart = null;

function showPopup(lngLat, html) {
  if (!popup) popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 8, maxWidth: '340px' });
  if (activeChart) { activeChart.destroy(); activeChart = null; }
  popup.setLngLat(lngLat).setHTML(html).addTo(map);
}

function dateLabel(field) {
  if (!field) return '—';
  const parts = field.split('_');
  return `${parts[parts.length-2]}/${parts[parts.length-1]}`;
}

function popupHTML(p) {
  const ideess = p[FLD.ideess] || '';

  // Precios inicio y fin
  const g0 = FLD.gas95First ? +p[FLD.gas95First] : null;
  const g1 = FLD.gas95      ? +p[FLD.gas95]      : null;
  const d0 = FLD.dieselFirst ? +p[FLD.dieselFirst] : null;
  const d1 = FLD.diesel      ? +p[FLD.diesel]      : null;

  // Precio en la fecha de referencia (21/03)
  const gRef = +p['Gasolina95_21_03'] || null;
  const dRef = +p['GasoleoA_21_03']   || null;

  function varBlock(first, last, ref) {
    const ok = v => v != null && v > 0.5;
    const varTotal   = ok(first) && ok(last) ? last - first : null;
    const pctTotal   = varTotal != null ? varTotal / first * 100 : null;
    const varBefore  = ok(first) && ok(ref)  ? ref  - first : null;
    const pctBefore  = varBefore != null ? varBefore / first * 100 : null;
    const varAfter   = ok(ref)   && ok(last) ? last  - ref  : null;
    const pctAfter   = varAfter != null ? varAfter / ref * 100 : null;

    const fv = (v, p) => v == null ? '' :
      `<span class="${v >= 0 ? 'up' : 'dn'}">${v >= 0 ? '+' : ''}${v.toFixed(3).replace('.',',')}€ (${p >= 0 ? '+' : ''}${p.toFixed(1).replace('.',',')}%)</span>`;

    return `
      <div class="pp-var">${fv(varTotal, pctTotal)}</div>
      ${varBefore != null ? `
        <div class="pp-periods">
          <div class="pp-period">Hasta 21/03 ${fv(varBefore, pctBefore)}</div>
          <div class="pp-period pp-period--hi">Desde 21/03 ${fv(varAfter, pctAfter)}</div>
        </div>` : ''}`;
  }

  const fecha = dateLabel(FLD.gas95);
  return `
    <div class="pp">
      <h3 class="pp-title">${p[FLD.rotulo] || '—'}</h3>
      <p class="pp-sub">${p[FLD.municipio] || '—'} · ${p[FLD.provincia] || '—'}</p>
      <div class="pp-fuels">
        <div class="pp-fuel">
          <span class="pp-badge pp-badge--gas">Gasolina 95</span>
          <div class="pp-price">${fmtPrice(g1)}</div>
          ${varBlock(g0, g1, gRef)}
        </div>
        <div class="pp-fuel-sep"></div>
        <div class="pp-fuel">
          <span class="pp-badge pp-badge--diesel">Diésel</span>
          <div class="pp-price">${fmtPrice(d1)}</div>
          ${varBlock(d0, d1, dRef)}
        </div>
      </div>
      <div class="pp-footer">${fecha}</div>
      ${ideess ? `
        <div class="popup-chart-wrap" id="chart-wrap-${ideess}">
          <canvas id="chart-${ideess}"></canvas>
        </div>` : ''}
    </div>`;
}

/* ── Gráfico ── */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function loadChart(ideess) {
  const wrap = document.getElementById(`chart-wrap-${ideess}`);
  if (!wrap) return;
  if (activeChart) { activeChart.destroy(); activeChart = null; }

  const props = STATION_PROPS[ideess];
  if (!props) { wrap.innerHTML = '<p style="font-size:12px;color:#888;text-align:center;margin:16px 0">Sin datos</p>'; return; }

  const dk    = keysFor('GasoleoA_',   props);
  const gk    = keysFor('Gasolina95_', props);
  const fechas = dk.map(k => { const p = k.split('_'); return `${p[p.length-2]}/${p[p.length-1]}`; });

  const canvasEl = document.getElementById(`chart-${ideess}`);
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');

  const h = 180;
  const g95Grad = ctx.createLinearGradient(0, 0, 0, h);
  g95Grad.addColorStop(0,   hexToRgba('#01c49a', 0.35));
  g95Grad.addColorStop(0.7, hexToRgba('#01c49a', 0.06));
  g95Grad.addColorStop(1,   hexToRgba('#01c49a', 0.0));

  const dGrad = ctx.createLinearGradient(0, 0, 0, h);
  dGrad.addColorStop(0,   hexToRgba('#d79a00', 0.35));
  dGrad.addColorStop(0.7, hexToRgba('#d79a00', 0.06));
  dGrad.addColorStop(1,   hexToRgba('#d79a00', 0.0));

  activeChart = new Chart(canvasEl, {
    type: 'line',
    data: {
      labels: fechas,
      datasets: [
        {
          label: 'Gasolina 95',
          data: gk.map(k => (props[k] != null && +props[k] > 0.5) ? +props[k] : null),
          borderColor: '#01c49a', backgroundColor: g95Grad,
          borderWidth: 2, fill: true, tension: 0.4, spanGaps: true,
          pointRadius: 0, pointHoverRadius: 0
        },
        {
          label: 'Diésel',
          data: dk.map(k => (props[k] != null && +props[k] > 0.5) ? +props[k] : null),
          borderColor: '#d79a00', backgroundColor: dGrad,
          borderWidth: 2, fill: true, tension: 0.4, spanGaps: true,
          pointRadius: 0, pointHoverRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top', align: 'start',
          labels: {
            font: { size: 11, weight: '600' }, boxWidth: 10, boxHeight: 10,
            borderRadius: 3, useBorderRadius: true, padding: 8, color: '#374151'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(15,20,30,0.88)',
          titleFont: { size: 11, weight: '700' },
          bodyFont:  { size: 11 },
          padding: 10, cornerRadius: 8, caretSize: 5,
          callbacks: {
            label: c => c.parsed.y == null ? null
              : `  ${c.dataset.label}: ${c.parsed.y.toFixed(3).replace('.',',')} €/l`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: '#6b7280', maxRotation: 0 }
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(0,0,0,0.06)', drawTicks: false },
          ticks: {
            font: { size: 10 }, color: '#6b7280', padding: 4,
            callback: v => v.toFixed(2).replace('.',',') + '€'
          }
        }
      }
    }
  });
}

/* ── Utilidades ── */
function fmtPrice(v)  { if (v == null || v === '') return '—'; const n = parseFloat(String(v).replace(',','.')); return Number.isFinite(n) ? n.toFixed(2).replace('.',',')+'€/l' : '—'; }
function fmtShort(v)  { const n = parseFloat(v); return Number.isFinite(n) ? n.toFixed(2).replace('.',',') : '—'; }
function fmtVar(n)    { return (n > 0 ? '+' : '') + Number(n).toFixed(2).replace('.',',')+'€'; }
function round2(n)    { return Math.round(n*100)/100; }
