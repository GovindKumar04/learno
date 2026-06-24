

import "dotenv/config";
import mongoose from "mongoose";
import connectMongoDB from "../config/mongodb.js";
import { Enquiry } from "../models/enquiry.model.js";

const DRY = process.argv.includes("--dry");


const STATUS_MAP = {
  "Enquiry Pending": "pending",
  "Enquiry Completed": "resolved",
};
const VALID_STATUS = ["open", "pending", "contacted", "resolved"];

const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");


const deriveSubject = (d) =>
  !isBlank(d.course) ? `Course Enquiry: ${String(d.course).trim()}` : "General Enquiry";


const deriveMessage = (d) => {
  const parts = [];
  if (!isBlank(d.course))    parts.push(`Interested in ${String(d.course).trim()}`);
  if (!isBlank(d.mode))      parts.push(`Mode: ${String(d.mode).trim()}`);
  if (!isBlank(d.college))   parts.push(`College: ${String(d.college).trim()}`);
  if (!isBlank(d.location))  parts.push(`Location: ${String(d.location).trim()}`);
  if (!isBlank(d.remark))    parts.push(`Remark: ${String(d.remark).trim()}`);
  return parts.length ? parts.join(". ") + "." : "(No message provided — imported from legacy enquiry system.)";
};

const run = async () => {
  await connectMongoDB();
  const coll = Enquiry.collection;

  
  const ticketed = await coll.find({ ticketId: /^TKT-\d+$/ }).project({ ticketId: 1 }).toArray();
  let nextTicket = ticketed.reduce((m, t) => Math.max(m, parseInt(t.ticketId.slice(4), 10) || 0), 0) + 1;

  
  const docs = await coll.find({}).toArray();

  const ops = [];
  const preview = [];

  for (const d of docs) {
    const set = {};

   
    if (!VALID_STATUS.includes(d.status)) {
      set.status = STATUS_MAP[d.status] || "open";
    }
   
    if (isBlank(d.subject)) set.subject = deriveSubject(d);
    // message (required)
    if (isBlank(d.message)) set.message = deriveMessage(d);
    // category / role / priority — fill missing with the schema defaults
    if (isBlank(d.category)) set.category = "general";
    if (isBlank(d.role))     set.role = "guest";
    if (isBlank(d.priority)) set.priority = "medium";
    // ticketId
    if (isBlank(d.ticketId)) {
      set.ticketId = `TKT-${String(nextTicket).padStart(4, "0")}`;
      nextTicket += 1;
    }

    if (Object.keys(set).length === 0) continue; // already clean

    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: set } } });
    preview.push({ _id: d._id.toString(), name: d.name, changes: set });
  }

  console.log(`${DRY ? "[DRY RUN] " : ""}Enquiries needing normalization: ${ops.length} / ${docs.length}`);
  for (const p of preview.slice(0, 60)) {
    const c = p.changes;
    const bits = [];
    if (c.status)   bits.push(`status→${c.status}`);
    if (c.ticketId) bits.push(c.ticketId);
    if (c.subject)  bits.push(`subject="${c.subject}"`);
    if (c.message)  bits.push("message(filled)");
    if (c.category) bits.push("category→general");
    console.log(`  ${p._id}  ${(p.name || "").trim().slice(0, 24).padEnd(24)}  ${bits.join(", ")}`);
  }
  if (preview.length > 60) console.log(`  …and ${preview.length - 60} more`);

  if (DRY) {
    console.log("\nDry run — no changes written. Re-run without --dry to apply.");
  } else if (ops.length) {
    const res = await coll.bulkWrite(ops, { ordered: false });
    console.log(`\nApplied. matched=${res.matchedCount} modified=${res.modifiedCount}`);
  } else {
    console.log("\nNothing to do — all enquiries already conform.");
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => { console.error("Migration failed:", err); process.exit(1); });
