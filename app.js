const tashkent = [69.2401, 41.2995];

const demoData = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { height: 32, name: 'Демонстрационное здание' }, geometry: { type: 'Polygon', coordinates: [[[69.2388,41.3012],[69.2400,41.3012],[69.2400,41.3020],[69.2388,41.3020],[69.2388,41.3012]]] } },
    { type: 'Feature', properties: { height: 20, name: 'Демонстрационное здание' }, geometry: { type: 'Polygon', coordinates: [[[69.2410,41.2983],[69.2420,41.2983],[69.2420,41.2991],[69.2410,41.2991],[69.2410,41.2983]]] } },
    { type: 'Feature', properties: { height: 12, name: 'Демонстрационное здание' }, geometry: { type: 'Polygon', coordinates: [[[69.2367,41.2990],[69.2378,41.2990],[69.2378,41.2997],[69.2367,41.2997],[69.2367,41.2990]]] } }
  ]
};

const map = new maplibregl.Map({
  container: 'map',
  center: tashkent,
  zoom: 14.2,
  pitch: 58,
  bearing: -18,
  hash: true,
  style: {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
      terrain: { type: 'raster-dem', tiles: ['https://demotiles.maplibre.org/terrain-tiles/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 12 },
      demo: { type: 'geojson', data: demoData }
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm' },
      { id: 'demo-buildings', type: 'fill-extrusion', source: 'demo', paint: { 'fill-extrusion-color': '#d99d74', 'fill-extrusion-height': ['get','height'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': .82 } }
    ],
    terrain: { source: 'terrain', exaggeration: 1.6 },
    sky: { 'sky-color': '#152a2c', 'sky-horizon-blend': .35, 'horizon-color': '#93b8ae', 'sky-zenith-color': '#061214' }
  },
  attributionControl: false
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

map.on('load', () => {
  map.setTerrain({ source: 'terrain', exaggeration: 1.6 });
  map.on('click', 'demo-buildings', (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    new maplibregl.Popup({ closeButton: true, offset: 12 })
      .setLngLat(event.lngLat)
      .setHTML(`<strong>${feature.properties.name}</strong><br>Высота: ${feature.properties.height} м<br><small>Демо-объект</small>`)
      .addTo(map);
  });
  map.on('mouseenter', 'demo-buildings', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'demo-buildings', () => { map.getCanvas().style.cursor = ''; });
});

document.querySelectorAll('[data-layer]').forEach((input) => {
  input.addEventListener('change', (event) => {
    const layer = event.target.dataset.layer;
    if (layer === 'buildings') map.setLayoutProperty('demo-buildings', 'visibility', event.target.checked ? 'visible' : 'none');
  });
});

document.querySelector('#reset-view').addEventListener('click', () => {
  map.flyTo({ center: tashkent, zoom: 14.2, pitch: 58, bearing: -18, essential: true });
});
