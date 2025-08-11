
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
const prisma = require("../prisma/prisma");

/**
 * requireAuth
 *
 * 🧠 Accepts BOTH:
 *   - Authorization: Bearer <jwt>
 *   - Cookie: __Host-access_token (new) OR access_token (legacy)
 *
 * ✅ Legacy support:
 *   - If token has `userId` (old) instead of `id`, look up the user and
 *     upgrade the claim in-memory; optionally emit a fresh Authorization header.
 *
 * 🔐 Notes:
 *   - No breaking change to your public surface.
 *   - Preserves your original comments and behavior.
 *   - Adds support for __Host- cookie name while keeping the old one.
 */
async function requireAuth(req, res, next) {
  // 🧠 Check both: Bearer OR Cookie
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : null;

  // ← added: support __Host-access_token (preferred) with legacy fallback
  const cookie =
    (req.cookies && (req.cookies["__Host-access_token"] || req.cookies["access_token"])) ||
    null;

  // Optional alternate header (kept off to avoid surprises):
  // const xhdr = req.headers["x-access-token"] || null;

  const token = bearer || cookie; // || xhdr;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    // Verify without enforcing aud/iss to avoid breaking legacy tokens.
    // (You can tighten by passing { audience: "app", issuer: "sol-app" } here.)
    let decoded = jwt.verify(token, JWT_SECRET);

    // ✅ Legacy support (userId instead of id)
    if (!decoded.id && decoded.userId) {
      const u = await prisma.user.findUnique({
        where: { userId: decoded.userId },
        select: { id: true },
      });

      if (!u) return res.status(401).json({ error: "Invalid token" });

      decoded.id = u.id;

      // Optional: refresh upgraded token (if legacy)
      try {
        const fresh = jwt.sign(
          { id: u.id, type: decoded.type || "web3" },
          JWT_SECRET,
          { expiresIn: "30d" }
        );
        // Expose for upstream proxy or client that reads it; non-breaking.
        res.setHeader("Authorization", `Bearer ${fresh}`);
      } catch {}
    }

    // Expose token (useful for downstream actions/log correlation)
    req.authToken = token; // ← added (non-breaking)

    req.user = { id: decoded.id, type: decoded.type };
    return next();
  } catch (err) {
    console.error("🔒 Auth middleware error:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = requireAuth;