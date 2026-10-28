// Zone landmarks in the offense frame: down = yards past the line of scrimmage, lat = yards
// to the offense's right of the ball. r = area of responsibility radius. Deep zones keep
// cushion over the deepest threat.
export const ZONES = {
  deep_middle: { down: 15, lat: 0, r: 14, deep: true },
  deep_third_l: { down: 14, lat: -15, r: 9, deep: true },
  deep_third_m: { down: 16, lat: 0, r: 9, deep: true },
  deep_third_r: { down: 14, lat: 15, r: 9, deep: true },
  deep_half_l: { down: 15, lat: -11, r: 12, deep: true },
  deep_half_r: { down: 15, lat: 11, r: 12, deep: true },
  deep_quarter_ll: { down: 13, lat: -19, r: 7, deep: true },
  deep_quarter_lm: { down: 14, lat: -6, r: 7, deep: true },
  deep_quarter_rm: { down: 14, lat: 6, r: 7, deep: true },
  deep_quarter_rr: { down: 13, lat: 19, r: 7, deep: true },
  deep_hole: { down: 13, lat: 0, r: 7, deep: true },
  flat_l: { down: 4, lat: -17, r: 6 },
  flat_r: { down: 4, lat: 17, r: 6 },
  curl_flat_l: { down: 7, lat: -13, r: 6 },
  curl_flat_r: { down: 7, lat: 13, r: 6 },
  hook_l: { down: 8, lat: -6, r: 5.5 },
  hook_r: { down: 8, lat: 6, r: 5.5 },
  hook_middle: { down: 8, lat: 0, r: 5.5 },
  mid_robber: { down: 10, lat: 0, r: 6 },
};
