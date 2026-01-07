import express from "express";
import cors from "cors";
import prescriptionRoutes from "./routes/prescription.routes.js";
import llmExplanationService from "./services/llmExplanationService.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/prescription", prescriptionRoutes);

export default app;
