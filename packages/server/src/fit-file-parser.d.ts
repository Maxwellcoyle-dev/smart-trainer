declare module "fit-file-parser" {
  export interface FitSession {
    sport?: string;
    sub_sport?: string;
    start_time?: Date | string;
    total_timer_time?: number; // seconds
    total_elapsed_time?: number;
    total_distance?: number; // meters (with lengthUnit: "m")
    total_ascent?: number;
    avg_heart_rate?: number;
  }
  export interface FitData {
    sessions?: FitSession[];
    activity?: { timestamp?: Date | string };
    [k: string]: unknown;
  }
  export default class FitParser {
    constructor(options?: {
      force?: boolean;
      speedUnit?: string;
      lengthUnit?: string;
      temperatureUnit?: string;
      elapsedRecordField?: boolean;
      mode?: string;
    });
    parse(content: Buffer | ArrayBuffer, callback: (error: unknown, data: FitData) => void): void;
  }
}
