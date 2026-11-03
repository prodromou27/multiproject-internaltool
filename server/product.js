const PRODUCT_NAME = 'TeamHub';
const LEGACY_PRODUCT_NAMES = new Set(['SolutionsHub', 'Solutions Hub']);

function currentProductName(value) {
  return LEGACY_PRODUCT_NAMES.has(value) ? PRODUCT_NAME : value;
}

module.exports = { PRODUCT_NAME, currentProductName };
