const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireManager } = require('../middleware/auth');

/* ── Weights & multipliers ────────────────────────────────── */
const WEIGHTS = {
  timeline_rating:         0.15,
  delivery_quality:        0.30,
  communication_ownership: 0.20,
  documentation_quality:   0.15,
  customer_feedback:       0.20,
};
const DIFFICULTY_MULTIPLIER = { 1: 0.90, 2: 0.95, 3: 1.00, 4: 1.05, 5: 1.10 };

function computeScores(dims, difficulty) {
  const weightedSum =
    dims.timeline_rating         * WEIGHTS.timeline_rating +
    dims.delivery_quality        * WEIGHTS.delivery_quality +
    dims.communication_ownership * WEIGHTS.communication_ownership +
    dims.documentation_quality   * WEIGHTS.documentation_quality +
    dims.customer_feedback       * WEIGHTS.customer_feedback;

  const base     = Math.round((weightedSum / 5) * 1000) / 10;  // 0–100, 1 dp
  const mult     = DIFFICULTY_MULTIPLIER[difficulty] ?? 1.00;
  const adjusted = Math.min(Math.round(base * mult * 10) / 10, 100);
  return { base_score: base, adjusted_score: adjusted };
}

function rating(score) {
  if (score >= 90) return 'Exceptional';
  if (score >= 80) return 'Strong';
  if (score >= 70) return 'Acceptable';
  if (score >= 60) return 'Needs Improvement';
  return 'Performance Concern';
}

const BASE_SELECT = `
  SELECT sc.*,
    p.title  AS project_title,  p.status AS project_status,
    e.name   AS engineer_name,
    ev.name  AS evaluated_by_name
  FROM project_scorecards sc
  JOIN projects p ON sc.project_id  = p.id
  JOIN users    e ON sc.engineer_id  = e.id
  JOIN users   ev ON sc.evaluated_by = ev.id
`;

/* ── GET all ──────────────────────────────────────────────── */
router.get('/', requireAuth, async (req, res) => {
  const { project_id, engineer_id } = req.query;
  let q = BASE_SELECT + ' WHERE 1=1';
  const params = [];

  if (req.user.role === 'engineer') {
    // Engineers can only see their own scorecards
    q += ' AND sc.engineer_id = ?'; params.push(req.user.id);
  } else {
    if (engineer_id) { q += ' AND sc.engineer_id = ?';  params.push(engineer_id); }
  }
  if (project_id) { q += ' AND sc.project_id = ?'; params.push(project_id); }
  q += ' ORDER BY sc.updated_at DESC';

  const rows = (await db.prepare(q).all(...params)).map(r => ({ ...r, rating: rating(r.adjusted_score) }));
  res.json(rows);
});

/* ── GET pending-projects ─────────────────────────────────── *
 *  Returns closed/completed projects that still have at least
 *  one engineer without a scorecard.  Each entry includes
 *  unscored_engineers: [{id, name}] so the UI can filter the
 *  engineer dropdown on-the-fly.
 */
router.get('/pending-projects', requireManager, async (req, res) => {
  const projects = (await db.prepare(`
    SELECT p.id, p.title, p.status,
      COUNT(DISTINCT pa.user_id)   AS total_engineers,
      COUNT(DISTINCT sc.engineer_id) AS scored_engineers
    FROM projects p
    JOIN project_assignments pa ON pa.project_id = p.id
    JOIN users u ON u.id = pa.user_id AND u.role = 'engineer' AND u.active = 1
    LEFT JOIN project_scorecards sc
           ON sc.project_id = p.id AND sc.engineer_id = pa.user_id
    WHERE p.status IN ('closed','completed')
    GROUP BY p.id
    HAVING total_engineers > scored_engineers
    ORDER BY p.title
  `).all());

  if (!projects.length) return res.json([]);

  // Batch fetch all unscored engineers in one query (fixes N+1)
  const ph = projects.map(() => '?').join(',');
  const unscoredRows = (await db.prepare(`
    SELECT pa.project_id, u.id, u.name
    FROM project_assignments pa
    JOIN users u ON u.id = pa.user_id
    WHERE pa.project_id IN (${ph})
      AND u.role = 'engineer' AND u.active = 1
      AND NOT EXISTS (
        SELECT 1 FROM project_scorecards sc
        WHERE sc.project_id = pa.project_id AND sc.engineer_id = u.id
      )
    ORDER BY u.name
  `).all(...projects.map(p => p.id)));

  // Group by project_id
  const unscoredMap = {};
  unscoredRows.forEach(r => {
    if (!unscoredMap[r.project_id]) unscoredMap[r.project_id] = [];
    unscoredMap[r.project_id].push({ id: r.id, name: r.name });
  });

  const result = projects.map(proj => ({
    ...proj,
    unscored_engineers: unscoredMap[proj.id] || [],
  }));

  res.json(result);
});

/* ── GET one ──────────────────────────────────────────────── */
router.get('/:id', requireManager, async (req, res) => {
  const sc = (await db.prepare(BASE_SELECT + ' WHERE sc.id = ?').get(req.params.id));
  if (!sc) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'engineer' && sc.engineer_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  res.json({ ...sc, rating: rating(sc.adjusted_score) });
});

/* ── GET engineer summary (manager only) ──────────────────── */
router.get('/summary/engineers', requireManager, async (req, res) => {
  const rows = (await db.prepare(`
    SELECT
      e.id, e.name, e.email,
      COUNT(sc.id)                       AS scorecard_count,
      ROUND(AVG(sc.base_score),     1)   AS avg_base,
      ROUND(AVG(sc.adjusted_score), 1)   AS avg_adjusted,
      ROUND(MIN(sc.adjusted_score), 1)   AS min_score,
      ROUND(MAX(sc.adjusted_score), 1)   AS max_score
    FROM users e
    LEFT JOIN project_scorecards sc ON sc.engineer_id = e.id
    WHERE e.role = 'engineer' AND e.active = 1
    GROUP BY e.id
    ORDER BY avg_adjusted DESC NULLS LAST
  `).all());
  res.json(rows.map(r => ({ ...r, rating: r.avg_adjusted != null ? rating(r.avg_adjusted) : null })));
});

const RATING_FIELDS = ['timeline_rating','delivery_quality','communication_ownership','documentation_quality','customer_feedback'];

function validateRatings(body) {
  for (const f of RATING_FIELDS) {
    const v = Number(body[f]);
    if (body[f] == null) return `${f} is required`;
    if (isNaN(v) || v < 1 || v > 5 || !Number.isInteger(v)) return `${f} must be an integer between 1 and 5`;
  }
  return null;
}

/* ── POST create (manager only) ───────────────────────────── */
router.post('/', requireManager, async (req, res) => {
  const {
    project_id, engineer_id,
    timeline_rating, delivery_quality, communication_ownership,
    documentation_quality, customer_feedback,
    difficulty, notes
  } = req.body;

  const validationErr = validateRatings(req.body);
  if (validationErr) return res.status(400).json({ error: validationErr });

  const dims = { timeline_rating: Number(timeline_rating), delivery_quality: Number(delivery_quality),
                 communication_ownership: Number(communication_ownership), documentation_quality: Number(documentation_quality),
                 customer_feedback: Number(customer_feedback) };
  const diff = parseInt(difficulty) || 3;
  const { base_score, adjusted_score } = computeScores(dims, diff);

  try {
    const result = (await db.prepare(`
      INSERT INTO project_scorecards
        (project_id, engineer_id, evaluated_by,
         timeline_rating, delivery_quality, communication_ownership,
         documentation_quality, customer_feedback, difficulty,
         base_score, adjusted_score, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(project_id, engineer_id, req.user.id,
           timeline_rating, delivery_quality, communication_ownership,
           documentation_quality, customer_feedback, diff,
           base_score, adjusted_score, notes || null));
    res.json({ id: result.lastInsertRowid, base_score, adjusted_score, rating: rating(adjusted_score) });
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'A scorecard for this engineer on this project already exists. Edit the existing one.' });
    console.error('[scorecards POST]', e.message);
    res.status(500).json({ error: 'Failed to save scorecard' });
  }
});

/* ── PUT update (manager only) ────────────────────────────── */
router.put('/:id', requireManager, async (req, res) => {
  const sc = (await db.prepare('SELECT * FROM project_scorecards WHERE id = ?').get(req.params.id));
  if (!sc) return res.status(404).json({ error: 'Not found' });

  // Validate only the fields that were actually sent
  for (const f of RATING_FIELDS) {
    if (req.body[f] != null) {
      const v = Number(req.body[f]);
      if (isNaN(v) || v < 1 || v > 5 || !Number.isInteger(v))
        return res.status(400).json({ error: `${f} must be an integer between 1 and 5` });
    }
  }

  const dims = {
    timeline_rating:         Number(req.body.timeline_rating         ?? sc.timeline_rating),
    delivery_quality:        Number(req.body.delivery_quality        ?? sc.delivery_quality),
    communication_ownership: Number(req.body.communication_ownership ?? sc.communication_ownership),
    documentation_quality:   Number(req.body.documentation_quality   ?? sc.documentation_quality),
    customer_feedback:       Number(req.body.customer_feedback       ?? sc.customer_feedback),
  };
  const diff = parseInt(req.body.difficulty) ?? sc.difficulty;
  const { base_score, adjusted_score } = computeScores(dims, diff);

  (await db.prepare(`
    UPDATE project_scorecards SET
      timeline_rating=?, delivery_quality=?, communication_ownership=?,
      documentation_quality=?, customer_feedback=?, difficulty=?,
      base_score=?, adjusted_score=?, notes=?, evaluated_by=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(dims.timeline_rating, dims.delivery_quality, dims.communication_ownership,
         dims.documentation_quality, dims.customer_feedback, diff,
         base_score, adjusted_score, req.body.notes ?? sc.notes, req.user.id, sc.id));

  res.json({ ok: true, base_score, adjusted_score, rating: rating(adjusted_score) });
});

/* ── DELETE (manager only) ────────────────────────────────── */
router.delete('/:id', requireManager, async (req, res) => {
  (await db.prepare('DELETE FROM project_scorecards WHERE id = ?').run(req.params.id));
  res.json({ ok: true });
});

/* ── GET trend data — per-engineer scorecard history ─────── */
// Single query instead of N+1 (was: 1 query for engineers list + N queries for cards)
router.get('/trend/all', requireManager, async (req, res) => {
  const allCards = (await db.prepare(`
    SELECT sc.engineer_id, sc.adjusted_score, sc.base_score, sc.difficulty,
           sc.created_at, p.title AS project_title,
           e.name AS engineer_name, e.email AS engineer_email
    FROM project_scorecards sc
    JOIN projects p ON sc.project_id = p.id
    JOIN users e ON sc.engineer_id = e.id
    ORDER BY e.name ASC, sc.created_at ASC
  `).all());

  // Group by engineer in application code
  const engineerMap = new Map();
  allCards.forEach(row => {
    if (!engineerMap.has(row.engineer_id)) {
      engineerMap.set(row.engineer_id, {
        id: row.engineer_id, name: row.engineer_name, email: row.engineer_email, scorecards: [],
      });
    }
    engineerMap.get(row.engineer_id).scorecards.push({
      adjusted_score: row.adjusted_score, base_score: row.base_score,
      difficulty: row.difficulty, created_at: row.created_at, project_title: row.project_title,
    });
  });

  res.json([...engineerMap.values()]);
});

module.exports = router;
