// World units are YARDS. x runs along the length of the field, z across it, y is up.
// Goal lines are at x = ±50, end lines at x = ±60, sidelines at z = ±HALF_WIDTH.
export const SIM_HZ = 60;
export const STEP = 1 / SIM_HZ;

export const GOAL_X = 50;
export const END_X = 60;
export const FIELD_WIDTH = 160 / 3; // 53.33 yd
export const HALF_WIDTH = FIELD_WIDTH / 2;
export const HASH_Z = HALF_WIDTH - 70.75 / 3; // NFL hashes, ~3.08 yd from center
export const GRAVITY = 10.72; // yd/s^2

export const PLAYER_RADIUS = 0.42;
export const BALL_CARRY_HEIGHT = 1.1;

export const TEAM_HOME = 0;
export const TEAM_AWAY = 1;
