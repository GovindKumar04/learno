import fs from "fs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { getSiteConfigService, updateSiteConfigService, updateLogoService, getCourseRankingService } from "../services/siteConfig.service.js";

// GET /site-config  — public
const getSiteConfig = asyncHandler(async (req, res) => {
  const config = await getSiteConfigService();
  return res.json(new ApiResponse(200, config));
});

// GET /site-config/course-ranking  — admin only — the two-level course ranking
// resolved against the live category set (for the admin priority-order editor).
const getCourseRanking = asyncHandler(async (req, res) => {
  const ranking = await getCourseRankingService();
  return res.json(new ApiResponse(200, ranking));
});

// PUT /site-config  — admin only
const updateSiteConfig = asyncHandler(async (req, res) => {
  const config = await updateSiteConfigService(req.body);
  return res.json(new ApiResponse(200, config, "Site config updated"));
});

// POST /site-config/logo  — admin only — multipart/form-data
//   field "logo"   : the image file
//   field "target" : "navbar" | "footer"
const updateLogo = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No logo image provided (field name: 'logo')");
  try {
    const config = await updateLogoService({
      target: req.body.target,
      filePath: req.file.path,
      mimetype: req.file.mimetype,
    });
    return res.json(new ApiResponse(200, config, "Logo updated"));
  } finally {
    // uploadToCloudinary already removes the temp file on success/failure, but if
    // we threw before reaching it (e.g. invalid target) clean up here too.
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

export { getSiteConfig, getCourseRanking, updateSiteConfig, updateLogo };
