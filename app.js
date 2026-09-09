const tashkent = [69.2401, 41.2995];
const overpassUrls = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let specialRequestInFlight = false;
let specialDataLoaded = false;
let treeDataLoaded = false;
const specialCacheKey = 'tashkent-special-cache-v2';
const specialCacheTtl = 10 * 60 * 1000;

function emptyCollection() { return { type: 'FeatureCollection', features: [] }; }
function pointFeature(element, kind) { return { type: 'Feature', properties: { kind, ...element.tags }, geometry: { type: 'Point', coordinates: [element.lon, element.lat] } }; }
function coordinatePoint(point, kind, properties = {}) { return { type: 'Feature', properties: { kind, ...properties }, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } }; }
function treePartFeature(element, part) {
  const crownLevel = { crown: { size: 0.000035, base: 2.2, height: 6.5 }, 'crown-mid': { size: 0.000030, base: 3.6, height: 7.6 }, 'crown-upper': { size: 0.000025, base: 5.2, height: 8.4 }, 'crown-top': { size: 0.000015, base: 7.0, height: 9.5 } }[part];
  const size = part === 'trunk' ? 0.000012 : crownLevel.size;
  const base = part === 'trunk' ? 0 : crownLevel.base;
  const height = part === 'trunk' ? 2.2 : crownLevel.height;
  const points = Array.from({ length: 8 }, (_, index) => {
    const angle = Math.PI * 2 * index / 8;
    return [element.lon + Math.cos(angle) * size, element.lat + Math.sin(angle) * size];
  });
  points.push(points[0]);
  return { type: 'Feature', properties: { kind: part, base, height }, geometry: { type: 'Polygon', coordinates: [points] } };
}
function portalFeature(point, role) {
  const w = 0.000055;
  const d = 0.000032;
  return { type: 'Feature', properties: { kind: 'underground-portal', role, base: 0, height: 1.25 }, geometry: { type: 'Polygon', coordinates: [[[point.lon - w, point.lat - d], [point.lon + w, point.lat - d], [point.lon + w, point.lat + d], [point.lon - w, point.lat + d], [point.lon - w, point.lat - d]]] } };
}
function rampFeature(a, b) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const length = Math.hypot(dx, dy) || 1;
  const halfWidth = 0.000022;
  const px = (-dy / length) * halfWidth;
  const py = (dx / length) * halfWidth;
  return { type: 'Feature', properties: { kind: 'underground-ramp', base: 0, height: 0.65 }, geometry: { type: 'Polygon', coordinates: [[[a.lon + px, a.lat + py], [b.lon + px, b.lat + py], [b.lon - px, b.lat - py], [a.lon - px, a.lat - py], [a.lon + px, a.lat + py]]] } };
}
function bridgeApproachFeatures(point, toward, element) {
  const dx = toward.lon - point.lon;
  const dy = toward.lat - point.lat;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const approachLength = element.tags?.highway === 'footway' ? 0.00016 : 0.0003;
  const halfWidth = element.tags?.highway === 'footway' ? 0.00002 : 0.000045;
  const px = -uy * halfWidth;
  const py = ux * halfWidth;
  const deckHeight = element.tags?.highway === 'footway' ? 4.5 : 5.5;
  const levels = [0.2, 0.45, 0.7, 1];
  let previous = 0;
  return levels.map((level) => {
    const from = { lon: point.lon + ux * approachLength * previous, lat: point.lat + uy * approachLength * previous };
    const to = { lon: point.lon + ux * approachLength * level, lat: point.lat + uy * approachLength * level };
    previous = level;
    return { type: 'Feature', properties: { kind: 'bridge-approach', base: 0, height: deckHeight * level }, geometry: { type: 'Polygon', coordinates: [[[from.lon + px, from.lat + py], [to.lon + px, to.lat + py], [to.lon - px, to.lat - py], [from.lon - px, from.lat - py], [from.lon + px, from.lat + py]]] } };
  });
}
function bridgeSlabFeature(a, b, element) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const length = Math.hypot(dx, dy) || 1;
  const halfWidth = element.tags?.highway === 'footway' ? 0.00002 : 0.000045;
  const px = (-dy / length) * halfWidth;
  const py = (dx / length) * halfWidth;
  const base = element.tags?.highway === 'footway' ? 4.5 : 5.5;
  return { type: 'Feature', properties: { kind: 'bridge-slab', base, height: base + 0.22 }, geometry: { type: 'Polygon', coordinates: [[[a.lon + px, a.lat + py], [b.lon + px, b.lat + py], [b.lon - px, b.lat - py], [a.lon - px, a.lat - py], [a.lon + px, a.lat + py]]] } };
}
function wayFeature(element, kind) { return { type: 'Feature', properties: { kind, ...element.tags }, geometry: { type: 'LineString', coordinates: (element.geometry || []).map((point) => [point.lon, point.lat]) } }; }
function bridgeDeckFeature(a, b, element) {
  const height = element.tags?.highway === 'footway' ? 4.5 : 6;
  return { type: 'Feature', properties: { kind: 'bridge-deck', height, name: element.tags?.name || (element.tags?.highway === 'footway' ? 'Надземный переход' : 'Мост') }, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } };
}

function convertOverpass(data) {
  const seenWays = new Set();
  const result = { signals: emptyCollection(), crossings: emptyCollection(), trees: emptyCollection(), treeTrunks: emptyCollection(), treeCrowns: emptyCollection(), footways: emptyCollection(), underground: emptyCollection(), undergroundEntrances: emptyCollection(), undergroundPortals: emptyCollection(), undergroundRamps: emptyCollection(), bridgeDecks: emptyCollection(), bridgeSlabs: emptyCollection(), bridgeApproaches: emptyCollection() };
  data.elements.forEach((element) => {
    const tags = element.tags || {};
    if (element.type === 'node' && tags.highway === 'traffic_signals') result.signals.features.push(pointFeature(element, 'traffic_signals'));
    if (element.type === 'node' && tags.highway === 'crossing') result.crossings.features.push(pointFeature(element, 'crossing'));
    if (element.type === 'node' && tags.natural === 'tree') { result.trees.features.push(pointFeature(element, 'tree')); result.treeTrunks.features.push(treePartFeature(element, 'trunk')); result.treeCrowns.features.push(treePartFeature(element, 'crown')); result.treeCrowns.features.push(treePartFeature(element, 'crown-mid')); result.treeCrowns.features.push(treePartFeature(element, 'crown-upper')); result.treeCrowns.features.push(treePartFeature(element, 'crown-top')); }
    if (element.type === 'way' && (['footway', 'path', 'pedestrian', 'cycleway'].includes(tags.highway) || tags.bridge === 'yes' || tags.tunnel === 'yes' || tags.covered === 'yes')) {
      if (seenWays.has(element.id)) return;
      seenWays.add(element.id);
      const points = element.geometry || [];
      const isUnderground = tags.tunnel === 'yes' || tags.covered === 'yes' || tags.layer === '-1';
      const isBridge = !isUnderground && tags.bridge === 'yes';
      const target = isUnderground ? result.underground : result.footways;
      if (points.length > 1) {
        if (isBridge) {
          for (let index = 0; index < points.length - 1; index += 1) {
            result.bridgeDecks.features.push(bridgeDeckFeature(points[index], points[index + 1], element));
            result.bridgeSlabs.features.push(bridgeSlabFeature(points[index], points[index + 1], element));
          }
          result.bridgeApproaches.features.push(...bridgeApproachFeatures(points[0], points[1], element));
          result.bridgeApproaches.features.push(...bridgeApproachFeatures(points[points.length - 1], points[points.length - 2], element));
        }
        target.features.push(wayFeature(element, isUnderground ? 'underground' : 'footway'));
        if (isUnderground) {
          result.undergroundEntrances.features.push(coordinatePoint(points[0], 'underground-entrance', { role: 'Вход в подземный переход' }));
          result.undergroundEntrances.features.push(coordinatePoint(points[points.length - 1], 'underground-exit', { role: 'Выход из подземного перехода' }));
          result.undergroundPortals.features.push(portalFeature(points[0], 'Вход в подземный переход'));
          result.undergroundPortals.features.push(portalFeature(points[points.length - 1], 'Выход из подземного перехода'));
          if (points.length > 1) {
            result.undergroundRamps.features.push(rampFeature(points[0], points[1]));
            result.undergroundRamps.features.push(rampFeature(points[points.length - 2], points[points.length - 1]));
          }
        }
      }
    }
  });
  return result;
}

async function loadSpecialLayers() {
  if (specialRequestInFlight || map.getZoom() < 13 || (specialDataLoaded && (treeDataLoaded || map.getZoom() < 14.0))) return;
  specialRequestInFlight = true;
  const bounds = map.getBounds();
  const bbox = bounds.getSouth() + ',' + bounds.getWest() + ',' + bounds.getNorth() + ',' + bounds.getEast();
  const includeTrees = map.getZoom() >= 14.0;
  try {
    const cached = JSON.parse(localStorage.getItem(specialCacheKey) || 'null');
    if (cached && cached.includeTrees === includeTrees && Date.now() - cached.savedAt < specialCacheTtl) {
      Object.entries(cached.layers).forEach(([name, geojson]) => map.getSource('osm-' + name).setData(geojson));
      specialDataLoaded = true;
      treeDataLoaded = includeTrees;
      specialRequestInFlight = false;
      document.querySelector('.legend-note').textContent = 'Специальные объекты загружены из кэша браузера.';
      return;
    }
  } catch (error) { console.warn('Кэш объектов недоступен', error); }
  const treeQuery = includeTrees ? 'node[natural=tree](' + bbox + ');' : '';
  const query = '[out:json][timeout:25];(node[highway=traffic_signals](' + bbox + ');node[highway=crossing](' + bbox + ');' + treeQuery + 'way[highway~"^(footway|path|pedestrian|cycleway|primary|secondary|tertiary|trunk|motorway)$"](' + bbox + ');way[bridge=yes](' + bbox + ');way[tunnel=yes](' + bbox + ');way[covered=yes](' + bbox + '););out body geom;';
  try {
    let response;
    for (const endpoint of overpassUrls) {
      try {
        const candidate = await Promise.race([fetch(endpoint + '?data=' + encodeURIComponent(query)), new Promise((_, reject) => setTimeout(() => reject(new Error('Overpass timeout')), 12000))]);
        if (candidate.ok) { response = candidate; break; }
      } catch (error) { console.warn('Overpass endpoint unavailable', endpoint); }
    }
    if (!response) throw new Error('Overpass endpoints unavailable');
    const layers = convertOverpass(await response.json());
    Object.entries(layers).forEach(([name, geojson]) => map.getSource('osm-' + name).setData(geojson));
    try { localStorage.setItem(specialCacheKey, JSON.stringify({ savedAt: Date.now(), includeTrees, layers })); } catch (error) { console.warn('Не удалось сохранить кэш объектов', error); }
    specialDataLoaded = true;
    if (includeTrees) treeDataLoaded = true;
    document.querySelector('.legend-note').textContent = 'Основные слои — OSM. Специальные объекты загружены для текущей области карты через Overpass API.';
  } catch (error) {
    console.warn('Не удалось загрузить специальные OSM-слои', error);
    document.querySelector('.legend-note').textContent = 'Основные слои — OSM. Специальные объекты временно недоступны, попробуйте обновить карту позже.';
  } finally { specialRequestInFlight = false; }
}

function applySunTime(hour) {
  const normalized = Math.max(5, Math.min(22, hour));
  const daylight = Math.max(0, Math.sin(((normalized - 6) / 16) * Math.PI));
  const azimuth = 180 + ((normalized - 12) * 12);
  const color = daylight > 0.55 ? '#fff4d6' : (daylight > 0.12 ? '#f3b27c' : '#9db6d8');
  try {
    if (typeof map.setLight === 'function') map.setLight({ anchor: 'map', position: [1.5, azimuth, 45], color, intensity: 0.25 + daylight * 0.75 });
  } catch (error) { console.warn('Освещение времени суток недоступно', error); }
}

const map = new maplibregl.Map({ container: 'map', center: tashkent, zoom: 14.2, pitch: 58, bearing: -18, hash: true, style: 'https://tiles.openfreemap.org/styles/liberty', attributionControl: false });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

map.on('load', () => {
  try {
    map.addSource('terrain-dem', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 15, encoding: 'terrarium' });
    map.setTerrain({ source: 'terrain-dem', exaggeration: 1.25 });
    map.addLayer({ id: 'terrain-hillshade', type: 'hillshade', source: 'terrain-dem', paint: { 'hillshade-shadow-color': '#38505a', 'hillshade-highlight-color': '#fff4d6', 'hillshade-accent-color': '#c69b67', 'hillshade-exaggeration': 0.28 } });
  } catch (error) { console.warn('Рельеф временно недоступен', error); }
  const buildingLayers = map.getStyle().layers.filter((layer) => layer['source-layer'] === 'building').map((layer) => layer.id);
  const roadLayers = map.getStyle().layers.filter((layer) => ['transportation', 'transportation_name'].includes(layer['source-layer'])).map((layer) => layer.id);
  const waterLayers = map.getStyle().layers.filter((layer) => ['water', 'waterway'].includes(layer['source-layer'])).map((layer) => layer.id);
  const greeneryLayers = map.getStyle().layers.filter((layer) => ['park', 'landcover', 'landuse'].includes(layer['source-layer'])).map((layer) => layer.id);
  try {
    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 64;
    grassCanvas.height = 64;
    const grassContext = grassCanvas.getContext('2d');
    grassContext.fillStyle = '#b7d79d';
    grassContext.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 90; i += 1) {
      const x = (i * 37) % 64;
      const y = (i * 53) % 64;
      grassContext.fillStyle = i % 3 === 0 ? '#7fae78' : '#cbe1ad';
      grassContext.fillRect(x, y, 1 + (i % 2), 1);
    }
    map.addImage('grass-pattern', grassContext.getImageData(0, 0, 64, 64), { pixelRatio: 2 });
    greeneryLayers.forEach((id) => {
      const layer = map.getLayer(id);
      if (layer?.type === 'fill') { try { map.setPaintProperty(id, 'fill-pattern', 'grass-pattern'); } catch (error) { console.warn('Не удалось применить текстуру зелени', id); } }
    });
  } catch (error) { console.warn('Текстура зелени временно недоступна', error); }
  try {
    const waterCanvas = document.createElement('canvas');
    waterCanvas.width = 64;
    waterCanvas.height = 64;
    const waterContext = waterCanvas.getContext('2d');
    waterContext.fillStyle = '#79b8e8';
    waterContext.fillRect(0, 0, 64, 64);
    waterContext.strokeStyle = 'rgba(235, 250, 255, .7)';
    waterContext.lineWidth = 1;
    for (let y = 8; y < 64; y += 14) { waterContext.beginPath(); waterContext.moveTo(0, y); waterContext.quadraticCurveTo(16, y - 4, 32, y); waterContext.quadraticCurveTo(48, y + 4, 64, y); waterContext.stroke(); }
    map.addImage('water-pattern', waterContext.getImageData(0, 0, 64, 64), { pixelRatio: 2 });
    waterLayers.forEach((id) => { const layer = map.getLayer(id); if (layer?.type === 'fill') { try { map.setPaintProperty(id, 'fill-pattern', 'water-pattern'); } catch (error) { console.warn('Не удалось применить текстуру воды', id); } } });
    let waterPhase = 0;
    setInterval(() => {
      waterPhase += 1;
      const shift = [Math.sin(waterPhase / 10) * 3, Math.cos(waterPhase / 13) * 1.5];
      waterLayers.forEach((id) => { if (map.getLayer(id)) { try { map.setPaintProperty(id, 'fill-translate', shift); } catch (error) {} } });
    }, 180);
  } catch (error) { console.warn('Анимация воды временно недоступна', error); }
  applySunTime(Number(document.querySelector('#time-of-day')?.value || 14));
  const sourceNames = ['signals', 'crossings', 'trees', 'footways', 'underground', 'undergroundEntrances', 'undergroundPortals', 'undergroundRamps', 'bridgeDecks', 'bridgeSlabs', 'bridgeApproaches', 'treeTrunks', 'treeCrowns'];
  sourceNames.forEach((name) => map.addSource('osm-' + name, { type: 'geojson', data: emptyCollection() }));
  map.addLayer({ id: 'osm-footways', type: 'line', source: 'osm-footways', paint: { 'line-color': '#f4f0d8', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 3], 'line-opacity': 0.75 } });
  map.addLayer({ id: 'osm-bridge-approaches', type: 'fill-extrusion', source: 'osm-bridgeApproaches', paint: { 'fill-extrusion-color': '#84776b', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.74 } });
  map.addLayer({ id: 'osm-bridge-slabs', type: 'fill-extrusion', source: 'osm-bridgeSlabs', paint: { 'fill-extrusion-color': '#75695e', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.68 } });
  map.addLayer({ id: 'osm-bridge-shadow', type: 'line', source: 'osm-bridgeDecks', paint: { 'line-color': '#5b321b', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 17, 18], 'line-opacity': 0.35, 'line-blur': 2 } });
  map.addLayer({ id: 'osm-bridge-deck', type: 'line', source: 'osm-bridgeDecks', paint: { 'line-color': '#b9783f', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 12], 'line-opacity': 0.95 } });
  map.addLayer({ id: 'osm-bridge-rails', type: 'line', source: 'osm-bridgeDecks', paint: { 'line-color': '#ead0a0', 'line-width': 1.5, 'line-offset': 5, 'line-opacity': 0.9 } });
  map.addLayer({ id: 'osm-underground-portals', type: 'fill-extrusion', source: 'osm-undergroundPortals', paint: { 'fill-extrusion-color': '#9b69c8', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.9 } });
  map.addLayer({ id: 'osm-underground-ramps', type: 'fill-extrusion', source: 'osm-undergroundRamps', paint: { 'fill-extrusion-color': '#c899f2', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.84 } });
  map.addLayer({ id: 'osm-underground-shadow', type: 'line', source: 'osm-underground', paint: { 'line-color': '#432d58', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 9, 18, 18], 'line-opacity': 0.38, 'line-blur': 2 } });
  map.addLayer({ id: 'osm-underground', type: 'line', source: 'osm-underground', paint: { 'line-color': '#c899f2', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 18, 7], 'line-dasharray': [1.2, 1], 'line-opacity': 0.98 } });
  map.addLayer({ id: 'osm-underground-entrances', type: 'circle', source: 'osm-undergroundEntrances', paint: { 'circle-color': '#e0b6ff', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 18, 9], 'circle-stroke-color': '#432d58', 'circle-stroke-width': 2, 'circle-opacity': 0.98 } });
  map.addLayer({ id: 'osm-crossings', type: 'circle', source: 'osm-crossings', paint: { 'circle-color': '#ffe37a', 'circle-radius': 5, 'circle-stroke-color': '#162324', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'osm-signals', type: 'circle', source: 'osm-signals', paint: { 'circle-color': '#f07062', 'circle-radius': 5, 'circle-stroke-color': '#fff3e4', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'osm-tree-trunks', type: 'fill-extrusion', source: 'osm-treeTrunks', paint: { 'fill-extrusion-color': '#765034', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.95 } });
  map.addLayer({ id: 'osm-tree-crowns', type: 'fill-extrusion', source: 'osm-treeCrowns', paint: { 'fill-extrusion-color': '#398a58', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.84 } });
  map.__layerGroups = { buildings: buildingLayers, roads: roadLayers, water: waterLayers, greenery: greeneryLayers, crossings: ['osm-crossings'], underground: ['osm-underground-portals', 'osm-underground-ramps', 'osm-underground-shadow', 'osm-underground', 'osm-underground-entrances'], trees: ['osm-tree-trunks', 'osm-tree-crowns'], bridges: ['osm-bridge-approaches', 'osm-bridge-slabs', 'osm-bridge-shadow', 'osm-bridge-deck', 'osm-bridge-rails'], terrain: ['terrain-hillshade'], footways: ['osm-footways'], signals: ['osm-signals'] };
  map.on('click', buildingLayers, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setHTML('<strong>' + (feature.properties.name || 'Здание') + '</strong><br>Оценочная высота: ' + (feature.properties.render_height || 'нет данных') + ' м<br><small>OpenStreetMap / OpenMapTiles</small>').addTo(map);
  });
  map.on('click', 'osm-bridge-deck', (event) => {
    const feature = event.features?.[0];
    const name = feature?.properties?.name || (feature?.properties?.highway === 'footway' ? 'Надземный пешеходный переход' : 'Мост');
    new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setHTML('<strong>' + name + '</strong><br>Объёмная плита и перила построены по данным OpenStreetMap.<br><small>Тип: ' + (feature?.properties?.highway || 'мост') + '</small>').addTo(map);
  });
  map.on('click', 'osm-tree-crowns', (event) => {
    new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setHTML('<strong>Дерево</strong><br>Объёмная крона и ствол. Координата взята из OpenStreetMap.').addTo(map);
  });
  map.on('click', 'osm-underground-portals', (event) => {
    const feature = event.features?.[0];
    new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setHTML('<strong>' + (feature?.properties?.role || 'Подземный переход') + '</strong><br>Объёмный вход с наклонным спуском. Глубина не моделируется по данным OSM.').addTo(map);
  });
  map.on('click', 'osm-underground-entrances', (event) => {
    new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setHTML('<strong>Подземный переход</strong><br>Фиолетовая линия показывает путь под землёй, светлая точка — вход или выход.').addTo(map);
  });
  map.on('mouseenter', buildingLayers, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', buildingLayers, () => { map.getCanvas().style.cursor = ''; });
  loadSpecialLayers();
});
map.on('moveend', loadSpecialLayers);
document.querySelectorAll('[data-layer]').forEach((input) => {
  input.addEventListener('change', (event) => {
    const ids = map.__layerGroups?.[event.target.dataset.layer] || [];
    ids.forEach((id) => map.setLayoutProperty(id, 'visibility', event.target.checked ? 'visible' : 'none'));
  });
});
const timeControl = document.querySelector('#time-of-day');
const timeValue = document.querySelector('#time-value');
if (timeControl && timeValue) {
  timeControl.addEventListener('input', (event) => {
    const hour = Number(event.target.value);
    timeValue.textContent = String(hour).padStart(2, '0') + ':00';
    applySunTime(hour);
  });
}
document.querySelector('#reset-view').addEventListener('click', () => map.flyTo({ center: tashkent, zoom: 14.2, pitch: 58, bearing: -18, essential: true }));
document.querySelector('#toggle-panel').addEventListener('click', (event) => {
  const panel = document.querySelector('.control-panel');
  const collapsed = panel.classList.toggle('is-collapsed');
  event.currentTarget.textContent = collapsed ? '+' : '−';
  event.currentTarget.setAttribute('aria-label', collapsed ? 'Раскрыть панель' : 'Свернуть панель');
});
