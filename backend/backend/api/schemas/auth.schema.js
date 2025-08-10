const { z } = require("zod");

/**
 * Auth Schemas
 * - login: email/username + password
 * - refresh: optional refreshToken in body (if not from cookie)
 */
const loginSchema = z.object({
  email: z.string().email().optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(6, "Password is required"),
}).refine(
  data => (data.email || data.username),
  { message: "Either email or username is required", path: ["email"] }
);

const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional()
});

module.exports = {
  loginSchema,
  refreshSchema
};
