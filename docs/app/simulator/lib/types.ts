export interface SimDrink {
  id: string;
  loggedAtMinute: number;
  volumeMl: number;
  abv: number;
  name: string;
}

export type BiologicalSex = "male" | "female";
export type SexMode = BiologicalSex | "both";

export interface SimState {
  drinks: SimDrink[];
  simMinute: number;
  isRunning: boolean;
  speedMultiplier: number;
  sexMode: SexMode;
  age: number;
  stomachKa: number;
  drinkPace: number;
}

export type SimAction =
  | { type: "ADD_DRINK"; drink: Pick<SimDrink, "name" | "volumeMl" | "abv"> }
  | { type: "TICK"; deltaMs: number }
  | { type: "SET_SPEED"; speed: number }
  | { type: "TOGGLE_PAUSE" }
  | { type: "SET_SEX"; sex: SexMode }
  | { type: "SET_PACE"; pace: number }
  | { type: "RESET" };

export type ZoneName =
  | "sober"
  | "belowSweetSpot"
  | "sweetSpot"
  | "caution"
  | "danger";

export interface BACDataPoint {
  minute: number;
  bac: number;
  zone: ZoneName;
}
