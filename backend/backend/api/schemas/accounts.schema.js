const { z } = require("zod");

// PATCH /account/profile
const profilePatchSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  require2faLogin: z.boolean().optional(),
  require2faArm: z.boolean().optional(),
});

// POST /account/change-password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

// DELETE /account/delete (no body)
const deleteAccountParams = z.object({}); // placeholder

module.exports = {
  profilePatchSchema,
  changePasswordSchema,
  deleteAccountParams,
};