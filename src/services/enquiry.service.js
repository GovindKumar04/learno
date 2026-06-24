import { Enquiry } from "../models/enquiry.model.js";
import { sendReplyMail } from "../utils/mail.util.js";
import { ApiError } from "../utils/ApiError.js";

export const getAllEnquiriesService = async (query) => {
  const { page = 1, limit = 10, status, role, priority, category, search } = query;

  const filter = {};
  if (status) filter.status = status;
  if (role) filter.role = role;
  if (priority) filter.priority = priority;
  // Internship applications have their own admin view (category "internship"),
  // so keep them out of the general enquiries list unless explicitly requested.
  if (category) filter.category = category;
  else filter.category = { $ne: "internship" };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { subject: { $regex: search, $options: "i" } },
      { ticketId: { $regex: search, $options: "i" } },
    ];
  }

  const enquiries = await Enquiry.find(filter)
    .skip((page - 1) * limit)
    .limit(Number(limit))
    .select("-replies")
    .sort({ createdAt: -1 });

  const total = await Enquiry.countDocuments(filter);
  return { enquiries, total, page: Number(page), limit: Number(limit) };
};

export const getEnquiryStatsService = async () => {
  // Stats power the general enquiries dashboard / topbar badge, which links to the
  // main enquiries list — so exclude internship applications here too.
  const base = { category: { $ne: "internship" } };

  const [statusStats, roleStats, categoryStats] = await Promise.all([
    Enquiry.aggregate([{ $match: base }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Enquiry.aggregate([{ $match: base }, { $group: { _id: "$role", count: { $sum: 1 } } }]),
    Enquiry.aggregate([{ $match: base }, { $group: { _id: "$category", count: { $sum: 1 } } }]),
  ]);

  const total = await Enquiry.countDocuments(base);

  const resolved = await Enquiry.find({ ...base, status: "resolved", respondedAt: { $exists: true } })
    .select("createdAt respondedAt");

  let avgResponseTime = null;
  if (resolved.length > 0) {
    const totalMs = resolved.reduce((sum, e) => sum + (e.respondedAt - e.createdAt), 0);
    const avgMs = totalMs / resolved.length;
    avgResponseTime = `${(avgMs / (1000 * 60 * 60)).toFixed(1)} hours`;
  }

  return {
    total,
    byStatus: statusStats.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
    byRole: roleStats.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
    byCategory: categoryStats.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
    avgResponseTime,
  };
};

export const getEnquiryByIdService = async (id) => {
  const enquiry = await Enquiry.findById(id);
  if (!enquiry) throw new ApiError(404, "Enquiry not found");

  const callLink = enquiry.phone ? `tel:${enquiry.phone}` : null;
  const whatsappLink = enquiry.phone
    ? `https://wa.me/${enquiry.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${enquiry.name}, this is Fillip Skill Academy regarding your enquiry ${enquiry.ticketId}`)}`
    : null;
  const mailLink = `mailto:${enquiry.email}?subject=Re: [${enquiry.ticketId}] ${enquiry.subject}`;

  return { enquiry, contactLinks: { callLink, whatsappLink, mailLink } };
};

// Fetch a single attachment's stored location so the controller can stream it
// back with correct PDF headers. PDFs live on Cloudinary as `raw` resources whose
// delivery URLs don't carry a usable content-type / can't take an fl_attachment
// transform, so we proxy them through our API instead of linking directly.
export const getEnquiryAttachmentService = async ({ id, index }) => {
  const enquiry = await Enquiry.findById(id).select("attachments ticketId");
  if (!enquiry) throw new ApiError(404, "Enquiry not found");
  const att = enquiry.attachments?.[index];
  if (!att) throw new ApiError(404, "Attachment not found");
  return { url: att.url, type: att.type, publicId: att.publicId, ticketId: enquiry.ticketId };
};

export const replyToEnquiryService = async ({ id, message }) => {
  if (!message) throw new ApiError(400, "Reply message is required");

  const enquiry = await Enquiry.findById(id);
  if (!enquiry) throw new ApiError(404, "Enquiry not found");
  if (enquiry.status === "resolved") throw new ApiError(400, "Cannot reply to a resolved enquiry");

  // Atomic update instead of enquiry.save(): legacy enquiries are missing
  // now-required fields (subject/message), so a full-document save would throw a
  // ValidationError and 500 — same issue fixed in updateEnquiryStatusService.
  const reply = { message, sentBy: "admin", sentAt: new Date() };
  const updated = await Enquiry.findByIdAndUpdate(
    id,
    {
      $push: { replies: reply },
      $set: { status: "contacted", respondedAt: enquiry.respondedAt || new Date() },
    },
    { new: true, runValidators: true }
  );

  await sendReplyMail({
    name: enquiry.name,
    email: enquiry.email,
    ticketId: enquiry.ticketId,
    subject: enquiry.subject,
    replyMessage: message,
  });

  return updated;
};

export const updateEnquiryStatusService = async ({ id, status, adminNote, priority }) => {
  const enquiry = await Enquiry.findById(id);
  if (!enquiry) throw new ApiError(404, "Enquiry not found");

  const update = {};
  if (status) update.status = status;
  if (adminNote) update.adminNote = adminNote;
  if (priority) update.priority = priority;
  if (status === "resolved" && !enquiry.respondedAt) update.respondedAt = new Date();

  // Persist via an atomic $set rather than enquiry.save(). Many legacy enquiries
  // predate the current schema and are missing now-required fields (subject,
  // message) — doc.save() runs full-document validation and would throw a
  // ValidationError (surfacing to the client as a 500) even though we're only
  // touching the status. With findByIdAndUpdate + runValidators, only the changed
  // paths are validated (e.g. the status enum), so the update succeeds.
  const updated = await Enquiry.findByIdAndUpdate(
    id,
    { $set: update },
    { new: true, runValidators: true }
  );
  return updated;
};
