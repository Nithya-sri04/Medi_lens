import express from "express";
import multer from "multer";
import { analyzePrescription } from "../controllers/prescription.controller.js";
import { normalizeOCR, extractOCR, extractWithVeryfi, getSuggestions } from "../controllers/ocr.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/analyze", analyzePrescription);
router.post("/ocr/normalize", normalizeOCR);
router.post("/ocr/extract", upload.single("image"), extractOCR);
router.post("/ocr/veryfi", upload.single("image"), extractWithVeryfi);
router.post("/ocr/suggestions", getSuggestions);

export default router;
