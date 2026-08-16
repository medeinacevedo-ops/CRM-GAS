const express = require("express");
const router = express.Router();
const { login } = require("../controllers/authController");

router.post("/login", login);
router.get("/ping", (req, res) => res.json({ status: "auth ok" }));

module.exports = router;
