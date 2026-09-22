/**
 * Request-schema validation middleware, built on zod.
 *
 * This is a demonstrated pattern applied to a couple of low-risk routes
 * (routes/templates.js, routes/settings/security.js) — NOT a full rewrite of
 * the app's ~40 route files. Every other route still hand-validates inline,
 * which remains correct and already well-tested; converting the rest is a
 * larger, separate effort best done incrementally, route by route, with its
 * own test verification each time — not something to do in one broad pass.
 *
 *   const { z } = require('zod');
 *   const { validate } = require('../middleware/validate');
 *   router.post('/', validate(z.object({ name: z.string().trim().min(1) })), handler);
 *
 * On success, req[source] is replaced with the parsed (trimmed/coerced/defaulted)
 * value, so the handler downstream can trust its shape. On failure, responds 400
 * with a single message — the app's existing convention (a plain { error } string
 * the client reads as e.message), not zod's structured issue list.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path.length ? `${issue.path.join('.')}: ` : '';
      return res.status(400).json({ error: `${field}${issue.message}` });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
