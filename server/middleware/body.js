/**
 * Express 5 leaves req.body undefined when a request carries no body (Express 4
 * set it to {}). Many handlers destructure req.body, including on DELETE and
 * POST calls the client sends without a body, so keep the old shape: always an
 * object. Mount right after express.json().
 */
function ensureBody(req, res, next) {
  if (req.body === undefined) req.body = {};
  next();
}

module.exports = { ensureBody };
