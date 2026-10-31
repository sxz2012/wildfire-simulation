/** Tunable robot-dog mock parameters. One object so the demo can override them. */
export interface RobotConfig {
  speedMps: number; // walking speed on flat ground
  slopeCostK: number; // travel time × (1 + k·tan(slope))
  maxSlopeDeg: number; // steeper cells are impassable
  entryMarginMin: number; // a cell may be entered only this long before it ignites
  escapeMarginMin: number; // stricter margin for the escape path
  snapRadiusCells: number; // how far an unsafe click may be moved
  scoutHoldMin: number; // sim minutes spent at the fire edge
  windShiftDeltaKmh: number; // wind speed increase on the scripted shift
  searchPadCells: number; // planner search box padding around start/goal
}

export const ROBOT_DEFAULTS: RobotConfig = {
  speedMps: 1.5,
  slopeCostK: 3,
  maxSlopeDeg: 35,
  entryMarginMin: 30,
  escapeMarginMin: 60,
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
  elevation?: Float32Array;
  /** 0 = impassable (water), 1 = passable. Undefined = all passable. */
  passable?: Uint8Array;
}
