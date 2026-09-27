// The artifact registry: every model's dimensions in millimetres, transcribed from artifacts.md.
// Each value carries the kind and source the spec gives it. This module imports nothing, so the
// dimension checks run in the browser and in Node alike.

const v = (mm, kind, source) => ({ mm, kind, source });

export const SPECS = {
  peace_tower: {
    height_to_flagpole_base: v(92200, "sourced", "S1"),
    flagpole_length: v(10700, "sourced", "S2"),
    base_width: v(12200, "sourced", "S3"),
    clock_diameter: v(4800, "sourced", "S4"),
    clock_centre_height: v(64000, "stylized", "S4"),
    observation_level: v(60000, "sourced", "S4"),
    spire_height: v(24000, "stylized", null),
    turret_width: v(1800, "stylized", null),
    flag_width: v(4600, "sourced", "S5"),
    flag_height: v(2300, "sourced", "S5"),
  },
  north_canoe: {
    length: v(9119, "sourced", "S6"),
    beam: v(1448, "sourced", "S6"),
    depth: v(660, "sourced", "S6"),
    stem_height: v(1346, "sourced", "S6"),
    paddle_length: v(1600, "stylized", null),
    rocker: v(150, "stylized", null),
  },
  poutine: {
    bowl_width: v(169, "sourced", "S8"),
    bowl_height: v(70, "sourced", "S8"),
    bowl_base_width: v(130, "stylized", null),
    fry_section: v(9.5, "sourced", "S10"),
    fry_length: v(75, "stylized", null),
    curd: v(19, "sourced", "S11"),
    gravy_depth: v(12, "stylized", null),
  },
  open_book: {
    page_width: v(152.4, "sourced", "S13"),
    page_height: v(228.6, "sourced", "S13"),
    page_thickness: v(0.0572, "sourced", "S14"),
    pages: v(300, "stylized", null),
    cover: v(0.3, "stylized", null),
    opening_angle_degrees: v(160, "stylized", null),
  },
  easel_jack_pine: {
    canvas_height: v(1279, "sourced", "S15"),
    canvas_width: v(1398, "sourced", "S15"),
    canvas_depth: v(25, "stylized", null),
    easel_height: v(2300, "ranged", "S17"),
    ledge_height: v(600, "ranged", "S16"),
    base_width: v(760, "stylized", null),
    post_section: v(45, "stylized", null),
  },
  flag: {
    length_units: v(64, "sourced", "S18"),
    width_units: v(32, "sourced", "S18"),
    square_units: v(32, "sourced", "S18"),
    leaf_points: v(11, "sourced", "S18"),
    length: v(4600, "sourced", "S5"),
    width: v(2300, "sourced", "S5"),
    pole_height: v(10700, "sourced", "S2"),
  },
  hockey: {
    puck_diameter: v(76.2, "sourced", "S19"),
    puck_thickness: v(25.4, "sourced", "S19"),
    stick_length: v(1600, "sourced", "S19"),
    blade_length: v(317.5, "sourced", "S19"),
    blade_height: v(70, "ranged", "S19"),
    blade_curve: v(19, "sourced", "S19"),
    shaft_width: v(32, "stylized", null),
    shaft_depth: v(22, "stylized", null),
    blade_thickness: v(12, "stylized", null),
    lie_angle_degrees: v(45, "stylized", null),
    ice_radius: v(500, "stylized", null),
  },
  loonie: {
    diameter: v(26.5, "sourced", "S20"),
    thickness: v(1.95, "sourced", "S20"),
    sides: v(11, "sourced", "S20"),
  },
};

// The pieces the notebook request may name, and the fallback for each notebook theme.
export const PIECES = Object.keys(SPECS);
export const THEME_PIECE = {
  civic: "peace_tower",
  history: "north_canoe",
  culture: "poutine",
  language: "open_book",
};

// The "Checks between dimensions" table of artifacts.md, one function per row.
const mm = (piece, key) => SPECS[piece][key].mm;
export const CHECKS = [
  ["Clock faces fit the tower face", () => mm("peace_tower", "clock_diameter") < mm("peace_tower", "base_width")],
  ["Clocks sit above the observation level", () => mm("peace_tower", "clock_centre_height") > mm("peace_tower", "observation_level")],
  ["Clocks sit below the spire", () => mm("peace_tower", "clock_centre_height") + mm("peace_tower", "clock_diameter") / 2 < mm("peace_tower", "height_to_flagpole_base") - mm("peace_tower", "spire_height")],
  ["Flag fits the flagpole", () => mm("peace_tower", "flag_height") < mm("peace_tower", "flagpole_length")],
  ["Canoe length to beam matches S6", () => Math.abs(mm("north_canoe", "length") / mm("north_canoe", "beam") - 6.3) < 0.05],
  ["Canoe stems rise above the gunwales", () => mm("north_canoe", "stem_height") > mm("north_canoe", "depth")],
  ["Fries fit inside the bowl", () => mm("poutine", "fry_length") < mm("poutine", "bowl_width") * Math.SQRT2],
  ["Curds sit below the rim", () => mm("poutine", "curd") < mm("poutine", "bowl_height")],
  ["Painting sits on the easel", () => mm("easel_jack_pine", "ledge_height") + mm("easel_jack_pine", "canvas_height") < mm("easel_jack_pine", "easel_height")],
  ["Puck fits under the blade", () => mm("hockey", "puck_thickness") < mm("hockey", "blade_height")],
  ["Blade height inside Rule 10.1", () => mm("hockey", "blade_height") >= 50.8 && mm("hockey", "blade_height") <= 76.2],
  ["Book pages fit the cover", () => (mm("open_book", "pages") * mm("open_book", "page_thickness")) / 2 < mm("open_book", "page_width")],
  ["Flag bars and square fill the length", () => 2 * ((mm("flag", "length_units") - mm("flag", "square_units")) / 2) + mm("flag", "square_units") === mm("flag", "length_units")],
  ["Flag keeps the 2:1 proportion", () => mm("flag", "length") / mm("flag", "width") === mm("flag", "length_units") / mm("flag", "width_units")],
];

export function runChecks() {
  return CHECKS.map(([name, test]) => ({ name, pass: Boolean(test()) }));
}
