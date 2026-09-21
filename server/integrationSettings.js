const object = value => value && typeof value==='object' && !Array.isArray(value);
const fail = message => { throw Object.assign(new Error(message),{ status: 400 }); };
const NOTIFY_EVENTS = ['task_assigned','project_assigned','visit_assigned','report_submitted','visit_reminder'];
function safeSettings(settings = {}) {
  const teams = settings.teams || {},webex = settings.webex || {};
  return {
    teams: { enabled: !!teams.enabled,webhook_url: '',webhook_url_set: !!teams.webhook_url },
    webex: { enabled: !!webex.enabled,bot_token: '',bot_token_set: !!webex.bot_token,mode: webex.mode || 'both',space_id: webex.space_id || '',test_email: webex.test_email || '' },
    notify_on: Object.fromEntries(NOTIFY_EVENTS.map(key => [key,settings.notify_on?.[key]!==false])),
  };
}
function mergeSettings(current,body) {
  if (!object(body) || Object.keys(body).some(key => !['teams','webex','notify_on'].includes(key))) fail('Invalid integration settings');
  const result = { ...current };
  for (const [platform,secret] of [['teams','webhook_url'],['webex','bot_token']]) {
    if (body[platform]===undefined) continue;
    const cfg = body[platform];
    if (!object(cfg)) fail('Invalid integration configuration');
    const allowed = platform==='teams' ? ['enabled'] : ['enabled','mode','space_id','test_email'];
    const merged = { ...current[platform] };
    for (const key of allowed) if (cfg[key]!==undefined) {
      if (key==='enabled' ? typeof cfg[key]!=='boolean' : typeof cfg[key]!=='string' || cfg[key].length>512) fail(`Invalid ${platform} ${key}`);
      merged[key]=cfg[key];
    }
    if (cfg.mode!==undefined && !['direct','space','both'].includes(cfg.mode)) fail('Invalid Webex delivery mode');
    if (cfg[secret]!==undefined && (typeof cfg[secret]!=='string' || cfg[secret].length>4096)) fail('Invalid integration credential');
    if (cfg['clear_'+secret]!==undefined && typeof cfg['clear_'+secret]!=='boolean') fail('Invalid credential clearing option');
    merged[secret] = cfg['clear_'+secret] ? '' : cfg[secret] || current[platform]?.[secret] || '';
    result[platform]=merged;
  }
  if (body.notify_on!==undefined) {
    if (!object(body.notify_on) || Object.keys(body.notify_on).some(key => !NOTIFY_EVENTS.includes(key)) || Object.values(body.notify_on).some(value => typeof value!=='boolean')) fail('Invalid notification rules');
    result.notify_on={ ...current.notify_on,...body.notify_on };
  }
  return result;
}
module.exports = { safeSettings,mergeSettings };
