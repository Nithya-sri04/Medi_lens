import express from "express";
import cors from "cors";
import prescriptionRoutes from "./routes/prescription.routes.js";
import authRoutes from "./routes/auth.routes.js";
import profileRoutes from "./routes/profile.routes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/prescription", prescriptionRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);

export default app;
