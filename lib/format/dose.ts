/**
 * ISMP-compliant dose-string formatting (issue #38).
 *
 * A hospital pharmacist reads a sloppy dose string — a trailing zero, a naked
 * decimal, a "U" for units — as unsafe: `1.0 mg` misread as `10 mg`, `.5 mg`
 * misread as `5 mg`, `10 U` misread as `10 0`. The ISMP dose-designation
 * standards exist to remove exactly those ambiguities. This module normalizes
 * the dose-shaped substrings inside a free-text string so the text Basepair
 * emits OUTWARD (prescriber Communication bodies, substitute MedicationRequest
 * text) is safe to read at a glance.
 *
 * Design: `formatDose` is a pure scanner, not a parser. It finds dose-shaped
 * tokens (a number immediately followed by a known dose unit) anywhere in the
 * input and rewrites each one in place, leaving all surrounding prose — and any
 * text that doesn't match a dose shape — untouched. That keeps it safe to run
 * over a whole recommendation sentence ("Initiate with a dose of .5 mg/kg/day")
 * as well as a bare dose ("1.0 mg"), and it is conservative by construction: no
 * match means the string is returned unchanged rather than corrupted.
 *
 * The codebase's dose convention (see data/cpic/recommendations.json:
 * "20 mg/day", "0.5 mg/kg/day") is a single space between the value and the
 * unit, which is also what ISMP recommends. Normalization therefore always
 * emits `<number> <unit>` with one space, so an unspaced source ("0.3mg/kg/day")
 * is brought into line too.
 */

/**
 * The dose units we canonicalize, longest-token-first so the alternation never
 * matches a prefix ("u" inside "units", "g" inside "mg"). Case-insensitive; the
 * trailing `(?![A-Za-z])` guard keeps us out of ordinary words ("5 grams" is not
 * a "5 g" dose, "mgmt" is not "mg"). The micro sign (µ, U+00B5) and Greek mu
 * (μ, U+03BC) both appear in the wild for "µg", so both are matched.
 */
const DOSE_UNITS =
  "µg|μg|mcg|ug|mg|iu|units|unit|ml|cc|g|l|u";

/**
 * One dose token: a number (integer, decimal, or a naked/leading-decimal like
 * ".5") optionally spaced from a known unit. The `(?<![\w.])` guard stops us
 * mid-number or mid-word (so "v2 mg" or a run-on "1,000" fragment can't be
 * partially rewritten); the trailing guard stops the unit bleeding into a word.
 */
const DOSE_TOKEN = new RegExp(
  `(?<![\\w.])(\\d+(?:\\.\\d+)?|\\.\\d+)\\s?(${DOSE_UNITS})(?![A-Za-z])`,
  "gi",
);

/**
 * Normalize the numeric part per ISMP: add a leading zero to a naked decimal
 * (`.5` → `0.5`) and strip trailing zeros after a decimal point (`1.0` → `1`,
 * `2.50` → `2.5`). Integers are left alone.
 */
function normalizeDoseNumber(raw: string): string {
  let n = raw.startsWith(".") ? `0${raw}` : raw;
  if (n.includes(".")) {
    n = n.replace(/0+$/, "").replace(/\.$/, "");
  }
  return n;
}

/**
 * Canonicalize the unit per the ISMP do-not-use list: never "U"/"IU" (spell out
 * "units"), never "µg"/"ug" (use "mcg"), never "cc" (use "mL"). Volume/mass units
 * get their ISMP casing (mL, L). Already-spelled-out "unit"/"units" pass through.
 */
function normalizeDoseUnit(raw: string): string {
  switch (raw.toLowerCase()) {
    case "µg":
    case "μg":
    case "mcg":
    case "ug":
      return "mcg";
    case "u":
    case "iu":
      return "units";
    case "units":
      return "units";
    case "unit":
      return "unit";
    case "cc":
    case "ml":
      return "mL";
    case "l":
      return "L";
    case "mg":
      return "mg";
    case "g":
      return "g";
    default:
      return raw;
  }
}

/**
 * Format the dose-shaped substrings in `input` to ISMP dose-designation
 * standards, returning the string with every match rewritten and everything
 * else — including strings with no dose at all — left exactly as given.
 *
 * Idempotent: `formatDose(formatDose(x)) === formatDose(x)`, since a normalized
 * token ("0.5 mg", "10 units") re-matches to itself.
 */
export function formatDose(input: string): string {
  return input.replace(
    DOSE_TOKEN,
    (_match, num: string, unit: string) =>
      `${normalizeDoseNumber(num)} ${normalizeDoseUnit(unit)}`,
  );
}
