// 32 original fictional franchises. Real city names only; all nicknames, colors and
// logos are original to Gridiron 27.
export const CONFERENCES = ['Liberty', 'Frontier'];
export const DIVISIONS = ['East', 'North', 'South', 'West'];

// [city, name, abbr, primary, secondary, accent, conference, division, logoShape]
const RAW = [
  ['Boston', 'Ironsides', 'BOS', '#1d2f5c', '#b8bfc9', '#c8102e', 0, 0, 'shield'],
  ['New York', 'Sentinels', 'NYS', '#0b1e3f', '#e0a526', '#ffffff', 0, 0, 'circle'],
  ['Philadelphia', 'Founders', 'PHI', '#5a1e2d', '#d9c08c', '#ffffff', 0, 0, 'diamond'],
  ['Baltimore', 'Mariners', 'BAL', '#103c4f', '#f28c28', '#ffffff', 0, 0, 'circle'],
  ['Pittsburgh', 'Forge', 'PIT', '#222222', '#ff6a13', '#9ea2a2', 0, 1, 'hex'],
  ['Cleveland', 'Hammers', 'CLE', '#5e2a15', '#f5b335', '#ffffff', 0, 1, 'shield'],
  ['Detroit', 'Motormen', 'DET', '#2b3a42', '#3fa9f5', '#ffffff', 0, 1, 'hex'],
  ['Buffalo', 'Blizzard', 'BUF', '#0a3d7a', '#aee3ff', '#ffffff', 0, 1, 'diamond'],
  ['Miami', 'Tides', 'MIA', '#008e97', '#ff4f8b', '#ffffff', 0, 2, 'circle'],
  ['Orlando', 'Comets', 'ORL', '#3c1a6e', '#ffc72c', '#ffffff', 0, 2, 'star'],
  ['Nashville', 'Outlaws', 'NSH', '#121212', '#c9a227', '#b22222', 0, 2, 'star'],
  ['Atlanta', 'Firebirds', 'ATL', '#8b0000', '#ff8c00', '#1a1a1a', 0, 2, 'shield'],
  ['Denver', 'Summit', 'DEN', '#21426b', '#7ec8e3', '#ffffff', 0, 3, 'triangle'],
  ['Las Vegas', 'Jackpots', 'LV', '#111111', '#d4af37', '#c8102e', 0, 3, 'diamond'],
  ['Salt Lake', 'Pioneers', 'SLC', '#7a3b0f', '#e8d3a2', '#2f4f4f', 0, 3, 'triangle'],
  ['Phoenix', 'Scorpions', 'PHX', '#c1440e', '#2b2b2b', '#f2c14e', 0, 3, 'hex'],
  ['Washington', 'Admirals', 'WAS', '#0c2340', '#b3a369', '#c8102e', 1, 0, 'shield'],
  ['Charlotte', 'Crowns', 'CHA', '#00594f', '#8a8d8f', '#ffffff', 1, 0, 'star'],
  ['Raleigh', 'Foxes', 'RAL', '#d2492a', '#1b1b1b', '#ffffff', 1, 0, 'triangle'],
  ['Newark', 'Ironclads', 'NWK', '#4b5563', '#16a34a', '#ffffff', 1, 0, 'hex'],
  ['Chicago', 'Gales', 'CHI', '#13294b', '#e04e39', '#ffffff', 1, 1, 'circle'],
  ['Milwaukee', 'Brewmasters', 'MIL', '#0f3d2e', '#f2b705', '#ffffff', 1, 1, 'shield'],
  ['Minneapolis', 'Frost', 'MIN', '#2e1a47', '#9bd3f5', '#ffffff', 1, 1, 'diamond'],
  ['Columbus', 'Cannons', 'CLB', '#7c0a02', '#9e9e9e', '#000000', 1, 1, 'circle'],
  ['Houston', 'Wildcatters', 'HOU', '#002d72', '#e35205', '#ffffff', 1, 2, 'star'],
  ['Dallas', 'Stampede', 'DAL', '#4a2c2a', '#c0c0c0', '#1e90ff', 1, 2, 'triangle'],
  ['San Antonio', 'Vaqueros', 'SA', '#000000', '#00a3ad', '#c4ced4', 1, 2, 'star'],
  ['New Orleans', 'Krewe', 'NO', '#4b0082', '#2e8b57', '#ffd700', 1, 2, 'diamond'],
  ['Los Angeles', 'Stars', 'LA', '#1e1e5a', '#ffb81c', '#ffffff', 1, 3, 'star'],
  ['San Francisco', 'Fog', 'SF', '#5d6d7e', '#d35400', '#ffffff', 1, 3, 'circle'],
  ['Seattle', 'Orcas', 'SEA', '#0b0b0b', '#2ec4b6', '#ffffff', 1, 3, 'hex'],
  ['Portland', 'Lumberjacks', 'POR', '#1b4d3e', '#c8102e', '#f4e8c1', 1, 3, 'shield'],
];

export function defaultTeams() {
  return RAW.map(([city, name, abbr, primary, secondary, accent, conf, div, shape], i) => ({
    id: i,
    city,
    name,
    abbr,
    conference: conf,
    division: div,
    colors: { primary, secondary, accent },
    uniform: {
      helmet: 'primary', // which team color the helmet uses
      jersey: 'primary',
      pants: i % 3 === 0 ? 'secondary' : i % 3 === 1 ? 'white' : 'primary',
      helmetStripe: i % 2 === 0,
      sleeveStripes: i % 4 !== 3,
    },
    logo: { shape, bg: primary, fg: secondary, border: accent, text: abbr, icon: 'none' },
  }));
}

export const teamFullName = (t) => `${t.city} ${t.name}`;
