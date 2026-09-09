const tashkent = [69.2401, 41.2995];
const overpassUrl = 'https://overpass-api.de/api/interpreter';
let specialRequestInFlight = false;
let specialDataLoaded = false;

function emptyCollection() { return { type: 'FeatureCollection', features: [] }; }
function pointFeature(element, kind) { return { type: 'Feature', properties: { kind, ...element.tags }, geometry: { type: 'Point', coordinates: [element.lon, element.lat] } }; }
function coordinatePoint(point, kind, properties = {}) { return { type: 'Feature', properties: { kind, ...properties }, geometry: { type: 'Point', coordinates: [point.lon, point.lat] } }; }
function wayFeature(element, kind) { return { type: 'Feature', properties: { kind, ...element.tags }, geometry: { type: 'LineString', coordinates: (element.geometry || []).map((point) => [point.lon, point.lat]) } }; }
function bridgeDeckFeature(a, b, element) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 0.000001);
  const halfWidth = element.tags?.highway === 'footway' ? 0.000025 : 0.00007;
  const ox = -dy / length * halfWidth;
  const oy = dx / length * halfWidth;
  const height = element.tags?.highway === 'footway' ? 4.5 : 6;
  return { type: 'Feature', properties: { kind: 'bridge-deck', height, name: element.tags?.name || (element.tags?.highway === 'footway' ? 'Надземный переход' : 'Мост') }, geometry: { type: 'Polygon', coordinates: [[[a.lon + ox, a.lat + oy], [b.lon + ox, b.lat + oy], [b.lon - ox, b.lat - oy], [a.lon - ox, a.lat - oy], [a.lon + ox, a.lat + oy]]] } };
}

function convertOverpass(data) {
  const result = { signals: emptyCollection(), crossings: emptyCollection(), trees: emptyCollection(), footways: emptyCollection(), underground: emptyCollection(), undergroundEntrances: emptyCollection(), bridgeDecks: emptyCollection() };
  data.elements.forEach((element) => {
    const tags = element.tags || {};
    if (element.type === 'node' && tags.highway === 'traffic_signals') result.signals.features.push(pointFeature(element, 'traffic_signals'));
    if (element.type === 'node' && tags.highway === 'crossing') result.crossings.features.push(pointFeature(element, 'crossing'));
    if (element.type === 'node' && tags.natural === 'tree') result.trees.features.push(pointFeature(element, 'tree'));
    if (element.type === 'way' && (['footway', 'path', 'pedestrian', 'cycleway'].includes(tags.highway) || tags.bridge === 'yes')) {
      const points = element.geometry || [];
      const isUnderground = tags.tunnel === 'yes' || tags.covered === 'yes' || tags.layer === '-1';
      const isBridge = !isUnderground && tags.bridge === 'yes';
      const target = isUnderground ? result.underground : result.footways;
      if (points.length > 1) {
        if (isBridge) {
          for (let index = 0; index < points.length - 1; index += 1) result.bridgeDecks.features.push(bridgeDeckFeature(points[index], points[index + 1], element));
        }
        target.features.push(wayFeature(element, isUnderground ? 'underground' : 'footway'));
        if (isUnderground) {
          result.undergroundEntrances.features.push(coordinatePoint(points[0], 'underground-entrance', { role: 'Вход в подземный переход' }));
          result.undergroundEntrances.features.push(coordinatePoint(points[points.length - 1], 'underground-exit', { role: 'Выход из подземного перехода' }));
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
  const query = '[out:json][timeout:25];(node[highway=traffic_signals](' + bbox + ');node[highway=crossing](' + bbox + ');node[natural=tree](' + bbox + ');way[highway~"^(footway|path|pedestrian|cycleway|primary|secondary|tertiary|trunk|motorway)$"](' + bbox + '););out body geom;';
  try {
    const response = await fetch(overpassUrl + '?data=' + encodeURIComponent(query));
    if (!response.ok) throw new Error('Overpass ' + response.status);
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
map.addSource('tashkent-terrain', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium' });
map.setTerrain({ source: 'tashkent-terrain', exaggeration: 1.15 });
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

map.on('load', () => {
  const buildingLayers = map.getStyle().layers.filter((layer) => layer['source-layer'] === 'building').map((layer) => layer.id);
  const roadLayers = map.getStyle().layers.filter((layer) => ['transportation', 'transportation_name'].includes(layer['source-layer'])).map((layer) => layer.id);
  const waterLayers = map.getStyle().layers.filter((layer) => ['water', 'waterway'].includes(layer['source-layer'])).map((layer) => layer.id);
  const greeneryLayers = map.getStyle().layers.filter((layer) => ['park', 'landcover', 'landuse'].includes(layer['source-layer'])).map((layer) => layer.id);
  const sourceNames = ['signals', 'crossings', 'trees', 'footways', 'underground', 'undergroundEntrances', 'bridgeDecks'];
  sourceNames.forEach((name) => map.addSource('osm-' + name, { type: 'geojson', data: emptyCollection() }));
  map.addLayer({ id: 'osm-footways', type: 'line', source: 'osm-footways', paint: { 'line-color': '#f4f0d8', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 17, 3], 'line-opacity': 0.75 } });
  map.addLayer({ id: 'osm-underground-shadow', type: 'line', source: 'osm-underground', paint: { 'line-color': '#432d58', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 9, 18, 18], 'line-opacity': 0.38, 'line-blur': 2 } });
  map.addLayer({ id: 'osm-underground', type: 'line', source: 'osm-underground', paint: { 'line-color': '#c899f2', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 18, 7], 'line-dasharray': [1.2, 1], 'line-opacity': 0.98 } });
  map.addLayer({ id: 'osm-underground-entrances', type: 'circle', source: 'osm-undergroundEntrances', paint: { 'circle-color': '#e0b6ff', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 5, 18, 9], 'circle-stroke-color': '#432d58', 'circle-stroke-width': 2, 'circle-opacity': 0.98 } });
  map.addLayer({ id: 'osm-crossings', type: 'circle', source: 'osm-crossings', paint: { 'circle-color': '#ffe37a', 'circle-radius': 5, 'circle-stroke-color': '#162324', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'osm-signals', type: 'circle', source: 'osm-signals', paint: { 'circle-color': '#f07062', 'circle-radius': 5, 'circle-stroke-color': '#fff3e4', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'osm-trees', type: 'circle', source: 'osm-trees', paint: { 'circle-color': '#74c69d', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 5], 'circle-opacity': 0.85 } });
  map.__layerGroups = { buildings: buildingLayers, roads: roadLayers, water: waterLayers, greenery: greeneryLayers, crossings: ['osm-crossings'], underground: ['osm-underground-shadow', 'osm-underground', 'osm-underground-entrances'], trees: ['osm-trees'], footways: ['osm-footways'], signals: ['osm-signals'] };
  map.on('click', buildingLayers, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    new maplibregl.Popup({ closeButton: true, offset: 12 }).setLngLat(event.lngLat).setHTML('<strong>' + (feature.properties.name || 'Здание') + '</strong><br>Оценочная высота: ' + (feature.properties.render_height || 'нет данных') + ' м<br><small>OpenStreetMap / OpenMapTiles</small>').addTo(map);
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
