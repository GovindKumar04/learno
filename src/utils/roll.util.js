// Roll numbers: FSA-<ROLE>-<YY>-<NNNN>   e.g. FSA-STU-26-0001
//   FSA  → brand prefix (Fillip Skill Academy)
//   ROLE → role code (STU / INS / ADM / AFF)
//   YY   → signup year, 2 digits (26 = 2026)
//   NNNN → zero-padded sequence, counted per role per year (uniqueness)
//
// Filter examples:
//   all 2026 students → roll_number LIKE 'FSA-STU-26-%'
//   anyone from 2026  → roll_number LIKE 'FSA-%-26-%'

import { User } from "../models/user.model.js";

export const ROLL_PREFIX = "FSA";

// role → 3-letter code used in the roll
export const ROLE_CODES = {
  student: "STU",
  instructor: "INS",
  admin: "ADM",
  affiliate: "AFF",
};

export function roleCode(role) {
  return ROLE_CODES[(role || "").toLowerCase()] || "USR";
}

// 2-digit year segment for a given date.
export function rollYear(date = new Date()) {
  return String(date.getFullYear()).slice(-2);
}

// Build a roll from role + date + sequence number.
export function formatRoll(role, date, seq) {
  return `${ROLL_PREFIX}-${roleCode(role)}-${rollYear(date)}-${String(seq).padStart(4, "0")}`;
}

// Generate the next roll for a role + date by reading the highest roll already
// issued for that role/year. Pair with a UNIQUE index + retry to stay safe under
// races. Sequence segment is fixed-width, so lexical DESC = numeric max.
export async function generateRollNumber(role, date = new Date()) {
  const prefix = `${ROLL_PREFIX}-${roleCode(role)}-${rollYear(date)}-`;
  const latest = await User.findOne({ roll_number: { $regex: `^${prefix}` } })
    .sort({ roll_number: -1 })
    .select("roll_number")
    .lean();

  let next = 1;
  if (latest?.roll_number) {
    const tail = parseInt(latest.roll_number.slice(prefix.length), 10);
    if (!Number.isNaN(tail)) next = tail + 1;
  }
  return formatRoll(role, date, next);
}
