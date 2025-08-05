const requireAuth = require("./requireAuth");

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization?.trim();
  const expectedHeader = `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`;

  console.log("🚀 [requireInternalOrAuth] Called for route:", req.originalUrl);
  console.log("🚀 Incoming Auth header:", JSON.stringify(authHeader));
  console.log("🚀 Expected internal header:", JSON.stringify(expectedHeader));

  if (authHeader && authHeader === expectedHeader) {
    console.log("✅ [requireInternalOrAuth] Internal service token matched, skipping auth.");
    return next();
  }

  console.log("❌ [requireInternalOrAuth] Not internal token, falling back to JWT auth");
  return requireAuth(req, res, next);
};
