const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../middleware/auth");
const { listarCheckpoints } = require("../controllers/checkpointsController");

router.get("/", requireAuth, requireRole("admin", "supervisor"), listarCheckpoints);

module.exports = router;
