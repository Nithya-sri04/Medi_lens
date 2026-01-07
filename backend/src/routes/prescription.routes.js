import express from "express";
import { analyzePrescription } from "../controllers/prescription.controller.js";
import { normalizeOCR, getSuggestions } from "../controllers/ocr.controller.js";

const router = express.Router();

router.post("/analyze", analyzePrescription);
router.post("/ocr/normalize", normalizeOCR);
router.post("/ocr/suggestions", getSuggestions);

export default router;
