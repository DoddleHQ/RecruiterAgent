import express from "express";
import {
  createJobOpening,
  deleteJobOpening,
  getJobOpenings,
} from "../controllers/jobOpenings";

const router = express.Router();

router.get("/", getJobOpenings);
router.post("/", createJobOpening);
router.delete("/", deleteJobOpening);

export default router;
