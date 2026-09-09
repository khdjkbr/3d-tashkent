const tashkent = [69.2401, 41.2995];

const map = new maplibregl.Map({
  container: 'map',
  center: tashkent,
  zoom: 14.2,
  pitch: 58,
  bearing: -18,
  hash: true,
  style: 'https://tiles.openfreemap.org/styles/3d',
  attributionControl: false
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

map.on('load', () => {
  const buildingLayers = map.getStyle().layers.filter((layer) => layer['source-layer'] === 'building').map((layer) => layer.id);
  const roadLayers = map.getStyle().layers.filter((layer) => ['transportation', 'transportation_name'].includes(layer['source-layer'])).map((layer) => layer.id);
  const waterLayers = map.getStyle().layers.filter((layer) => ['water', 'waterway'].includes(layer['source-layer'])).map((layer) => layer.id);
  const greeneryLayers = map.getStyle().layers.filter((layer) => ['park', 'landcover', 'landuse'].includes(layer['source-layer'])).map((layer) => layer.id);
  map.__layerGroups = { buildings: buildingLayers, roads: roadLayers, water: waterLayers, greenery: greeneryLayers };

  map.on('click', buildingLayers, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    new maplibregl.Popup({ closeButton: true, offset: 12 })
      .setLngLat(event.lngLat)
      .setHTML(`<strong>${feature.properties.name || 'Здание'}</strong><br>Оценочная высота: ${feature.properties.render_height || 'нет данных'} м<br><small>OpenStreetMap / OpenMapTiles</small>`)
      .addTo(map);
  });
  map.on('mouseenter', buildingLayers, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', buildingLayers, () => { map.getCanvas().style.cursor = ''; });
});

document.querySelectorAll('[data-layer]').forEach((input) => {
  input.addEventListener('change', (event) => {
    const layer = event.target.dataset.layer;
    const ids = map.__layerGroups?.[layer] || [];
    ids.forEach((id) => map.setLayoutProperty(id, 'visibility', event.target.checked ? 'visible' : 'none'));
  });
});

document.querySelector('#reset-view').addEventListener('click', () => {
  map.flyTo({ center: tashkent, zoom: 14.2, pitch: 58, bearing: -18, essential: true });
});
