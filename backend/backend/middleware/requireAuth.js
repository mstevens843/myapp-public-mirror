require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;
const prisma = require("../prisma/prisma");

async function requireAuth(req, res, next) {
  // 🧠 Check both: Bearer OR Cookie
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : null;

  const cookie = req.cookies?.access_token;

  const token = bearer || cookie;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
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
      const fresh = jwt.sign({ id: u.id, type: decoded.type || "web3" }, JWT_SECRET, { expiresIn: "30d" });
      res.setHeader("Authorization", `Bearer ${fresh}`);
    }

    req.user = { id: decoded.id, type: decoded.type };
    return next();
  } catch (err) {
    console.error("🔒 Auth middleware error:", err.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = requireAuth;


// async function requireAuth(req, res, next) {
//   const authHeader = req.headers.authorization;

//   // Log the authorization header
//   console.log("Authorization Header:", authHeader);

//   if (!authHeader || !authHeader.startsWith("Bearer ")) {
//     console.log("Error: Missing or invalid token in the authorization header.");
//     return res.status(401).json({ error: "Missing or invalid token" });
//   }

//   const token = authHeader.split(" ")[1];
  
//   try {
//     console.log("Attempting to verify the token...");

//     const decoded = jwt.verify(token, JWT_SECRET);
//     console.log("Token verified successfully. User ID:", decoded.userId);

//     req.user = { id: decoded.userId };
//     next();
//   } catch (err) {
//     // Log the error details
//     console.error("Error while verifying token:", err.message);

//     // If the token is expired, check the refresh token
//     if (err.name === "TokenExpiredError") {
//       console.log("Token expired, checking refresh token...");

//       const refreshToken = req.headers["x-refresh-token"];
//       if (!refreshToken) {
//         console.log("Error: No refresh token provided.");
//         return res.status(401).json({ error: "No refresh token provided" });
//       }

//       try {
//         console.log("Attempting to verify the refresh token...");

//         const decodedRefresh = jwt.verify(refreshToken, JWT_SECRET);
//         console.log("Refresh token verified successfully. User ID:", decodedRefresh.userId);

//         const newAccessToken = jwt.sign({ userId: decodedRefresh.userId }, JWT_SECRET, { expiresIn: "9999y" });
//         res.setHeader("Authorization", `Bearer ${newAccessToken}`);
//         req.user = { id: decodedRefresh.userId };
//         console.log("New access token issued.");
//         next();
//       } catch (refreshErr) {
//         console.error("Error while verifying refresh token:", refreshErr.message);
//         return res.status(401).json({ error: "Invalid or expired refresh token" });
//       }
//     } else {
//       console.error("Invalid token error:", err.message);
//       return res.status(401).json({ error: "Invalid token" });
//     }
//   }
// }

// module.exports = requireAuth;
