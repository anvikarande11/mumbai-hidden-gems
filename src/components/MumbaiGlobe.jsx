/**
 * MumbaiGlobe.jsx
 *
 * A globe that IS Mumbai.
 *
 * react-globe.gl draws the real Earth, so a 40 km city is a speck on a 40,000 km
 * sphere. Instead of fighting that with camera tricks, every coordinate that goes
 * into the globe (land, roads, pins, labels) is first run through a conformal
 * STEREOGRAPHIC projection centred on Mumbai. The whole sphere becomes a scaled,
 * distortion-free map of the city: 1 sphere-degree is about 0.66 km at the centre,
 * so the island, harbour, Thane Creek and Navi Mumbai fill the visible surface.
 *
 *   - Sea:       the globe material itself (cool grey-blue, lit like a real sphere)
 *   - Land:      extruded warm-paper polygons with a slate coastline
 *   - Roads:     thin slate vector ribbons with semantic zoom (widths and minor streets adapt)
 *   - Pins:      24px category nodes on the exact GPS point; the name badge only
 *                appears on hover, focus or selection. Zoomed out (altitude > DOT_ALT)
 *                they collapse into glowing micro-dots, and scale back up as you zoom in.
 *
 * Everything is vector, so it stays crisp at any zoom level.
 *
 * Props (all optional):
 *   landmarks      [{ name, lat, lng, category?, area?, desc?, studentHack?, color? }]
 *                  category: cafe | pub (bar) | study | streetfood (budget) |
 *                  entertainment (hub) | viewpoint | culture
 *   landFeatures   GeoJSON Polygon/MultiPolygon features, [lng, lat]
 *   roadPaths      [{ name, kind, points: [[lng, lat], ...] }]
 *   streets        GeoJSON FeatureCollection of LineStrings (e.g. an OSM export).
 *                  properties.kind or properties.highway sets the style.
 *   neighborhoods  GeoJSON FeatureCollection (or plain array of features) of Polygon /
 *                  MultiPolygon zones, e.g. your neighborhoods.js. Each zone gets a soft tint,
 *                  a border, an atlas-style name (properties.name) and a hover glow.
 *                  Optional per-zone overrides: properties.minAlt / properties.maxAlt.
 *   placeLabels    [{ name, lat, lng, major? }]   waterLabels  [{ name, lat, lng, maxAlt? }]
 *   onLandmarkClick(landmark)
 *   active         start the opening glide once true (lets an intro screen sit on top)
 *   blind          hide names and ignore selection (used by the Spin & Find game)
 *   visitedIds     Set of landmark ids to mark as discovered
 *   overlayActive  true while a modal / overlay is open: pins and labels are hidden and made
 *                  non-interactive so they can never show through the dialog
 *   autoDetectOverlays  also hide pins automatically while any [aria-modal="true"],
 *                  [role="dialog"] or [data-mg-overlay] element exists outside this component
 *
 * Ref methods: focus(id) selects a pin and flies to it, recenter() resets the view.
 */

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const MUMBAI_CENTER = { lat: 19.076, lng: 72.8777 };

const RAD = Math.PI / 180;

// Stereographic "sphere radius" in real km. Smaller = the city fills more of the globe.
// At 38 km the whole Mumbai island spans roughly 60 degrees of the sphere.
const MAP_SCALE_KM = 38;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.32 * Math.cos(MUMBAI_CENTER.lat * RAD);
const DEG_PER_KM = 1 / MAP_SCALE_KM / RAD; // sphere degrees per real km at the centre

// Camera (altitude = camera height in globe radii)
const MIN_ALTITUDE = 0.012;
const MAX_ALTITUDE = 1.3;
const FOCUS_ALTITUDE = 0.1; // when a pin is selected
const INTRO_ALTITUDE = 1.2; // opening shot, whole city as a globe
const MAX_PAN_DEG = 50; // soft wall: how far from the map centre the view may travel

// Palette: pastel map, off-white land, slate linework
const BACKGROUND = '#e8f4f8';
const SEA = '#c4def0';
const LAND = '#fafaf7';
const LAND_SIDE = '#d5dde6';
const COAST = '#94a3b8';
const ATMOSPHERE = '#cfe5f5';

// Layer heights, fractions of globe radius. Each road class gets its own height so
// crossing roads never z-fight.
const LAND_ALT = 0.003;
const ROAD_ALT = LAND_ALT + 0.0008;
const PIN_ALT = LAND_ALT + 0.002;

// Phase 1: adaptive pins and altitude-based typography.
// Above DOT_ALT pins are ~7px glowing micro-dots; below FULL_ALT they are full 24px icons;
// in between the scale eases smoothly.
const DOT_ALT = 1.0;
const FULL_ALT = 0.35;
const DOT_SCALE = 0.3; // 24px * 0.3 = ~7px
// Minor place labels are hidden above this altitude and fade in over MINOR_LABEL_FADE below it.
const MINOR_LABEL_MAX_ALT = 0.55;
const MINOR_LABEL_FADE = 0.12;

// Phase 2: zone shading, atlas typography and hover glow.
const ZONE_ALT = LAND_ALT + 0.0005; // zone tint sits just above the land cap, below the roads
const ZONE_FILL_ALPHA = 0.1;
const ZONE_FILL_HOVER_ALPHA = 0.34;
const ZONE_BORDER = 'rgba(100,116,139,0.38)';
const ZONE_HUES = ['#5b9bd5', '#d9779a', '#5fb98a', '#e0a23c', '#9a82d6', '#4fb3b0', '#e58a63', '#9bb84a'];
// Region-name zoom bands by zone area (km2): [minArea, minAlt, maxAlt, fontPx]. Big zones are
// named from far away, small ones only up close. Labels fade over REGION_FADE_* of altitude.
const REGION_TIERS = [
  [60, 0.28, 1.5, 14],
  [15, 0.14, 0.85, 12],
  [0, 0.05, 0.5, 10.5],
];
const REGION_FADE_FAR = 0.15;
const REGION_FADE_NEAR = 0.08;

// Road styles. `km` is the real-world ribbon width at the reference zoom.
const ROAD_STYLES = {
  boundary: { color: '#dde3ea', km: 0.016, lift: 0 },
  minor: { color: '#dde3ea', km: 0.022, lift: 0.0004 },
  arterial: { color: '#a3b1c2', km: 0.045, lift: 0.0008 },
  expressway: { color: '#8497ae', km: 0.07, lift: 0.0012 },
  bridge: { color: '#8497ae', km: 0.085, lift: 0.0016 },
};

// OSM `highway=*` values mapped onto our styles.
const HIGHWAY_KIND = {
  motorway: 'expressway',
  motorway_link: 'expressway',
  trunk: 'expressway',
  trunk_link: 'expressway',
  primary: 'arterial',
  primary_link: 'arterial',
  secondary: 'arterial',
  secondary_link: 'arterial',
  tertiary: 'minor',
  tertiary_link: 'minor',
  residential: 'minor',
  unclassified: 'minor',
  living_street: 'minor',
  service: 'minor',
};

// Semantic zoom: road widths and which layers show depend on a bucketed altitude,
// so React only re-renders the vector layers when a bucket boundary is crossed.
const LOD_STEPS = [0.06, 0.1, 0.18, 0.3, 0.5, 0.8, 1.3];
const lodFor = (alt) => LOD_STEPS.find((s) => alt <= s) ?? LOD_STEPS[LOD_STEPS.length - 1];
const strokeScale = (lod) => Math.pow(lod / 0.5, 0.7);
const layerVisible = (kind, lod) => {
  if (kind === 'minor') return lod <= 0.3;
  if (kind === 'boundary') return lod <= 0.8;
  return true;
};

/* -------------------------------------------------------------------------- */
/*  Projection: real lng/lat  ->  position on the "Mumbai sphere"              */
/* -------------------------------------------------------------------------- */

const toPlane = (lng, lat) => [
  (lng - MUMBAI_CENTER.lng) * KM_PER_DEG_LNG,
  (lat - MUMBAI_CENTER.lat) * KM_PER_DEG_LAT,
];

// Stereographic projection (conformal): the map centre sits at sphere (0, 0).
function planeToGlobe(x, y) {
  const rho = Math.hypot(x, y);
  if (rho < 1e-9) return [0, 0];
  const c = 2 * Math.atan(rho / (2 * MAP_SCALE_KM));
  const sinC = Math.sin(c);
  const lat = Math.asin(Math.max(-1, Math.min(1, (y / rho) * sinC))) / RAD;
  const lng = Math.atan2(x * sinC, rho * Math.cos(c)) / RAD;
  return [lng, lat];
}

/** Real GPS -> the lat/lng react-globe.gl should use. Exported for custom overlays. */
export function projectToGlobe(lng, lat) {
  const [vlng, vlat] = planeToGlobe(...toPlane(lng, lat));
  return { lat: vlat, lng: vlng };
}

/**
 * Projects a polyline after subdividing it in map space. Straight real-world
 * segments become curves on the sphere, so long edges need extra vertices.
 */
function virtualizeLine(coords, stepKm = 0.35) {
  const plane = coords.map(([lng, lat]) => toPlane(lng, lat));
  const out = [];
  for (let i = 0; i < plane.length; i += 1) {
    if (i === 0) {
      out.push(planeToGlobe(...plane[0]));
    } else {
      const [x0, y0] = plane[i - 1];
      const [x1, y1] = plane[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / stepKm));
      for (let k = 1; k <= n; k += 1) {
        const t = k / n;
        out.push(planeToGlobe(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
      }
    }
  }
  return out; // [[vlng, vlat], ...]
}

function virtualizePolygons(features) {
  const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
  return features.map((f) => {
    const polys = ringsOf(f.geometry).map((rings) => rings.map((ring) => virtualizeLine(ring)));
    const geometry =
      f.geometry.type === 'Polygon'
        ? { type: 'Polygon', coordinates: polys[0] }
        : { type: 'MultiPolygon', coordinates: polys };
    return { type: 'Feature', properties: f.properties ?? {}, geometry };
  });
}

function virtualizeRoads(roads) {
  return roads
    .filter((r) => r.points && r.points.length > 1)
    .map((r) => {
      const kind = ROAD_STYLES[r.kind] ? r.kind : 'arterial';
      const alt = ROAD_ALT + ROAD_STYLES[kind].lift;
      return {
        name: r.name ?? '',
        kind,
        path: virtualizeLine(r.points, 0.3).map(([lng, lat]) => ({ lat, lng, alt })),
      };
    });
}

/* -------------------------------------------------------------------------- */
/*  Geography (simplified, hand-authored, [lng, lat] like GeoJSON)             */
/* -------------------------------------------------------------------------- */

const closeRing = (pts) => {
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  return fx === lx && fy === ly ? pts : [...pts, pts[0]];
};

const polygonFeature = (name, pts) => ({
  type: 'Feature',
  properties: { name },
  geometry: { type: 'Polygon', coordinates: [closeRing(pts)] },
});

// Salsette + Mumbai island + Thane Creek + Navi Mumbai/Uran mainland.
// Ring runs counter-clockwise from Colaba: up the harbour coast, around the
// mainland frame, then back down the west coast through Mahim Bay.
const MUMBAI_REGION = polygonFeature('Mumbai Metropolitan Region', [
  // Harbour (east) coast, Colaba -> Trombay -> Thane Creek head
  [72.809, 18.904],
  [72.823, 18.906],
  [72.832, 18.912],
  [72.8358, 18.9217], // Gateway of India waterfront
  [72.842, 18.93],
  [72.845, 18.942],
  [72.8465, 18.956],
  [72.85, 18.97],
  [72.856, 18.985],
  [72.863, 18.999], // Sewri
  [72.878, 18.996],
  [72.89, 18.996],
  [72.905, 18.989],
  [72.92, 18.978], // Trombay
  [72.933, 18.99],
  [72.938, 19.01],
  [72.944, 19.033],
  [72.952, 19.055],
  [72.956, 19.08],
  [72.956, 19.105],
  [72.96, 19.135],
  [72.968, 19.16],
  [72.974, 19.18],
  [72.976, 19.19],
  [72.985, 19.2], // Thane Creek head
  // Navi Mumbai / Uran coast, heading south
  [72.999, 19.17],
  [73.002, 19.14],
  [73.005, 19.08],
  [73.015, 19.04],
  [73.01, 19.005],
  [72.98, 18.97],
  [72.955, 18.945], // Nhava Sheva
  [72.935, 18.91],
  [72.93, 18.88], // Uran
  [72.92, 18.83],
  [72.89, 18.73],
  [72.875, 18.65], // Alibag side
  // Frame (kept well outside the default view)
  [72.875, 18.55],
  [73.5, 18.55],
  [73.5, 19.6],
  [72.73, 19.6],
  // Vasai / Mira-Bhayandar coast, heading south
  [72.73, 19.47],
  [72.78, 19.42],
  [72.81, 19.35],
  [72.83, 19.3],
  [72.815, 19.285],
  [72.79, 19.242], // Gorai
  [72.784, 19.22],
  [72.783, 19.195],
  [72.789, 19.175], // Madh / Marve
  [72.812, 19.138], // Versova
  [72.821, 19.11],
  [72.8225, 19.1], // Juhu
  [72.825, 19.085],
  [72.825, 19.07],
  [72.823, 19.058],
  [72.818, 19.049], // Bandra Bandstand
  [72.8185, 19.043], // Bandra Fort
  // Mahim Bay: east along Bandra's shore, around the bay head, back west
  [72.826, 19.0415],
  [72.834, 19.0395],
  [72.8395, 19.035],
  [72.84, 19.03], // Mahim
  [72.834, 19.0255],
  [72.824, 19.0235],
  // Worli -> Haji Ali -> Malabar Hill
  [72.816, 19.023],
  [72.813, 19.015],
  [72.8125, 19.005],
  [72.8125, 18.995],
  [72.8135, 18.984],
  [72.808, 18.973],
  [72.799, 18.961],
  [72.793, 18.95],
  [72.792, 18.944], // Walkeshwar
  [72.801, 18.946],
  [72.811, 18.954], // Girgaum Chowpatty
  // Marine Drive (Back Bay), Nariman Point, Cuffe Parade
  [72.819, 18.947],
  [72.824, 18.94],
  [72.824, 18.933],
  [72.8205, 18.9256], // Nariman Point
  [72.819, 18.92],
  [72.813, 18.915],
]);

const ELEPHANTA = polygonFeature('Elephanta Island', [
  [72.926, 18.96],
  [72.933, 18.957],
  [72.94, 18.962],
  [72.939, 18.971],
  [72.932, 18.97],
  [72.927, 18.965],
]);

const DEFAULT_LAND = [MUMBAI_REGION, ELEPHANTA];

const DEFAULT_ROADS = [
  {
    name: 'Western Express Highway',
    kind: 'expressway',
    points: [
      [72.844, 19.068],
      [72.85, 19.085],
      [72.856, 19.099],
      [72.86, 19.119],
      [72.853, 19.137],
      [72.852, 19.165],
      [72.853, 19.187],
      [72.857, 19.205],
      [72.86, 19.231],
      [72.865, 19.254],
      [72.87, 19.27],
    ],
  },
  {
    name: 'Eastern Express Highway',
    kind: 'expressway',
    points: [
      [72.866, 19.04],
      [72.89, 19.07],
      [72.908, 19.087],
      [72.928, 19.11],
      [72.938, 19.14],
      [72.957, 19.17],
    ],
  },
  {
    name: 'Eastern Freeway',
    kind: 'expressway',
    points: [
      [72.846, 18.952],
      [72.855, 18.98],
      [72.864, 19.005],
      [72.89, 19.014],
      [72.915, 19.03],
      [72.925, 19.045],
    ],
  },
  {
    name: 'Sion-Panvel Highway / Vashi Bridge',
    kind: 'expressway',
    points: [
      [72.865, 19.04],
      [72.89, 19.048],
      [72.925, 19.052],
      [72.952, 19.06],
      [72.98, 19.068],
      [73.007, 19.0765],
    ],
  },
  {
    name: 'Coastal Road',
    kind: 'expressway',
    points: [
      [72.8135, 18.9545],
      [72.805, 18.965],
      [72.81, 18.983],
      [72.813, 19.0],
      [72.816, 19.02],
    ],
  },
  {
    name: 'Bandra-Worli Sea Link',
    kind: 'bridge',
    points: [
      [72.817, 19.025],
      [72.8165, 19.033],
      [72.8178, 19.04],
      [72.819, 19.045],
    ],
  },
  {
    name: 'Marine Drive',
    kind: 'arterial',
    points: [
      [72.8215, 18.9268],
      [72.8252, 18.9335],
      [72.8252, 18.9402],
      [72.821, 18.9468],
      [72.8135, 18.9548],
    ],
  },
  {
    name: 'Colaba-Mahim Spine',
    kind: 'arterial',
    points: [
      [72.828, 18.91],
      [72.834, 18.925],
      [72.835, 18.94],
      [72.832, 18.96],
      [72.833, 18.978],
      [72.84, 18.994],
      [72.841, 19.015],
      [72.84, 19.0415],
    ],
  },
  {
    name: 'S.V. Road / Link Road',
    kind: 'arterial',
    points: [
      [72.834, 19.056],
      [72.837, 19.08],
      [72.844, 19.1],
      [72.845, 19.12],
      [72.848, 19.14],
      [72.849, 19.16],
      [72.848, 19.185],
      [72.849, 19.205],
      [72.857, 19.23],
    ],
  },
  {
    name: 'Santacruz-Chembur Link Road',
    kind: 'arterial',
    points: [
      [72.848, 19.065],
      [72.865, 19.065],
      [72.88, 19.068],
      [72.9, 19.059],
      [72.92, 19.052],
    ],
  },
  {
    name: 'Jogeshwari-Vikhroli Link Road',
    kind: 'arterial',
    points: [
      [72.853, 19.137],
      [72.88, 19.13],
      [72.905, 19.118],
      [72.938, 19.114],
    ],
  },
];

/* -------------------------------------------------------------------------- */
/*  Landmark pins (fallback). Pass your own array via the `landmarks` prop.    */
/*  Shape: { name, lat, lng, desc?, color? }                                   */
/* -------------------------------------------------------------------------- */

export const LANDMARKS = [
  { name: 'Gateway of India', category: 'culture', area: 'Colaba', lat: 18.922, lng: 72.8347, desc: 'Colaba waterfront arch' },
  { name: 'Marine Drive', category: 'viewpoint', area: 'Churchgate', lat: 18.9432, lng: 72.8224, desc: "Queen's Necklace promenade" },
  { name: 'Bandra-Worli Sea Link', category: 'viewpoint', area: 'Mahim Bay', lat: 19.033, lng: 72.8165, desc: 'Cable-stayed bridge over Mahim Bay' },
  { name: 'CSMT', category: 'culture', area: 'Fort', lat: 18.9398, lng: 72.8353, desc: 'Victorian Gothic railway terminus' },
  { name: 'Haji Ali Dargah', category: 'culture', area: 'Worli', lat: 18.9827, lng: 72.8089, desc: 'Islet mosque off Worli' },
  { name: 'Juhu Beach', category: 'streetfood', area: 'Juhu', lat: 19.0985, lng: 72.8245, desc: 'Street food and sunsets' },
  { name: 'Elephanta Caves', category: 'culture', area: 'Harbour', lat: 18.9633, lng: 72.9315, desc: 'Rock-cut temples on the harbour' },
  { name: 'Kanheri Caves', category: 'viewpoint', area: 'Borivali', lat: 19.205, lng: 72.906, desc: 'Buddhist caves in Borivali park' },
];

/* -------------------------------------------------------------------------- */
/*  Labels (approximate centroids; override with the placeLabels prop)         */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PLACES = [
  { name: 'Colaba', lat: 18.9067, lng: 72.8147, major: true },
  { name: 'Fort', lat: 18.9338, lng: 72.8355 },
  { name: 'Malabar Hill', lat: 18.9548, lng: 72.796 },
  { name: 'Byculla', lat: 18.9792, lng: 72.833 },
  { name: 'Worli', lat: 19.0176, lng: 72.817 },
  { name: 'Dadar', lat: 19.0178, lng: 72.8478, major: true },
  { name: 'Mahim', lat: 19.042, lng: 72.845 },
  { name: 'Bandra', lat: 19.0596, lng: 72.8295, major: true },
  { name: 'Santacruz', lat: 19.081, lng: 72.841 },
  { name: 'Kurla', lat: 19.0726, lng: 72.8845, major: true },
  { name: 'Chembur', lat: 19.0522, lng: 72.8994 },
  { name: 'Ghatkopar', lat: 19.086, lng: 72.9081 },
  { name: 'Juhu', lat: 19.1075, lng: 72.8263 },
  { name: 'Andheri', lat: 19.1197, lng: 72.8468, major: true },
  { name: 'Powai', lat: 19.1176, lng: 72.906 },
  { name: 'Goregaon', lat: 19.1663, lng: 72.8526 },
  { name: 'Malad', lat: 19.1872, lng: 72.8484 },
  { name: 'Borivali', lat: 19.2307, lng: 72.8567, major: true },
  { name: 'Mulund', lat: 19.1726, lng: 72.9561 },
  { name: 'Thane', lat: 19.2183, lng: 72.9781, major: true },
  { name: 'Navi Mumbai', lat: 19.035, lng: 73.05, major: true },
];

export const DEFAULT_WATER = [
  { name: 'Arabian Sea', lat: 19.02, lng: 72.7, maxAlt: 1.3 },
  { name: 'Mumbai Harbour', lat: 18.95, lng: 72.885, maxAlt: 0.9 },
  { name: 'Thane Creek', lat: 19.13, lng: 72.978, maxAlt: 0.45 },
  { name: 'Mahim Bay', lat: 19.032, lng: 72.829, maxAlt: 0.35 },
  { name: 'Back Bay', lat: 18.935, lng: 72.812, maxAlt: 0.25 },
];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Convert a GeoJSON FeatureCollection of LineString / MultiLineString features
 * (for example an OSM road export) into the `roadPaths` shape this component uses.
 * Style comes from properties.kind, else properties.highway, else 'arterial'.
 */
export function geoJsonToRoadPaths(featureCollection) {
  const out = [];
  (featureCollection?.features ?? []).forEach((f) => {
    const { type, coordinates } = f.geometry ?? {};
    const p = f.properties ?? {};
    const kind = ROAD_STYLES[p.kind] ? p.kind : HIGHWAY_KIND[p.highway] ?? 'arterial';
    const name = p.name ?? '';
    if (type === 'LineString') out.push({ name, kind, points: coordinates });
    if (type === 'MultiLineString') coordinates.forEach((points) => out.push({ name, kind, points }));
  });
  return out;
}

/** Polygon boundaries + centroid labels from a GeoJSON FeatureCollection. */
function neighborhoodParts(fc) {
  const rings = [];
  const labels = [];
  (fc?.features ?? []).forEach((f) => {
    const { type, coordinates } = f.geometry ?? {};
    const polys = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' ? coordinates : [];
    polys.forEach((poly) => {
      poly.forEach((ring) => rings.push({ name: f.properties?.name, kind: 'boundary', points: ring }));
    });
    const outer = polys[0]?.[0];
    const name = f.properties?.name;
    if (outer && name) {
      const lng = outer.reduce((s, p) => s + p[0], 0) / outer.length;
      const lat = outer.reduce((s, p) => s + p[1], 0) / outer.length;
      labels.push({ name, lat, lng });
    }
  });
  return { rings, labels };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (t) => t * t * (3 - 2 * t);

// Camera altitude -> pin presentation. `scale` drives the node size, `dot` (1 = pure
// micro-dot, 0 = full icon) cross-fades the icon into a solid glowing dot.
function pinMetrics(alt) {
  const near = smoothstep(clamp((DOT_ALT - alt) / (DOT_ALT - FULL_ALT), 0, 1));
  return { scale: DOT_SCALE + (1 - DOT_SCALE) * near, dot: 1 - near, isDot: alt > DOT_ALT };
}

/* ---- Zones (neighborhood polygons) ---------------------------------------- */

const hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const hashStr = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** Accepts a FeatureCollection, a bare array of features, or nothing. */
const toFeatures = (n) => (Array.isArray(n) ? n : Array.isArray(n?.features) ? n.features : []);

const zoneName = (p = {}) => p.name ?? p.Name ?? p.NAME ?? p.zone ?? p.ward ?? p.label ?? '';

const pointInRing = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Area (km2) and a label point that is guaranteed to sit inside the ring. */
function ringStats(ring) {
  const pts = ring.map(([lng, lat]) => toPlane(lng, lat));
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [x0, y0] = pts[j];
    const [x1, y1] = pts[i];
    const k = x0 * y1 - x1 * y0;
    a += k;
    cx += (x0 + x1) * k;
    cy += (y0 + y1) * k;
  }
  a /= 2;
  let c = Math.abs(a) > 1e-9 ? [cx / (6 * a), cy / (6 * a)] : pts[0];
  if (!pointInRing(c[0], c[1], pts)) {
    // Concave zone: take the interior grid point nearest the centroid.
    const xs = pts.map((q) => q[0]);
    const ys = pts.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    let best = null;
    for (let i = 1; i < 24; i += 1) {
      for (let j = 1; j < 24; j += 1) {
        const x = x0 + ((x1 - x0) * i) / 24;
        const y = y0 + ((y1 - y0) * j) / 24;
        if (!pointInRing(x, y, pts)) continue;
        const dist = Math.hypot(x - c[0], y - c[1]);
        if (!best || dist < best.dist) best = { x, y, dist };
      }
    }
    if (best) c = [best.x, best.y];
  }
  return { area: Math.abs(a), lng: c[0] / KM_PER_DEG_LNG + MUMBAI_CENTER.lng, lat: c[1] / KM_PER_DEG_LAT + MUMBAI_CENTER.lat };
}

/**
 * Real-coordinate zone features (tagged for hover and styling) plus one atlas label per
 * named zone. Features are projected later, by virtualizePolygons, like all other geometry.
 */
function buildZones(rawFeatures) {
  const features = [];
  const atlas = [];
  rawFeatures.forEach((f, i) => {
    const type = f?.geometry?.type;
    if (type !== 'Polygon' && type !== 'MultiPolygon') return;
    const polys = type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const valid = polys.length > 0 && polys.every((poly) => Array.isArray(poly) && poly.every((r) => Array.isArray(r) && r.length >= 3));
    if (!valid) return;

    const closed = polys.map((poly) => poly.map(closeRing));
    const name = String(zoneName(f.properties) || '').trim();
    const zid = `zone-${i}`;
    const hue = ZONE_HUES[hashStr(name || zid) % ZONE_HUES.length];
    features.push({
      type: 'Feature',
      properties: { ...f.properties, __zone: true, __zid: zid, __hue: hue },
      geometry: type === 'Polygon' ? { type, coordinates: closed[0] } : { type, coordinates: closed },
    });

    if (!name) return;
    const stats = closed.map((poly) => ringStats(poly[0]));
    const area = stats.reduce((s, q) => s + q.area, 0);
    const anchor = stats.reduce((m, q) => (q.area > m.area ? q : m), stats[0]);
    const [, tMinAlt, tMaxAlt, fs] = REGION_TIERS.find(([minArea]) => area >= minArea);
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    atlas.push({
      name,
      zid,
      hue,
      area,
      fs,
      lat: anchor.lat,
      lng: anchor.lng,
      minAlt: num(f.properties?.minAlt, tMinAlt),
      maxAlt: num(f.properties?.maxAlt, tMaxAlt),
    });
  });
  return { features, atlas };
}

// Polygon layer accessors that do not depend on hover state.
const polySide = (d) => (d.properties?.__zone ? 'rgba(0,0,0,0)' : sideColor());
const polyAlt = (d) => (d.properties?.__zone ? ZONE_ALT : LAND_ALT);
const pointLat = (p) => p.lat;
const pointLng = (p) => p.lng;
const pointAlt = (p) => p.alt;
const roadColor = (d) => ROAD_STYLES[d.kind].color;
const constant = (v) => () => v;
const capColor = constant(LAND);
const sideColor = constant(LAND_SIDE);
const strokeColor = constant(COAST);

const HOME_POV = { ...projectToGlobe(72.855, 19.06), altitude: 0.6 };

/* -------------------------------------------------------------------------- */
/*  DOM markers                                                                */
/* -------------------------------------------------------------------------- */

const icon = (body) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const MARKER_KINDS = {
  cafe: {
    label: 'Café',
    color: '#8a5a3b',
    icon: icon('<path d="M6 2v2M10 2v2M14 2v2"/><path d="M16 8h1a4 4 0 0 1 0 8h-1"/><path d="M4 8h12v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/>'),
  },
  pub: {
    label: 'Pub',
    color: '#9b3d5a',
    icon: icon('<path d="M5 4h14l-7 8z"/><path d="M12 12v9M8 21h8"/>'),
  },
  study: {
    label: 'Study',
    color: '#2f5d8a',
    icon: icon('<path d="M12 7v14"/><path d="M3 4h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v14h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3H3z"/>'),
  },
  food: {
    label: 'Eats',
    color: '#c2571a',
    icon: icon('<path d="M4 7.5Q12 3.5 20 7.5L12 21z"/><circle cx="10.5" cy="10.5" r=".9"/><circle cx="14" cy="11.5" r=".9"/><circle cx="12" cy="15.5" r=".9"/>'),
  },
  play: {
    label: 'Hangout',
    color: '#6d4aa8',
    icon: icon('<rect x="2" y="7" width="20" height="11" rx="5.5"/><path d="M7 10.5v4M5 12.5h4"/><circle cx="15.5" cy="11.5" r=".8"/><circle cx="17.5" cy="13.5" r=".8"/>'),
  },
  viewpoint: {
    label: 'Viewpoint',
    color: '#2f7d6d',
    icon: icon('<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-1.8 5.4a2 2 0 0 1-1.2 1.2l-5.4 1.8 1.8-5.4a2 2 0 0 1 1.2-1.2z"/>'),
  },
  culture: {
    label: 'Culture',
    color: '#a0752c',
    icon: icon('<path d="M3 9.5 12 4l9 5.5z"/><path d="M6 12v6M10 12v6M14 12v6M18 12v6"/><path d="M3 20.5h18"/>'),
  },
};

const CATEGORY_ALIAS = {
  bar: 'pub',
  streetfood: 'food',
  budget: 'food',
  entertainment: 'play',
  hub: 'play',
};

const markerKind = (category) =>
  MARKER_KINDS[category] ?? MARKER_KINDS[CATEGORY_ALIAS[category]] ?? MARKER_KINDS.viewpoint;

// Marker styling lives in one stylesheet so hover, focus and selection share the
// same rules. `--c` is the category colour, `--s` the zoom-dependent base scale.
const MARKER_CSS = `
.mg-node{position:absolute;left:-12px;top:-12px;width:24px;height:24px;color:var(--c);cursor:pointer;pointer-events:auto;outline:none}
.mg-ring,.mg-body{position:absolute;inset:0;border-radius:9999px}
.mg-body{display:flex;align-items:center;justify-content:center;background:#fff;
  border:1px solid color-mix(in srgb,var(--c) 55%,#fff);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 12%,transparent),0 3px 10px color-mix(in srgb,var(--c) 28%,transparent);
  transform:scale(var(--s,1));transition:transform .18s cubic-bezier(.3,.7,.3,1),box-shadow .18s ease}
.mg-ring{border:1.5px solid var(--c);opacity:0;transform:scale(var(--s,1));pointer-events:none}
.mg-body>svg{opacity:calc(1 - var(--dot,0)*1.6);transition:opacity .18s ease}
.mg-body::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--c);
  box-shadow:0 0 16px 5px color-mix(in srgb,var(--c) 55%,transparent);opacity:var(--dot,0);transition:opacity .18s ease}
.mg-node:hover .mg-body,.mg-node:focus-visible .mg-body,.mg-node.is-active .mg-body{
  transform:scale(calc(var(--s,1)*1.25));
  box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 20%,transparent),0 4px 14px color-mix(in srgb,var(--c) 42%,transparent)}
.mg-node:hover .mg-ring,.mg-node:focus-visible .mg-ring,.mg-node.is-active .mg-ring{animation:mg-pulse 1.8s ease-out infinite}
@keyframes mg-pulse{from{opacity:.5;transform:scale(calc(var(--s,1)*1.1))}to{opacity:0;transform:scale(calc(var(--s,1)*2.4))}}
.mg-tip{position:absolute;left:50%;bottom:calc(100% + 8px);display:flex;flex-direction:column;gap:1px;padding:6px 10px;
  max-width:240px;white-space:nowrap;pointer-events:none;border-radius:10px;
  background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(10px) saturate(1.5);backdrop-filter:blur(10px) saturate(1.5);
  border:1px solid rgba(148,163,184,.35);box-shadow:0 6px 18px rgba(51,65,85,.14);
  opacity:0;visibility:hidden;transform:translate(-50%,4px);
  transition:opacity .18s ease,transform .18s ease,visibility 0s linear .18s}
.mg-node:hover .mg-tip,.mg-node:focus-visible .mg-tip,.mg-node.is-active .mg-tip{opacity:1;visibility:visible;transform:translate(-50%,0);transition-delay:0s}
.mg-tip strong{overflow:hidden;text-overflow:ellipsis;font:600 12px/1.25 ui-sans-serif,system-ui,sans-serif;color:#1e293b}
.mg-tip span{overflow:hidden;text-overflow:ellipsis;font:500 10px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.mg-blind .mg-tip{display:none}
.mg-node.is-dot{pointer-events:none}
.mg-node.is-dot .mg-body{pointer-events:auto}
.mg-node.is-dot .mg-ring,.mg-node.is-dot .mg-tip{display:none}
.mg-node.is-dot:hover .mg-body,.mg-node.is-dot:focus-visible .mg-body{transform:scale(calc(var(--s,1)*1.9))}
.mg-node.is-visited .mg-body{background:color-mix(in srgb,var(--c) 14%,#fff)}
.mg-node.is-visited::after{content:'';position:absolute;right:-2px;top:-2px;width:8px;height:8px;border-radius:9999px;background:var(--c);border:1.5px solid #fff;
  transform:translate(calc((1 - var(--s,1))*-10px),calc((1 - var(--s,1))*10px)) scale(var(--s,1));transition:transform .18s ease}
.mg-node.is-dot.is-visited::after{display:none}
.mg-region{position:absolute;left:0;top:0;transform:translate(-50%,-50%);padding-left:.36em;white-space:nowrap;pointer-events:none;user-select:none;opacity:0;
  transition:opacity .5s ease,color .25s ease,text-shadow .25s ease;
  font:500 var(--fs,12px)/1 ui-serif,Georgia,'Times New Roman',serif;letter-spacing:.36em;text-transform:uppercase;
  color:color-mix(in srgb,var(--hue,#64748b) 45%,#475569);
  text-shadow:0 0 4px #fafaf7,0 0 4px #fafaf7,0 0 10px #fafaf7}
.mg-region[data-hot="1"]{color:color-mix(in srgb,var(--hue,#64748b) 70%,#1e293b);text-shadow:0 0 4px #fafaf7,0 0 8px #fafaf7,0 0 14px var(--hue,#64748b)}
.mg-glow{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;opacity:0;transition:opacity .22s ease;
  filter:drop-shadow(0 0 5px var(--glow,#38bdf8))}
.mg-glow.is-on{opacity:1}
.mg-glow path{fill:none;stroke-linejoin:round;stroke-linecap:round}
.mg-glow-halo{stroke:var(--glow,#38bdf8);stroke-width:7;opacity:.18}
.mg-glow-core{stroke:var(--glow,#38bdf8);stroke-width:1.8}
.mg-glow-spark{stroke:#fff;stroke-width:2.2;stroke-dasharray:2 26;opacity:.95;animation:mg-march 1.4s linear infinite}
@keyframes mg-march{to{stroke-dashoffset:-28}}
.mg-suspended [data-mg-el],.mg-suspended [data-mg-el] *{opacity:0!important;pointer-events:none!important}
.mg-suspended .mg-glow{opacity:0!important}
@media (prefers-reduced-motion:reduce){.mg-ring{animation:none!important}.mg-glow-spark{animation:none}.mg-region,.mg-glow{transition:none}.mg-body,.mg-tip,.mg-body>svg,.mg-body::before,.mg-node.is-visited::after{transition:none}}
`;

/**
 * Each element root has zero size and is centred on its GPS point by the library.
 * Pins are 24px nodes; their name badge is pure CSS (hover / focus / selected).
 * Place and water names are plain haloed text, shown or hidden by `declutter`.
 */
function buildElement(d, { onActivate }) {
  const root = document.createElement('div');
  root.className = 'relative h-0 w-0';
  root.dataset.vis = '1';
  root.dataset.mgEl = '1'; // lets .mg-suspended hide every pin and label while a modal is open

  if (d.kind === 'pin') {
    const kind = markerKind(d.category);
    root.innerHTML = `
      <div class="mg-node" role="button" tabindex="0">
        <span class="mg-ring"></span>
        <span class="mg-body">${kind.icon}</span>
        <div class="mg-tip"><strong data-role="name"></strong><span data-role="meta"></span></div>
      </div>`;
    const target = root.firstElementChild;
    target.style.setProperty('--c', d.color || kind.color);
    target.setAttribute('aria-label', d.name);
    root.querySelector('[data-role="name"]').textContent = d.name;
    root.querySelector('[data-role="meta"]').textContent = [kind.label, d.area].filter(Boolean).join(' · ');

    const lift = (on) => {
      if (root.parentElement) root.parentElement.style.zIndex = on || target.classList.contains('is-active') ? '1000' : '';
    };
    target.addEventListener('click', (e) => {
      e.stopPropagation();
      onActivate(d);
    });
    target.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate(d);
      }
    });
    target.addEventListener('mouseenter', () => lift(true));
    target.addEventListener('mouseleave', () => lift(false));
    return { root, target };
  }

  root.style.pointerEvents = 'none';

  if (d.kind === 'region') {
    const region = document.createElement('div');
    region.className = 'mg-region';
    region.textContent = d.name;
    region.dataset.hot = '0';
    region.style.setProperty('--hue', d.hue);
    region.style.setProperty('--fs', `${d.fs}px`);
    root.appendChild(region);
    return { root, label: region };
  }

  const label = document.createElement('div');
  label.textContent = d.name;
  const water = d.kind === 'water';
  label.style.cssText = [
    'position:absolute;left:0;top:0;transform:translate(-50%,-50%)',
    'white-space:nowrap;opacity:0;transition:opacity .4s ease;pointer-events:none;user-select:none',
    water
      ? 'font:italic 500 12px ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em;color:#6b8fb0'
      : `font:${d.major ? 700 : 600} 10px ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${d.major ? '#475569' : '#64748b'}`,
    // Major hubs: soft halo (0 0 4px #fafaf7, layered twice for density). Minor and water keep the tighter halo.
    d.major ? 'text-shadow:0 0 4px #fafaf7,0 0 4px #fafaf7' : 'text-shadow:0 0 3px #fafaf7,0 0 3px #fafaf7,0 0 6px #fafaf7',
  ].join(';');
  root.appendChild(label);
  return { root, label };
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

const MumbaiGlobe = forwardRef(function MumbaiGlobe({
  landmarks = LANDMARKS,
  landFeatures = DEFAULT_LAND,
  roadPaths = DEFAULT_ROADS,
  streets = null,
  neighborhoods = null,
  placeLabels = DEFAULT_PLACES,
  waterLabels = DEFAULT_WATER,
  onLandmarkClick,
  className = '',
  active = true,
  blind = false,
  visitedIds = null,
  overlayActive = false,
  autoDetectOverlays = false,
}, ref) {
  const globeRef = useRef(null);
  const containerRef = useRef(null);
  const clickRef = useRef(onLandmarkClick);
  const blindRef = useRef(blind);
  const registry = useRef(new Map()); // id -> { d, root, label, dot?, pulse? }
  const altRef = useRef(INTRO_ALTITUDE);
  const rafRef = useRef(0);
  const hoodRef = useRef(false);
  const glowRef = useRef(null);
  const hoverRef = useRef(null); // hovered zone id, readable from the rAF pass
  const hoverTimer = useRef(0);
  const zoneRingsRef = useRef(new Map());

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [lod, setLod] = useState(lodFor(INTRO_ALTITUDE));
  const [selected, setSelected] = useState(null);
  const [hoverZone, setHoverZone] = useState(null);
  const [autoOverlay, setAutoOverlay] = useState(false);

  useEffect(() => {
    clickRef.current = onLandmarkClick;
  }, [onLandmarkClick]);

  useEffect(() => {
    blindRef.current = blind;
    if (blind) setSelected(null);
  }, [blind]);

  // Optional: hide pins while any dialog outside this component is open.
  useEffect(() => {
    if (!autoDetectOverlays || typeof document === 'undefined') return undefined;
    const selector = '[aria-modal="true"],[role="dialog"],[role="alertdialog"],[data-mg-overlay]';
    let raf = 0;
    const check = () => {
      const root = containerRef.current;
      const found = [...document.querySelectorAll(selector)].some((el) => !root?.contains(el));
      setAutoOverlay((prev) => (prev === found ? prev : found));
    };
    check();
    const mo = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        check();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role', 'data-mg-overlay'] });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [autoDetectOverlays]);

  // Keep the canvas sized to its container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- Data, projected once ------------------------------------------------ */

  const hoodFeatures = useMemo(() => toFeatures(neighborhoods), [neighborhoods]);
  const hood = useMemo(() => neighborhoodParts({ features: hoodFeatures }), [hoodFeatures]);
  const zones = useMemo(() => buildZones(hoodFeatures), [hoodFeatures]);
  const vLand = useMemo(() => virtualizePolygons(landFeatures), [landFeatures]);
  // Zones go through the same stereographic virtualisation as the land.
  const vZones = useMemo(() => virtualizePolygons(zones.features), [zones]);
  const polyData = useMemo(() => [...vLand, ...vZones], [vLand, vZones]);
  zoneRingsRef.current = useMemo(() => {
    const m = new Map();
    vZones.forEach((f) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      m.set(f.properties.__zid, polys.flat()); // list of rings, [vlng, vlat] points
    });
    return m;
  }, [vZones]);
  const vRoads = useMemo(
    () => virtualizeRoads([...roadPaths, ...geoJsonToRoadPaths(streets), ...hood.rings]),
    [roadPaths, streets, hood],
  );

  const pins = useMemo(
    () =>
      landmarks.map((l, i) => {
        const v = projectToGlobe(l.lng, l.lat);
        return { ...l, id: l.id ?? `pin-${i}`, kind: 'pin', vlat: v.lat, vlng: v.lng, maxAlt: Infinity, priority: 0 };
      }),
    [landmarks],
  );

  const elements = useMemo(() => {
    const make = (items, kind, prio, maxAlt) =>
      items.map((l, i) => {
        const v = projectToGlobe(l.lng, l.lat);
        return {
          ...l,
          id: `${kind}-${i}-${l.name}`,
          kind,
          vlat: v.lat,
          vlng: v.lng,
          priority: prio(l),
          maxAlt: maxAlt(l),
        };
      });
    return [
      ...pins,
      ...make(placeLabels, 'place', (l) => (l.major ? 1 : 2), (l) => (l.major ? 1.4 : MINOR_LABEL_MAX_ALT)),
      // Atlas region names (replace the old centroid labels)
      ...zones.atlas.map((z) => {
        const v = projectToGlobe(z.lng, z.lat);
        return { ...z, id: `region-${z.zid}`, kind: 'region', vlat: v.lat, vlng: v.lng, priority: 0 };
      }),
      ...make(waterLabels, 'water', () => 3, (l) => l.maxAlt ?? 0.9),
    ];
  }, [pins, placeLabels, zones, waterLabels]);

  const paths = useMemo(() => vRoads.filter((r) => layerVisible(r.kind, lod)), [vRoads, lod]);
  const pathStroke = useCallback((d) => ROAD_STYLES[d.kind].km * DEG_PER_KM * strokeScale(lod), [lod]);

  /* ---- Label collision pass ------------------------------------------------ */

  const declutter = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const alt = altRef.current;
    const items = [...registry.current.values()].filter((it) => it.root.isConnected);
    const overlap = (a, b) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);

    // Adaptive pins: micro-dots when zoomed out, full icons up close, eased in between.
    const { scale, dot, isDot } = pinMetrics(alt);
    const scaleStr = scale.toFixed(3);
    const dotStr = dot.toFixed(3);
    // Micro-dots read as a point cloud, so they don't need to block labels; bigger nodes do.
    const pinsBlockLabels = scale >= 0.5;

    const placed = [];
    items.forEach((it) => {
      if (it.d.kind !== 'pin') return;
      // The selected pin always stays a full-size icon so it never gets lost in the dots.
      const active = it.target.classList.contains('is-active');
      const s = active ? '1.000' : scaleStr;
      const dt = active ? '0.000' : dotStr;
      if (it.lastScale !== s) {
        it.root.style.setProperty('--s', s);
        it.lastScale = s;
      }
      if (it.lastDot !== dt) {
        it.root.style.setProperty('--dot', dt);
        it.lastDot = dt;
      }
      it.target.classList.toggle('is-dot', isDot && !active);

      if (it.root.dataset.vis === '0') return;
      if (!active && !pinsBlockLabels) return;
      // Visible nodes are obstacles for place and water labels.
      const { x, y } = globe.getScreenCoords(it.d.vlat, it.d.vlng, PIN_ALT);
      const half = active ? 14 : 14 * scale;
      placed.push({ owner: it.d.id, l: x - half, r: x + half, t: y - half, b: y + half });
    });

    // Atlas region names: big zones first, they only avoid each other (they sit under pins
    // and place labels like printed atlas type) and fade in and out across their zoom band.
    const regionBoxes = [];
    items
      .filter((it) => it.d.kind === 'region')
      .sort((a, b) => b.d.area - a.d.area)
      .forEach((it) => {
        const { d, root, label } = it;
        const hide = () => {
          label.style.opacity = '0';
        };
        if (root.dataset.vis === '0' || alt > d.maxAlt || alt < d.minAlt) return hide();
        const fade = Math.min(clamp((d.maxAlt - alt) / REGION_FADE_FAR, 0, 1), clamp((alt - d.minAlt) / REGION_FADE_NEAR, 0, 1));
        if (fade < 0.05) return hide();

        const { x, y } = globe.getScreenCoords(d.vlat, d.vlng, PIN_ALT);
        if (!it.w) {
          const r = label.getBoundingClientRect();
          it.w = r.width;
          it.h = r.height;
        }
        const w = it.w || d.name.length * d.fs * 1.1 + 16;
        const h = it.h || d.fs + 4;
        const box = { l: x - w / 2 - 6, r: x + w / 2 + 6, t: y - h / 2 - 4, b: y + h / 2 + 4 };
        if (regionBoxes.some((q) => overlap(box, q))) return hide();
        regionBoxes.push(box);
        label.style.opacity = (fade * 0.88).toFixed(2);
        return undefined;
      });

    const order = items
      .filter((it) => it.d.kind !== 'pin' && it.d.kind !== 'region')
      .sort((a, b) => a.d.priority - b.d.priority);

    order.forEach((it) => {
      const { d, root, label } = it;
      const setOn = (on, opacity = 1) => {
        label.style.opacity = on ? opacity.toFixed(2) : '0';
      };
      if (root.dataset.vis === '0' || alt > d.maxAlt) return setOn(false);

      // Minor labels ease in over MINOR_LABEL_FADE of altitude below their threshold.
      // Major hubs and water labels switch on at full strength.
      const fade = d.kind === 'place' && !d.major ? clamp((d.maxAlt - alt) / MINOR_LABEL_FADE, 0, 1) : 1;
      if (fade < 0.05) return setOn(false);

      const { x, y } = globe.getScreenCoords(d.vlat, d.vlng, PIN_ALT);
      if (!it.w) {
        const r = label.getBoundingClientRect();
        it.w = r.width;
        it.h = r.height;
      }
      const w = it.w || d.name.length * 7 + 16;
      const h = it.h || 22;
      const box = { owner: d.id, l: x - w / 2 - 2, r: x + w / 2 + 2, t: y - h / 2 - 1, b: y + h / 2 + 1 };

      if (placed.some((p) => p.owner !== d.id && overlap(box, p))) return setOn(false);
      placed.push(box);
      return setOn(true, fade);
    });
  }, []);

  // Hover glow: the hovered zone's outline is projected to screen space and drawn as an SVG
  // (soft halo + bright core + a travelling spark), re-projected on every camera change.
  const updateGlow = useCallback(() => {
    const svg = glowRef.current;
    const globe = globeRef.current;
    if (!svg) return;
    const rings = hoverRef.current && globe ? zoneRingsRef.current.get(hoverRef.current) : null;
    if (!rings) {
      svg.classList.remove('is-on');
      return;
    }
    let d = '';
    rings.forEach((ring) => {
      let started = false;
      ring.forEach(([lng, lat]) => {
        const { x, y } = globe.getScreenCoords(lat, lng, ZONE_ALT);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        d += `${started ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        started = true;
      });
      if (started) d += 'Z';
    });
    svg.querySelectorAll('path').forEach((el) => el.setAttribute('d', d));
    svg.classList.add('is-on');
  }, []);

  const scheduleDeclutter = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      declutter();
      updateGlow();
    });
  }, [declutter, updateGlow]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(hoverTimer.current);
    },
    [],
  );

  // Zone hover. Clearing is debounced so crossing a road or a pin does not flicker the glow.
  const handlePolygonHover = useCallback(
    (poly) => {
      const z = poly?.properties;
      clearTimeout(hoverTimer.current);
      if (z?.__zone) {
        hoverRef.current = z.__zid;
        glowRef.current?.style.setProperty('--glow', z.__hue);
        setHoverZone(z.__zid);
        scheduleDeclutter();
      } else {
        hoverTimer.current = setTimeout(() => {
          hoverRef.current = null;
          setHoverZone(null);
          scheduleDeclutter();
        }, 120);
      }
    },
    [scheduleDeclutter],
  );

  const polyCap = useCallback(
    (d) => {
      const z = d.properties;
      if (!z?.__zone) return capColor();
      return hexToRgba(z.__hue, z.__zid === hoverZone ? ZONE_FILL_HOVER_ALPHA : ZONE_FILL_ALPHA);
    },
    [hoverZone],
  );

  const polyStroke = useCallback(
    (d) => {
      const z = d.properties;
      if (!z?.__zone) return strokeColor();
      return z.__zid === hoverZone ? z.__hue : ZONE_BORDER;
    },
    [hoverZone],
  );

  // Light up the hovered zone's atlas name too.
  useEffect(() => {
    registry.current.forEach((it) => {
      if (it.d.kind === 'region') it.label.dataset.hot = it.d.zid === hoverZone ? '1' : '0';
    });
  }, [hoverZone, elements]);

  // Elements are (re)built by the library after `elements` changes.
  useEffect(() => {
    if (!ready) return undefined;
    const t = setTimeout(scheduleDeclutter, 120);
    return () => clearTimeout(t);
  }, [elements, ready, size, scheduleDeclutter]);

  /* ---- Interaction --------------------------------------------------------- */

  const flyTo = useCallback((pov, ms = 1200) => globeRef.current?.pointOfView(pov, ms), []);

  const activatePin = useCallback(
    (d) => {
      if (blindRef.current) {
        clickRef.current?.(d);
        return;
      }
      setSelected(d);
      flyTo({ lat: d.vlat, lng: d.vlng, altitude: FOCUS_ALTITUDE });
      clickRef.current?.(d);
    },
    [flyTo],
  );

  // Highlight the selected pin.
  useEffect(() => {
    registry.current.forEach((it) => {
      if (it.d.kind !== 'pin') return;
      const on = it.d.id === selected?.id;
      it.target.classList.toggle('is-active', on);
      if (it.root.parentElement) it.root.parentElement.style.zIndex = on ? '1000' : '';
    });
    scheduleDeclutter();
  }, [selected, scheduleDeclutter]);

  useEffect(() => {
    registry.current.forEach((it) => {
      if (it.d.kind === 'pin') it.target.classList.toggle('is-visited', !!visitedIds?.has(it.d.id));
    });
  }, [visitedIds, elements]);

  const recenter = useCallback(() => {
    setSelected(null);
    flyTo(HOME_POV);
  }, [flyTo]);

  useImperativeHandle(
    ref,
    () => ({
      focus: (id) => {
        const d = pins.find((p) => p.id === id);
        if (!d) return;
        setSelected(d);
        flyTo({ lat: d.vlat, lng: d.vlng, altitude: FOCUS_ALTITUDE });
      },
      recenter,
    }),
    [pins, flyTo, recenter],
  );

  const zoomBy = useCallback((factor) => {
    const g = globeRef.current;
    if (!g) return;
    const pov = g.pointOfView();
    g.pointOfView({ ...pov, altitude: clamp(pov.altitude * factor, MIN_ALTITUDE * 1.2, MAX_ALTITUDE) }, 400);
  }, []);

  // Fires on every camera change: semantic zoom, soft pan limit, label collisions.
  const handleZoom = useCallback(
    ({ lat, lng, altitude }) => {
      altRef.current = altitude;
      const next = lodFor(altitude);
      setLod((prev) => (prev === next ? prev : next));

      const c = Math.acos(clamp(Math.cos(lat * RAD) * Math.cos(lng * RAD), -1, 1)) / RAD;
      if (c > MAX_PAN_DEG && !hoodRef.current) {
        hoodRef.current = true;
        const k = MAX_PAN_DEG / c;
        globeRef.current?.pointOfView({ lat: lat * k, lng: lng * k, altitude }, 0);
        requestAnimationFrame(() => {
          hoodRef.current = false;
        });
      }
      scheduleDeclutter();
    },
    [scheduleDeclutter],
  );

  const handleGlobeReady = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;

    // Sea: the globe's own material, flat soft blue with no specular glare.
    try {
      const mat = globe.globeMaterial();
      mat.color.set(SEA);
      mat.specular?.set('#000000');
      mat.shininess = 0;
    } catch (e) {
      /* non-fatal */
    }

    // Lighting tuned so camera-facing surfaces show their true colours and the
    // limb falls off gently, which is what makes the map read as a sphere.
    // Assumes three r155+ light units (intensity of PI equals full albedo).
    try {
      globe.scene().traverse((obj) => {
        if (obj.isAmbientLight) {
          obj.color.set('#ffffff');
          obj.intensity = Math.PI * 0.6;
        } else if (obj.isDirectionalLight) {
          obj.color.set('#ffffff');
          obj.intensity = Math.PI * 0.4;
        }
      });
    } catch (e) {
      /* non-fatal */
    }

    const controls = globe.controls();
    controls.autoRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 100 * (1 + MIN_ALTITUDE);
    controls.maxDistance = 100 * (1 + MAX_ALTITUDE);

    // Opening shot: the whole city as a globe, then glide in.
    globe.pointOfView({ lat: 0, lng: 0, altitude: INTRO_ALTITUDE }, 0);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !active) return undefined;
    const t = setTimeout(() => globeRef.current?.pointOfView(HOME_POV, 2400), 250);
    return () => clearTimeout(t);
  }, [ready, active]);

  const htmlElement = useCallback(
    (d) => {
      const built = buildElement(d, { onActivate: activatePin });
      registry.current.set(d.id, { d, ...built });
      return built.root;
    },
    [activatePin],
  );

  const visibility = useCallback((el, isVisible) => {
    el.style.visibility = isVisible ? 'visible' : 'hidden';
    el.dataset.vis = isVisible ? '1' : '0';
  }, []);

  const btn =
    'rounded-full border border-slate-300/60 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur transition hover:border-slate-500 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400';

  const selKind = selected ? markerKind(selected.category) : null;
  const selAccent = selected ? selected.color || selKind.color : null;

  return (
    <div ref={containerRef} className={`relative isolate h-full min-h-[480px] w-full overflow-hidden bg-[#e8f4f8] ${blind ? 'mg-blind' : ''} ${overlayActive || autoOverlay ? 'mg-suspended' : ''} ${className}`}>
      <style>{MARKER_CSS}</style>
      {size.width > 0 && size.height > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor={BACKGROUND}
          controlType="orbit" /* keeps north up; ignored by versions without this option */
          rendererConfig={{ antialias: true, powerPreference: 'high-performance' }}
          showAtmosphere
          atmosphereColor={ATMOSPHERE}
          atmosphereAltitude={0.1}
          showGraticules={false}
          onGlobeReady={handleGlobeReady}
          onZoom={handleZoom}
          /* Land + neighborhood zones (projected, densified) */
          polygonsData={polyData}
          polygonGeoJsonGeometry="geometry"
          polygonCapColor={polyCap}
          polygonSideColor={polySide}
          polygonStrokeColor={polyStroke}
          polygonAltitude={polyAlt}
          onPolygonHover={handlePolygonHover}
          polygonCapCurvatureResolution={3}
          polygonsTransitionDuration={0}
          /* Roads, minor streets and boundaries */
          pathsData={paths}
          pathPoints="path"
          pathPointLat={pointLat}
          pathPointLng={pointLng}
          pathPointAlt={pointAlt}
          pathColor={roadColor}
          pathStroke={pathStroke}
          pathTransitionDuration={0}
          /* Pins and labels, anchored to projected GPS points */
          htmlElementsData={elements}
          htmlLat="vlat"
          htmlLng="vlng"
          htmlAltitude={PIN_ALT}
          htmlElement={htmlElement}
          htmlElementVisibilityModifier={visibility}
        />
      )}

      <svg ref={glowRef} className="mg-glow" aria-hidden="true">
        <path className="mg-glow-halo" />
        <path className="mg-glow-core" />
        <path className="mg-glow-spark" />
      </svg>

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#e8f4f8] text-xs tracking-[0.2em] text-slate-400">
          LOADING MAP…
        </div>
      )}

      {selected && (
        <div className="absolute bottom-16 left-4 max-w-[17rem] rounded-2xl border border-slate-300/50 bg-white/75 p-3.5 shadow-[0_8px_28px_rgba(51,65,85,0.14)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div
                className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em]"
                style={{ color: selAccent }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: selAccent }} />
                {[selKind.label, selected.area].filter(Boolean).join(' · ')}
              </div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{selected.name}</div>
              {selected.desc && <p className="mt-1 text-xs leading-relaxed text-slate-600">{selected.desc}</p>}
              {selected.studentHack && (
                <p className="mt-2 border-t border-slate-300/50 pt-2 text-[11px] leading-relaxed text-slate-500">
                  <span className="font-semibold text-slate-700">Student tip. </span>
                  {selected.studentHack}
                </p>
              )}
              <div className="mt-2 font-mono text-[10px] text-slate-400">
                {selected.lat.toFixed(4)}°N, {selected.lng.toFixed(4)}°E
              </div>
            </div>
            <button type="button" aria-label="Close" onClick={recenter} className="text-slate-400 transition hover:text-slate-700">
              ×
            </button>
          </div>
        </div>
      )}

      {pins.length <= 12 && !blind && (
        <div className="absolute bottom-4 left-4 right-40 flex gap-2 overflow-x-auto pb-1">
          {pins.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => activatePin(p)}
              className={`${btn} shrink-0 ${selected?.id === p.id ? 'border-slate-500 text-slate-900' : ''}`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="absolute bottom-4 right-4 flex gap-2">
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1.8)} className={btn}>
          −
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1 / 1.8)} className={btn}>
          +
        </button>
        <button type="button" onClick={recenter} className={btn}>
          Recenter
        </button>
      </div>
    </div>
  );
});

export default MumbaiGlobe;