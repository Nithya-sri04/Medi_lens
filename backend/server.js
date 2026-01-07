import dotenv from "dotenv";
import { loadMedicineData } from "./src/repositories/medicine.repository.js";
import app from "./src/app.js";

dotenv.config();

await loadMedicineData();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
