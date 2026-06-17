import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import {
  applyAffiliateService,
  getMyAffiliateService,
  trackClickService,
  getApplicationsService,
  reviewApplicationService,
  getAllAffiliatesService,
  updateAffiliateService,
  getCommissionsService,
  updateCommissionStatusService,
  getResourcesService,
  createResourceService,
  updateResourceService,
  deleteResourceService,
} from "../services/affiliate.service.js";

// POST /affiliates/apply  (public)
const applyAffiliate = asyncHandler(async (req, res) => {
  const application = await applyAffiliateService(req.body);
  return res.status(201).json(
    new ApiResponse(201, application, "Application submitted — we'll review it and email you shortly")
  );
});

// GET /affiliates/me  (user)
const getMyAffiliate = asyncHandler(async (req, res) => {
  const data = await getMyAffiliateService(req.user.id);
  return res.json(new ApiResponse(200, data));
});

// GET /affiliates/track/:code  (public)
const trackClick = asyncHandler(async (req, res) => {
  await trackClickService(req.params.code);
  return res.json(new ApiResponse(200, { tracked: true }));
});

// GET /affiliates/applications  (admin)
const getApplications = asyncHandler(async (req, res) => {
  const data = await getApplicationsService(req.query);
  return res.json(new ApiResponse(200, data));
});

// PATCH /affiliates/applications/:id  (admin)
const reviewApplication = asyncHandler(async (req, res) => {
  const { action, payload } = await reviewApplicationService({ id: req.params.id, ...req.body });
  const message = action === "reject" ? "Application rejected" : "Affiliate approved — login credentials emailed";
  return res.json(new ApiResponse(200, payload, message));
});

// GET /affiliates  (admin)
const getAllAffiliates = asyncHandler(async (req, res) => {
  const data = await getAllAffiliatesService();
  return res.json(new ApiResponse(200, data));
});

// PATCH /affiliates/:userId  (admin)
const updateAffiliate = asyncHandler(async (req, res) => {
  const affiliate = await updateAffiliateService({ userId: req.params.userId, ...req.body });
  return res.json(new ApiResponse(200, affiliate, "Affiliate updated"));
});

// GET /affiliates/commissions  (admin)
const getCommissions = asyncHandler(async (req, res) => {
  const data = await getCommissionsService(req.query);
  return res.json(new ApiResponse(200, data));
});

// PATCH /affiliates/commissions/:id  (admin)
const updateCommissionStatus = asyncHandler(async (req, res) => {
  const commission = await updateCommissionStatusService({ id: req.params.id, status: req.body.status });
  return res.json(new ApiResponse(200, commission, `Commission marked ${commission.status}`));
});

// GET /affiliates/resources  (admin + affiliate)
const getResources = asyncHandler(async (req, res) => {
  const resources = await getResourcesService(req.user);
  return res.json(new ApiResponse(200, resources));
});

// POST /affiliates/resources  (admin)
const createResource = asyncHandler(async (req, res) => {
  const resource = await createResourceService(req.body);
  return res.status(201).json(new ApiResponse(201, resource, "Resource added"));
});

// PATCH /affiliates/resources/:id  (admin)
const updateResource = asyncHandler(async (req, res) => {
  const resource = await updateResourceService({ id: req.params.id, ...req.body });
  return res.json(new ApiResponse(200, resource, "Resource updated"));
});

// DELETE /affiliates/resources/:id  (admin)
const deleteResource = asyncHandler(async (req, res) => {
  const data = await deleteResourceService({ id: req.params.id, password: req.body?.password, adminId: req.user.id });
  return res.json(new ApiResponse(200, data, "Resource deleted"));
});

export {
  applyAffiliate,
  getMyAffiliate,
  trackClick,
  getApplications,
  reviewApplication,
  getAllAffiliates,
  updateAffiliate,
  getCommissions,
  updateCommissionStatus,
  getResources,
  createResource,
  updateResource,
  deleteResource,
};
