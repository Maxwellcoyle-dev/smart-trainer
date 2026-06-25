// Static climbing grade reference — YDS (rope) + V-scale (boulder).
// Kept in-app (not fetched) because grades are a small, fixed set that
// effectively never change. grade_value is a dense ordinal within discipline.
// Mirrors the seed in supabase/migrations/20260617170014_seed_grades.sql.

export type GradeDiscipline = "rope" | "boulder";

export interface StaticGrade {
  system: string;
  label: string;
  grade_value: number;
  discipline: GradeDiscipline;
}

export const GRADES: StaticGrade[] = [
  // YDS rope
  { system: "yds", label: "5.5", grade_value: 1, discipline: "rope" },
  { system: "yds", label: "5.6", grade_value: 2, discipline: "rope" },
  { system: "yds", label: "5.7", grade_value: 3, discipline: "rope" },
  { system: "yds", label: "5.8", grade_value: 4, discipline: "rope" },
  { system: "yds", label: "5.9", grade_value: 5, discipline: "rope" },
  { system: "yds", label: "5.10a", grade_value: 6, discipline: "rope" },
  { system: "yds", label: "5.10b", grade_value: 7, discipline: "rope" },
  { system: "yds", label: "5.10c", grade_value: 8, discipline: "rope" },
  { system: "yds", label: "5.10d", grade_value: 9, discipline: "rope" },
  { system: "yds", label: "5.11a", grade_value: 10, discipline: "rope" },
  { system: "yds", label: "5.11b", grade_value: 11, discipline: "rope" },
  { system: "yds", label: "5.11c", grade_value: 12, discipline: "rope" },
  { system: "yds", label: "5.11d", grade_value: 13, discipline: "rope" },
  { system: "yds", label: "5.12a", grade_value: 14, discipline: "rope" },
  { system: "yds", label: "5.12b", grade_value: 15, discipline: "rope" },
  { system: "yds", label: "5.12c", grade_value: 16, discipline: "rope" },
  { system: "yds", label: "5.12d", grade_value: 17, discipline: "rope" },
  { system: "yds", label: "5.13a", grade_value: 18, discipline: "rope" },
  { system: "yds", label: "5.13b", grade_value: 19, discipline: "rope" },
  { system: "yds", label: "5.13c", grade_value: 20, discipline: "rope" },
  { system: "yds", label: "5.13d", grade_value: 21, discipline: "rope" },
  { system: "yds", label: "5.14a", grade_value: 22, discipline: "rope" },
  { system: "yds", label: "5.14b", grade_value: 23, discipline: "rope" },
  { system: "yds", label: "5.14c", grade_value: 24, discipline: "rope" },
  { system: "yds", label: "5.14d", grade_value: 25, discipline: "rope" },
  { system: "yds", label: "5.15a", grade_value: 26, discipline: "rope" },
  // V-scale bouldering
  { system: "v_scale", label: "VB", grade_value: 0, discipline: "boulder" },
  { system: "v_scale", label: "V0", grade_value: 1, discipline: "boulder" },
  { system: "v_scale", label: "V1", grade_value: 2, discipline: "boulder" },
  { system: "v_scale", label: "V2", grade_value: 3, discipline: "boulder" },
  { system: "v_scale", label: "V3", grade_value: 4, discipline: "boulder" },
  { system: "v_scale", label: "V4", grade_value: 5, discipline: "boulder" },
  { system: "v_scale", label: "V5", grade_value: 6, discipline: "boulder" },
  { system: "v_scale", label: "V6", grade_value: 7, discipline: "boulder" },
  { system: "v_scale", label: "V7", grade_value: 8, discipline: "boulder" },
  { system: "v_scale", label: "V8", grade_value: 9, discipline: "boulder" },
  { system: "v_scale", label: "V9", grade_value: 10, discipline: "boulder" },
  { system: "v_scale", label: "V10", grade_value: 11, discipline: "boulder" },
  { system: "v_scale", label: "V11", grade_value: 12, discipline: "boulder" },
  { system: "v_scale", label: "V12", grade_value: 13, discipline: "boulder" },
  { system: "v_scale", label: "V13", grade_value: 14, discipline: "boulder" },
  { system: "v_scale", label: "V14", grade_value: 15, discipline: "boulder" },
  { system: "v_scale", label: "V15", grade_value: 16, discipline: "boulder" },
  { system: "v_scale", label: "V16", grade_value: 17, discipline: "boulder" },
  { system: "v_scale", label: "V17", grade_value: 18, discipline: "boulder" },
];

export const gradesForDiscipline = (d: GradeDiscipline): StaticGrade[] =>
  GRADES.filter((g) => g.discipline === d);
