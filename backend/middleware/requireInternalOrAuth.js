const requireAuth = require("./requireAuth");

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization?.trim();
  const expectedHeader = `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`;

  if (authHeader && authHeader === expectedHeader) {
    console.log("✅ [requireInternalOrAuth] Internal service token matched, skipping auth.");
    return next();
  }

  console.log("❌ [requireInternalOrAuth] Not internal token, falling back to JWT auth");
  return requireAuth(req, res, next);
};