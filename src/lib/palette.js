// Chart colors. Mirrors the CSS tokens in index.css (SVG attributes need literal values).
//
// Categorical order validated for light surfaces (lightness band, chroma, CVD and
// normal-vision separation). Slot 1 is the brand sage green; hues are assigned in
// fixed order and never cycled — extra categories fold into "Other".
export const CATEGORICAL = ['#4f7a3a', '#2a78d6', '#eb6834', '#4a3aa7', '#eda100', '#e87ba4', '#1baf7a', '#e34948'];
export const OTHER_COLOR = '#a1a1a6';

export const CHART = {
    primary: '#5f7f45', // sage green, single-series bars
    accent: '#2f4422', // deep green, median markers
    soft: '#e6eedb', // box fill
    warn: '#d9822b', // outliers and missing values
    grid: '#e8e8ed',
    axis: '#86868b',
    text: '#1d1d1f',
};

// Diverging scale for correlations: terracotta (−1) → neutral gray (0) → sage green (+1).
const NEG = [180, 83, 52];
const MID = [242, 242, 244];
const POS = [74, 112, 52];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export function divergingColor(r) {
    const t = Math.min(Math.abs(r), 1);
    const [red, green, blue] = mix(MID, r >= 0 ? POS : NEG, t);
    return `rgb(${red}, ${green}, ${blue})`;
}

/** Text color that stays readable on top of `divergingColor(r)`. */
export const divergingInk = (r) => (Math.abs(r) > 0.55 ? '#ffffff' : '#1d1d1f');
