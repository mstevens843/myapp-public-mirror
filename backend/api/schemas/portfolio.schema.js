const { z } = require("zod");

// Only GET routes with no inputs in current implementation.
const emptyQuery = z.object({}); 

module.exports = {
  emptyQuery,
};