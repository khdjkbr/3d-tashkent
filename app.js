const tashkent = [69.2401, 41.2995];
const overpassUrls = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let specialRequestInFlight = false;
let specialDataLoaded = false;

function emptyCollection() { return { type: 'FeatureCollection', features: [] }; }
function pointFeature(element, kind) { return { type: 'Feature', properties: { kind, ...element.tags }, geometry: { type: 'Point', coordinates: [element.lon, element.lat] } }; }
function coordinatePoint(point, kind, properties = {}) { return { type: 'Feature', properties: { kind, ...properties }, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } }; }
function treePartFeature(element, part) {
  const isUpperCrown = part === 'crown-upper';
  const size = part === 'trunk' ? 0.000012 : (isUpperCrown ? 0.000025 : 0.000035);
  const base = part === 'trunk' ? 0 : (isUpperCrown ? 5.2 : 2.2);
  const height = part === 'trunk' ? 2.2 : (isUpperCrown ? 8.4 : 6.5);
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
function bridgeSlabFeature(a, b, element) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const length = Math.hypot(dx, dy) || 1;
  const halfWidth = element.tags?.highway === 'footway' ? 0.000035 : 0.00009;
  const px = (-dy / length) * halfWidth;
  const py = (dx / length) * halfWidth;
  const base = element.tags?.highway === 'footway' ? 4.5 : 6;
  return { type: 'Feature', properties: { kind: 'bridge-slab', base, height: base + 0.45 }, geometry: { type: 'Polygon', coordinates: [[[a.lon + px, a.lat + py], [b.lon + px, b.lat + py], [b.lon - px, b.lat - py], [a.lon - px, a.lat - py], [a.lon + px, a.lat + py]]] } };
}
function wayFeature(element, kind) { return { type: 'Feature', properties: { kind, ...element.tags }, geometry: { type: 'LineString', coordinates: (element.geometry || []).map((point) => [point.lon, point.lat]) } }; }
function bridgeDeckFeature(a, b, element) {
  const height = element.tags?.highway === 'footway' ? 4.5 : 6;
  return { type: 'Feature', properties: { kind: 'bridge-deck', height, name: element.tags?.name || (element.tags?.highway === 'footway' ? 'Надземный переход' : 'Мост') }, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } };
}

function convertOverpass(data) {
  const result = { signals: emptyCollection(), crossings: emptyCollection(), trees: emptyCollection(), treeTrunks: emptyCollection(), treeCrowns: emptyCollection(), footways: emptyCollection(), underground: emptyCollection(), undergroundEntrances: emptyCollection(), undergroundPortals: emptyCollection(), undergroundRamps: emptyCollection(), bridgeDecks: emptyCollection(), bridgeSlabs: emptyCollection() };
  data.elements.forEach((element) => {
    const tags = element.tags || {};
    if (element.type === 'node' && tags.highway === 'traffic_signals') result.signals.features.push(pointFeature(element, 'traffic_signals'));
    if (element.type === 'node' && tags.highway === 'crossing') result.crossings.features.push(pointFeature(element, 'crossing'));
    if (element.type === 'node' && tags.natural === 'tree') { result.trees.features.push(pointFeature(element, 'tree')); result.treeTrunks.features.push(treePartFeature(element, 'trunk')); result.treeCrowns.features.push(treePartFeature(element, 'crown')); result.treeCrowns.features.push(treePartFeature(element, 'crown-upper')); }
    if (element.type === 'way' && (['footway', 'path', 'pedestrian', 'cycleway'].includes(tags.highway) || tags.bridge === 'yes' || tags.tunnel === 'yes' || tags.covered === 'yes')) {
      const points = element.geometry || [];
      const isUnderground = tags.tunnel === 'yes' || tags.covered === 'yes' || tags.layer === '-1';
      const isBridge = !isUnderground && tags.bridge === 'yes';
      const target = isUnderground ? result.underground : result.footways;
      if (points.length > 1) {
        if (isBridge) {
          for (let index = 0; index < points.length - 1; index += 1) result.bridgeDecks.features.push(bridgeDeckFeature(points[index], points[index + 1], element)); result.bridgeSlabs.features.push(bridgeSlabFeature(points[index], points[index + 1], element));
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
  if (specialRequestInFlight || specialDataLoaded || map.getZoom() < 13) return;
  specialRequestInFlight = true;
  const bounds = map.getBounds();
  const bbox = bounds.getSouth() + ',' + bounds.getWest() + ',' + bounds.getNorth() + ',' + bounds.getEast();
  const query = '[out:json][timeout:25];(node[highway=traffic_signals](' + bbox + ');node[highway=crossing](' + bbox + ');node[natural=tree](' + bbox + ');way[highway~"^(footway|path|pedestrian|cycleway|primary|secondary|tertiary|trunk|motorway)$"](' + bbox + ');way[bridge=yes](' + bbox + ');way[tunnel=yes](' + bbox + ');way[covered=yes](' + bbox + '););out body geom;';
  try {
    let response;
    for (const endpoint of overpassUrls) {
      try {
        const candidate = await fetch(endpoint + '?data=' + encodeURIComponent(query));
        if (candidate.ok) { response = candidate; break; }
      } catch (error) { console.warn('Overpass endpoint unavailable', endpoint); }
    }
    if (!response) throw new Error('Overpass endpoints unavailable');
    const layers = convertOverpass(await response.json());
    Object.entries(layers).forEach(([name, geojson]) => map.getSource('osm-' + name).setData(geojson));
    specialDataLoaded = true;
    document.querySelector('.legend-note').textContent = 'Основные слои — OSM. Специальные объекты загружены для текущей области карты через Overpass API.';
  } catch (error) {
    console.warn('Не удалось загрузить специальные OSM-слои', error);
    document.querySelector('.legend-note').textContent = 'Основные слои — OSM. Специальные объекты временно недоступны, попробуйте обновить карту позже.';
  } finally { specialRequestInFlight = false; }
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
  const sourceNames = ['signals', 'crossings', 'trees', 'footways', 'underground', 'undergroundEntrances', 'undergroundPortals', 'undergroundRamps', 'bridgeDecks', 'bridgeSlabs', 'treeTrunks', 'treeCrowns'];
  sourceNames.forEach((name) => map.addSource('osm-' + name, { type: 'geojson', data: emptyCollection() }));
  map.addLayer({ id: 'osm-footways', type: 'line', source: 'osm-footways', paint: { 'line-color': '#f4f0d8', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 3], 'line-opacity': 0.75 } });
  map.addLayer({ id: 'osm-bridge-slabs', type: 'fill-extrusion', source: 'osm-bridgeSlabs', paint: { 'fill-extrusion-color': '#9d6334', 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 0.96 } });
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
  map.__layerGroups = { buildings: buildingLayers, roads: roadLayers, water: waterLayers, greenery: greeneryLayers, crossings: ['osm-crossings'], underground: ['osm-underground-portals', 'osm-underground-ramps', 'osm-underground-shadow', 'osm-underground', 'osm-underground-entrances'], trees: ['osm-tree-trunks', 'osm-tree-crowns'], bridges: ['osm-bridge-slabs', 'osm-bridge-shadow', 'osm-bridge-deck', 'osm-bridge-rails'], terrain: ['terrain-hillshade'], footways: ['osm-footways'], signals: ['osm-signals'] };
  map.on('click', buildingLayers, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setHTML('<strong>' + (feature.properties.name || 'Здание') + '</strong><br>Оценочная высота: ' + (feature.properties.render_height || 'нет данных') + ' м<br><small>OpenStreetMap / OpenMapTiles</small>').addTo(map);
  });
  map.on('click', 'osm-bridge-deck', (event) => {
    const feature = event.features?.[0];
    const name = feature?.properties?.name || 'Мост или надземный переход';
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
document.querySelector('#reset-view').addEventListener('click', () => map.flyTo({ center: tashkent, zoom: 14.2, pitch: 58, bearing: -18, essential: true }));
document.querySelector('#toggle-panel').addEventListener('click', (event) => {
  const panel = document.querySelector('.control-panel');
  const collapsed = panel.classList.toggle('is-collapsed');
  event.currentTarget.textContent = collapsed ? '+' : '−';
  event.currentTarget.setAttribute('aria-label', collapsed ? 'Раскрыть панель' : 'Свернуть панель');
});
