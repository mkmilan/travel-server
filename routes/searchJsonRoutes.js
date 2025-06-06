const router = require("express").Router();
const { performSearchJson } = require("../controllers/searchJsonController");

// Public endpoint.  Add `protect` middleware if you want it gated later.
router.get("/", performSearchJson);

module.exports = router;
