// Color themes. Every color can also be overridden per map in the Map tab.

export const COLOR_KEYS = [
  ['paper', 'Paper / land'], ['field', 'Field lines'], ['ruralRoad', 'Country roads'],
  ['block', 'Blocks'], ['blockDark', 'Blocks (dark tone)'], ['blockLight', 'Blocks (light tone)'], ['park', 'Parks'],
  ['hatch', 'Block hatching'], ['street', 'Streets'], ['outline', 'Outlines'],
  ['water', 'Water'], ['waterLine', 'Water ripples'], ['waterEdge', 'Water edge'],
  ['wall', 'Wall & towers'], ['label', 'Label text'], ['labelHalo', 'Label halo'],
  ['waterText', 'Water text'], ['waterHalo', 'Water text halo'], ['accent', 'Accent (landmarks, title)'],
  ['frame', 'Frame & compass'], ['glow', 'District glow'],
  ['farm1', 'Farm fields 1'], ['farm2', 'Farm fields 2'], ['farm3', 'Farm fields 3'], ['farmLine', 'Furrows'], ['hedge', 'Hedgerows'],
];

export const THEMES = {
  patina: {
    name: 'Patina & Amber (book)',
    colors: {
      paper: '#d9cfc4', field: '#b9a89a', ruralRoad: '#7b6a5b', block: '#524438', blockDark: '#343b40', blockLight: '#6b5a49',
      park: '#526b68', hatch: '#1a1511', street: '#efe9e1', outline: '#2a2522', water: '#526b68', waterLine: '#3c5250',
      waterEdge: '#343b40', wall: '#343b40', label: '#2b2420', labelHalo: '#f6f1ea', waterText: '#f6f1ea', waterHalo: '#2f3d3b',
      accent: '#b77a36', frame: '#343b40', glow: '',
      farm1: '#c9b9a8', farm2: '#bfa98e', farm3: '#a9ab94', farmLine: '#8a7766', hedge: '#526b68',
    },
  },
  ash: {
    name: 'Ash & Ember (red blocks)',
    colors: {
      paper: '#e8e1cf', field: '#a8a08c', ruralRoad: '#5f584c', block: '#7a2e23', blockDark: '#54433c', blockLight: '#914535',
      park: '#5d6b45', hatch: '#2a0c07', street: '#f2ede1', outline: '#24140f', water: '#8b8e95', waterLine: '#50545c',
      waterEdge: '#1f1f24', wall: '#141414', label: '#f4efe3', labelHalo: '#24140f', waterText: '#f4efe3', waterHalo: '#2c2d33',
      accent: '#b3241b', frame: '#17191c', glow: '',
      farm1: '#cfc3a6', farm2: '#bfb08c', farm3: '#b3b08f', farmLine: '#7d7258', hedge: '#4f5a3c',
    },
  },
  coastal: {
    name: 'Coastal (pastel)',
    colors: {
      paper: '#a7b97f', field: '#93a76f', ruralRoad: '#7b7a55', block: '#d4877a', blockDark: '#b97168', blockLight: '#e2a091',
      park: '#8fae6a', hatch: '', street: '#efe3bb', outline: '#4d3328', water: '#dfe6da', waterLine: '#aab6a8',
      waterEdge: '#6e7c6c', wall: '#5a4637', label: '#3a2a20', labelHalo: '#f3ead0', waterText: '#4e5b52', waterHalo: '#e8eee4',
      accent: '#8b2c1c', frame: '#4b4f4a', glow: '#eadca6',
      farm1: '#c3c98d', farm2: '#d7cf96', farm3: '#9fb877', farmLine: '#7f8a5a', hedge: '#5f7a45',
    },
  },
  ink: {
    name: 'Ink & Slate (grey)',
    colors: {
      paper: '#d2d2ca', field: '#bbbbb3', ruralRoad: '#8a8a90', block: '#9b9ba4', blockDark: '#87878f', blockLight: '#adadb4',
      park: '#b9bfae', hatch: '', street: '#d2d2ca', outline: '#2b2b38', water: '#6b6b7a', waterLine: '#8d8d9c',
      waterEdge: '#2b2b38', wall: '#2b2b38', label: '#2b2b38', labelHalo: '#d2d2ca', waterText: '#e2e2e6', waterHalo: '#4a4a58',
      accent: '#2b2b38', frame: '#2b2b38', glow: '',
      farm1: '#c4c4bc', farm2: '#bcbcb2', farm3: '#b3b5aa', farmLine: '#8a8a90', hedge: '#6b6b76',
    },
  },
  parchment: {
    name: 'Old Parchment (sepia)',
    colors: {
      paper: '#eee0bd', field: '#cbb88c', ruralRoad: '#8a6e45', block: '#b8875a', blockDark: '#8f6a48', blockLight: '#c89c6e',
      park: '#9aa36a', hatch: '#5a3a1c', street: '#f5ebcf', outline: '#4a2f17', water: '#a8bfc0', waterLine: '#6f8c8f',
      waterEdge: '#3e4f50', wall: '#3a2614', label: '#3a2614', labelHalo: '#f3e6c4', waterText: '#2f4344', waterHalo: '#c7d6d4',
      accent: '#8e2216', frame: '#3a2614', glow: '',
      farm1: '#e2cf9f', farm2: '#d6c08a', farm3: '#c9c08e', farmLine: '#9c8156', hedge: '#6f7445',
    },
  },
  midnight: {
    name: 'Midnight (blue ink)',
    colors: {
      paper: '#1d2533', field: '#2f3a4d', ruralRoad: '#55657f', block: '#33415a', blockDark: '#283247', blockLight: '#40506c',
      park: '#2d4a43', hatch: '#121822', street: '#c9d3e3', outline: '#0d121b', water: '#16304a', waterLine: '#2c5378',
      waterEdge: '#0a1420', wall: '#c9d3e3', label: '#e6edf7', labelHalo: '#0d121b', waterText: '#a9c6e6', waterHalo: '#0a1420',
      accent: '#e0a43a', frame: '#0d121b', glow: '',
      farm1: '#24304a', farm2: '#2a3550', farm3: '#263a44', farmLine: '#3c4a66', hedge: '#2f4a40',
    },
  },
};

export const FONTS = ['Cinzel', 'IM Fell English SC', 'IM Fell English', 'Oswald', 'Spectral SC', 'Uncial Antiqua', 'MedievalSharp', 'Pirata One', 'Georgia'];
export const FONT_WEIGHTS = { Cinzel: 600, Oswald: 500, 'Spectral SC': 600 };
