import mongoose from "mongoose";

// True when the error means this MongoDB deployment can't run transactions —
// i.e. a standalone mongod (transactions need a replica set or mongos).
const isTransactionUnsupported = (err) => {
  const msg = err?.message || "";
  return (
    err?.code === 20 ||                                          // IllegalOperation
    err?.codeName === "IllegalOperation" ||
    /Transaction numbers are only allowed on a replica set/i.test(msg) ||
    /does not support retryable writes/i.test(msg) ||
    /Transactions are not supported/i.test(msg)
  );
};

// Runs `work(session)` inside a multi-document transaction when the deployment
// supports them (replica set / mongos). On a standalone mongod — which can't do
// transactions — it transparently falls back to running `work(null)` with no
// session, i.e. plain sequential (non-atomic) writes.
//
// Because of that fallback, `work` MUST be safe to run without all-or-nothing
// atomicity (idempotent, or reconciled on retry). Pass the `session` straight
// through to every query/write inside `work`; Mongoose treats a null session as
// "no session", so the same code path works for both modes.
export const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    if (!isTransactionUnsupported(err)) throw err;
    // Standalone mongod — no transaction support. Run the same writes directly.
    return await work(null);
  } finally {
    await session.endSession();
  }
};
