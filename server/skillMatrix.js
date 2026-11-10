/**
 * Skill matrix: how each engineer is rated per technology, and whether the team
 * has enough people who know each technology well.
 *
 * "Skilled" means Senior or Expert. A technology is a gap when nobody is skilled,
 * at risk when fewer are skilled than its target (one skilled engineer is a single
 * point of knowledge), and covered otherwise.
 */
const LEVELS = Object.freeze([
  { value: 1, label: 'Junior' },
  { value: 2, label: 'Intermediate' },
  { value: 3, label: 'Senior' },
  { value: 4, label: 'Expert' },
]);
const SKILLED = 3;

function coverage(technologies, ratings) {
  return technologies.map(tech => {
    const rows = ratings.filter(r => Number(r.technology_id) === Number(tech.id));
    const byLevel = Object.fromEntries(LEVELS.map(l => [l.value, rows.filter(r => Number(r.level) === l.value).length]));
    const skilled = rows.filter(r => Number(r.level) >= SKILLED).length;
    const target = Number(tech.skill_target) || 2;
    const status = skilled === 0 ? 'gap' : skilled < target ? 'at_risk' : 'covered';
    return { technology_id: tech.id, by_level: byLevel, rated: rows.length, skilled, target, single_point: skilled === 1, status };
  });
}

module.exports = { LEVELS, SKILLED, coverage };
