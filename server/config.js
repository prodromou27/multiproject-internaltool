function isHexKey(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

function isUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function getRuntimeConfigIssues(env = process.env) {
  const errors = [];
  const warnings = [];
  const isProd = env.NODE_ENV === 'production';

  if (isProd && !env.DATABASE_URL) {
    errors.push('DATABASE_URL is required in production');
  } else if (!env.DATABASE_URL) {
    warnings.push('DATABASE_URL is not set; node-postgres will use local defaults');
  }

  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    if (isProd) errors.push('JWT_SECRET must be at least 32 characters in production');
    else warnings.push('JWT_SECRET is missing/short; sessions will reset on restart');
  }

  for (const keyName of ['CUSTOMER_FIELD_KEY', 'ATTACHMENT_KEY']) {
    const value = env[keyName];
    if (!value) {
      if (isProd) errors.push(`${keyName} is required in production`);
      else warnings.push(`${keyName} is not set; related data may be stored plaintext`);
    } else if (!isHexKey(value)) {
      errors.push(`${keyName} must be exactly 64 hex characters`);
    }
  }

  if (env.APP_URL && !isUrl(env.APP_URL)) {
    errors.push('APP_URL must be a valid http(s) URL');
  } else if (isProd && !env.APP_URL) {
    errors.push('APP_URL is required in production for password reset links');
  }

  if (env.ALLOWED_ORIGIN && !isUrl(env.ALLOWED_ORIGIN)) {
    errors.push('ALLOWED_ORIGIN must be a valid http(s) URL');
  }

  if (env.TRUST_PROXY) {
    const hops = Number(env.TRUST_PROXY);
    if (!Number.isInteger(hops) || hops < 1) {
      errors.push('TRUST_PROXY must be a positive integer when set');
    }
  }

  return { errors, warnings };
}

function validateRuntimeConfig() {
  const { errors, warnings } = getRuntimeConfigIssues();
  warnings.forEach(w => console.warn(`[config] WARNING: ${w}`));
  if (errors.length) {
    errors.forEach(e => console.error(`[config] FATAL: ${e}`));
    process.exit(1);
  }
}

module.exports = { getRuntimeConfigIssues, validateRuntimeConfig };
