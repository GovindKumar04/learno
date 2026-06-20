import { User } from "../models/user.model.js";

// Helpers for the common "enrich Mongo data with user fields" pattern that used
// to be raw `SELECT ... FROM users WHERE id IN (...)` joins against Postgres.
// `fields` is a Mongoose select string of snake_case columns, e.g.
// "full_name email roll_number avatar". Returned objects keep their snake_case
// fields and expose `id` (a copy of `_id`) so existing `usersMap[u.id]` code and
// the JWT helpers keep working unchanged.

const withId = (u) => (u ? { ...u, id: u._id } : u);

export const findUserById = async (id, fields) => {
  if (!id) return null;
  return withId(await User.findById(id).select(fields).lean());
};

export const findUsersByIds = async (ids = [], fields) => {
  if (!ids.length) return [];
  const rows = await User.find({ _id: { $in: ids } }).select(fields).lean();
  return rows.map(withId);
};

// Returns an object keyed by user id, each value the user's selected fields.
export const buildUserMap = async (ids = [], fields) => {
  const map = {};
  for (const u of await findUsersByIds(ids, fields)) map[u.id] = u;
  return map;
};
