const { ZodError } = require("zod");

/**
 * Simple request validation middleware. It accepts an object with optional
 * body, query and params schemas. Each schema should be a Zod schema. The
 * corresponding section of the request will be parsed and replaced with
 * the validated result. If validation fails it forwards a 400 to the
 * global error handler with details about the failure. Unknown fields are
 * allowed by default in Zod unless the schema is marked .strict() by the
 * caller.
 *
 * @param {{ body?: import("zod").ZodSchema, query?: import("zod").ZodSchema, params?: import("zod").ZodSchema }} schemas
 * @returns {import("express").RequestHandler}
 */
function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        // Parse and mutate the body so downstream middleware uses typed values.
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        // Flatten error messages for readability
        const messages = err.errors.map(e => e.message);
        return next({ status: 400, message: messages.join(", ") });
      }
      return next({ status: 400, message: err.message || "Invalid request" });
    }
  };
}

module.exports = validate;