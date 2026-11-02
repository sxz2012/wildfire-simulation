/** Tunable robot-dog mock parameters. One object so the demo can override them. */
export interface RobotConfig {
  speedMps: number; // walking speed on flat ground
  slopeCostK: number; // uphill travel time × (1 + k·tan(slope))
  slopeCostDownK: number; // downhill: slower than flat, faster than uphill
  /** Walking speed on each land cover, relative to open ground (legs push through brush slowly). */
  groundSpeed: { grass: number; forest: number; shrub: number };
  maxSlopeDeg: number; // steeper cells are impassable
  entryMarginMin: number; // a cell may be entered only this long before it ignites
  escapeMarginMin: number; // stricter margin for the escape path
  /** Stay this far (metres) from the predicted fire, and scout from the closest spot that keeps it. Undefined = no distance rule. */
  keepAwayM?: number;
  /** The dog reports when the true fire is due at it or its route within this many minutes. */
  sensingWithinMin: number;
  /** Extra margin per minute of look-ahead (forecasts get less sure the further ahead they look). Undefined = 0. */
  marginPerLeadMin?: number;
  snapRadiusCells: number; // how far an unsafe click may be moved
  scoutHoldMin: number; // sim minutes spent at the fire edge
  windShiftDeltaKmh: number; // wind speed increase on the scripted shift
  searchPadCells: number; // planner search box padding around start/goal
}

export const ROBOT_DEFAULTS: RobotConfig = {
  speedMps: 1.5,
  slopeCostK: 3,
  slopeCostDownK: 1.5,
  groundSpeed: { grass: 1, forest: 0.7, shrub: 0.5 },
  maxSlopeDeg: 35,
  entryMarginMin: 30,
  escapeMarginMin: 60,
  keepAwayM: 100,
  sensingWithinMin: 30,
  snapRadiusCells: 20,
  scoutHoldMin: 30,
  windShiftDeltaKmh: 10,
  searchPadCells: 80,
};

/** A planned path. Arrival times are absolute simulation minutes. */
export interface Plan {
  cells: number[];
  arrivalMin: number[];
  minMarginMin: number;
}

export interface PlannerGrid {
  gridSize: number;
  cellSizeMeters: number;
  /** Predicted minute each cell ignites (Infinity = never in the forecast). */
  ignitionMin: Float32Array;
  /**
   * Looser maps for the last resort, tightest first, when `ignitionMin` is a keep-away map (see keepAwayIgnition):
   * e.g. half the keep-away distance, then the forecast fire itself. Undefined = `ignitionMin` alone.
   */
  lastResortMin?: Float32Array[];
  /** Minute the forecast starts from; look-ahead for a growing margin counts from here. Undefined = the plan's start. */
  forecastMin?: number;
  elevation?: Float32Array;
  /** 0 = impassable (water), 1 = passable. Undefined = all passable. */
  passable?: Uint8Array;
  /** Speed on each cell's land cover relative to open ground. Undefined = all open ground. */
  groundSpeed?: Float32Array;
}
