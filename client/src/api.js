const BASE = '/api';

function forceLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  fetch(BASE + '/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true,
    headers: { 'X-SolutionsHub-Request': '1' } }).catch(() => {});
  // Hard redirect — clears React state and lands on login
  window.location.href = '/login';
}

function handleUnauthorized(status, data, redirect) {
  if (redirect && status === 401) {
    forceLogout();
    return true;
  }
  if (redirect && data.code === 'PASSWORD_CHANGE_REQUIRED') window.location.href = '/login';
  return false;
}

async function req(method, path, body, { redirectOnUnauthorized = true, signal } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-SolutionsHub-Request': '1',
    },
    body: body != null ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));

  // Token expired or invalid → log out immediately
  if (!res.ok) {
    handleUnauthorized(res.status, data, redirectOnUnauthorized);
    const error = new Error(data.error || res.statusText);
    error.status = res.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

async function upload(path, field, file) {
  const fd = new FormData();
  fd.append(field, file);
  const res = await fetch(BASE + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-SolutionsHub-Request': '1' },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleUnauthorized(res.status, data, true);
    throw new Error(data.error || res.statusText);
  }
  return data;
}

export const api = {
  // auth
  login: (email, password) => req('POST', '/auth/login', { email, password }, { redirectOnUnauthorized: false }),
  logout: () => req('POST', '/auth/logout', {}, { redirectOnUnauthorized: false }),
  verify2fa: (partial_token, code) => req('POST', '/auth/2fa/verify', { partial_token, code }, { redirectOnUnauthorized: false }),
  setup2fa: () => req('GET', '/auth/2fa/setup'),
  enable2fa: (code) => req('POST', '/auth/2fa/enable', { code }),
  disable2fa: (password) => req('DELETE', '/auth/2fa', { password }),
  users: (options) => req('GET', '/auth/users', undefined, options),
  me: (options) => req('GET', '/auth/me', undefined, options),
  updateProfile: (data) => req('PUT', '/auth/profile', data),
  changePassword: (data) => req('POST', '/auth/change-password', data),
  firstTimeChangePassword: (new_password) => req('POST', '/auth/change-password-first', { new_password }),
  forgotPassword: (email) => req('POST', '/auth/forgot-password', { email }, { redirectOnUnauthorized: false }),
  downloadToken: () => req('POST', '/auth/download-token', {}),
  icalTokenStatus: () => req('GET', '/auth/ical-token'),
  generateIcalToken: () => req('POST', '/auth/ical-token', {}),
  revokeIcalToken: () => req('DELETE', '/auth/ical-token'),
  resetPassword: (token, new_password) => req('POST', '/auth/reset-password', { token, new_password }, { redirectOnUnauthorized: false }),
  getSecuritySettings: () => req('GET', '/settings/security'),
  saveSecuritySettings: (data) => req('PUT', '/settings/security', data),
  uploadAvatar: (file) => {
    return upload('/auth/avatar', 'avatar', file);
  },
  removeAvatar: () => req('DELETE', '/auth/avatar'),

  // projects
  projects: (options) => req('GET', '/projects', undefined, options),
  project: (id, options) => req('GET', `/projects/${id}`, undefined, options),
  createProject: (data) => req('POST', '/projects', data),
  updateProject: (id, data) => req('PUT', `/projects/${id}`, data),
  requestClosure: (id) => req('POST', `/projects/${id}/request-closure`, {}),
  approveClosure: (id, review = {}) => req('POST', `/projects/${id}/approve-closure`, review),
  rejectClosure: (id, review) => req('POST', `/projects/${id}/reject-closure`, review),
  closureApprovals: (params = {}, options) => req('GET', '/projects/approvals?' + new URLSearchParams(params), undefined, options),
  addStatusUpdate: (id, message) => req('POST', `/projects/${id}/status-update`, { message }),
  addMembers: (id, user_ids) => req('POST', `/projects/${id}/members`, { user_ids }),
  removeMember: (pid, uid) => req('DELETE', `/projects/${pid}/members/${uid}`),
  pinProject: (id) => req('POST', `/projects/${id}/pin`, {}),
  unpinProject: (id) => req('DELETE', `/projects/${id}/pin`),

  // tasks
  tasks: (params = {}, options) => req('GET', '/tasks?' + new URLSearchParams(params).toString(), undefined, options),
  createTask: (data) => req('POST', '/tasks', data),
  updateTask: (id, data) => req('PUT', `/tasks/${id}`, data),
  deleteTask: (id) => req('DELETE', `/tasks/${id}`),
  bulkUpdateTasks: (data) => req('POST', '/tasks/bulk', data),
  duplicateTask: (id) => req('POST', `/tasks/${id}/duplicate`, {}),
  overdueCounts: () => req('GET', '/tasks/overdue-counts'),

  // custom fields
  customFields: (projectId) => req('GET', `/projects/${projectId}/custom-fields`),
  createCustomField: (projectId, data) => req('POST', `/projects/${projectId}/custom-fields`, data),
  updateCustomField: (projectId, fid, data) => req('PUT', `/projects/${projectId}/custom-fields/${fid}`, data),
  deleteCustomField: (projectId, fid) => req('DELETE', `/projects/${projectId}/custom-fields/${fid}`),
  taskCustomValues: (projectId, taskId) => req('GET', `/projects/${projectId}/custom-fields/values/${taskId}`),
  saveTaskCustomValues: (projectId, taskId, values) => req('PUT', `/projects/${projectId}/custom-fields/values/${taskId}`, { values }),

  // attachments
  attachments: (project_id) => req('GET', `/attachments/${project_id}`),
  uploadAttachment: (project_id, file) => {
    return upload(`/attachments/${project_id}`, 'file', file);
  },
  downloadAttachmentUrl: (project_id, id, downloadToken) => `${BASE}/attachments/${project_id}/download/${id}?token=${encodeURIComponent(downloadToken)}`,
  deleteAttachment: (project_id, id) => req('DELETE', `/attachments/${project_id}/${id}`),

  // kpis
  kpis: (project_id) => req('GET', `/kpis/${project_id}`),
  createKpi: (project_id, data) => req('POST', `/kpis/${project_id}`, data),
  updateKpi: (project_id, id, data) => req('PUT', `/kpis/${project_id}/${id}`, data),
  deleteKpi: (project_id, id) => req('DELETE', `/kpis/${project_id}/${id}`),

  // reports
  reportSummary: (options) => req('GET', '/reports/summary', undefined, options),
  operationsOverview: (params = {}, options) => req('GET', '/operations/overview?' + new URLSearchParams(params), undefined, options),
  reportProjects: (options) => req('GET', '/reports/projects', undefined, options),
  reportMonthly: () => req('GET', '/reports/monthly'),

  // scorecards
  scorecards: (params = {}) => req('GET', '/scorecards?' + new URLSearchParams(params).toString()),
  scorecard: (id) => req('GET', `/scorecards/${id}`),
  scorecardEngineerSummary: () => req('GET', '/scorecards/summary/engineers'),
  scorecardPendingProjects: () => req('GET', '/scorecards/pending-projects'),
  scorecardTrends: () => req('GET', '/scorecards/trend/all'),
  createScorecard: (data) => req('POST', '/scorecards', data),
  updateScorecard: (id, data) => req('PUT', `/scorecards/${id}`, data),
  deleteScorecard: (id) => req('DELETE', `/scorecards/${id}`),

  // admin
  adminUsers: () => req('GET', '/admin/users'),
  adminCreateUser: (data) => req('POST', '/admin/users', data),
  adminUpdateUser: (id, data) => req('PUT', `/admin/users/${id}`, data),
  adminResetPassword: (id, password) => req('POST', `/admin/users/${id}/reset-password`, { password }),
  adminToggleActive: (id) => req('POST', `/admin/users/${id}/toggle-active`, {}),
  adminDeleteUser: (id) => req('DELETE', `/admin/users/${id}`),
  adminToggle2faExempt: (id) => req('POST', `/admin/users/${id}/toggle-2fa-exempt`, {}),
  adminStats: () => req('GET', '/admin/stats'),
  adminActivity: (limit = 60) => req('GET', `/admin/activity?limit=${limit}`),

  // customers
  customers: (options) => req('GET', '/customers', undefined, options),
  customer: (id, options) => req('GET', `/customers/${id}`, undefined, options),
  customerOverview: (id, params = {}, options) => req('GET', `/customers/${id}/overview?` + new URLSearchParams(params).toString(), undefined, options),
  customerRecommendations: (id, params = {}, options) => req('GET', `/customers/${id}/recommendations?` + new URLSearchParams(params).toString(), undefined, options),
  createRecommendation: (id, body) => req('POST', `/customers/${id}/recommendations`, body),
  updateRecommendation: (id, recommendationId, body) => req('PUT', `/customers/${id}/recommendations/${recommendationId}`, body),
  convertRecommendation: (id, recommendationId, body) => req('POST', `/customers/${id}/recommendations/${recommendationId}/convert-to-project`, body),
  createCustomer: (data) => req('POST', '/customers', data),
  updateCustomer: (id, data) => req('PUT', `/customers/${id}`, data),
  deleteCustomer: (id) => req('DELETE', `/customers/${id}`),
  customersTemplateUrl: () => `${BASE}/customers/template/download`,
  importCustomers: (file) => {
    return upload('/customers/import', 'file', file);
  },

  // maintenance visits
  maintenanceVisits: (params = {}, options = {}) => req('GET', '/maintenance-visits?' + new URLSearchParams(params).toString(), undefined, options),
  maintenanceVisit: (id) => req('GET', `/maintenance-visits/${id}`),
  createVisit: (data) => req('POST', '/maintenance-visits', data),
  updateVisit: (id, data) => req('PUT', `/maintenance-visits/${id}`, data),
  markReportSent: (id) => req('POST', `/maintenance-visits/${id}/report-sent`, {}),
  markReportUnsent: (id) => req('POST', `/maintenance-visits/${id}/report-unsent`, {}),
  markCustomerSent: (id) => req('POST', `/maintenance-visits/${id}/report-customer-sent`, {}),
  markCustomerUnsent: (id) => req('POST', `/maintenance-visits/${id}/report-customer-unsent`, {}),
  completeVisit: (id) => req('POST', `/maintenance-visits/${id}/complete`, {}),
  deleteVisit: (id) => req('DELETE', `/maintenance-visits/${id}`),
  maintenanceVisitsTemplateUrl: () => `${BASE}/maintenance-visits/template/download`,
  importVisits: (file) => {
    return upload('/maintenance-visits/import', 'file', file);
  },

  // milestones
  milestones:        (project_id, options) => req('GET', `/milestones?project_id=${project_id}`, undefined, options),
  createMilestone:   (data)       => req('POST', '/milestones', data),
  updateMilestone:   (id, data)   => req('PUT', `/milestones/${id}`, data),
  completeMilestone: (id)         => req('POST', `/milestones/${id}/complete`, {}),
  reopenMilestone:   (id)         => req('POST', `/milestones/${id}/reopen`, {}),
  deleteMilestone:   (id)         => req('DELETE', `/milestones/${id}`),

  // audit log (manager only)
  auditLog:      (params = {}) => req('GET', '/audit?' + new URLSearchParams(params).toString()),
  auditLogUsers: ()            => req('GET', '/audit/users'),

  // Excel effort-sheet import
  importExcelPreview: (projectId, file) => {
    return upload(`/projects/${projectId}/import-excel/preview`, 'file', file);
  },
  importExcelConfirm: (projectId, tasks) => req('POST', `/projects/${projectId}/import-excel/confirm`, { tasks }),

  // task dependencies
  taskDependencies: (taskId) => req('GET', `/tasks/${taskId}/dependencies`),
  addTaskDependency: (taskId, depends_on_id) => req('POST', `/tasks/${taskId}/dependencies`, { depends_on_id }),
  removeTaskDependency: (taskId, depId) => req('DELETE', `/tasks/${taskId}/dependencies/${depId}`),

  // project templates
  templates: () => req('GET', '/templates'),
  template: (id) => req('GET', `/templates/${id}`),
  createTemplate: (data) => req('POST', '/templates', data),
  updateTemplate: (id, data) => req('PUT', `/templates/${id}`, data),
  deleteTemplate: (id) => req('DELETE', `/templates/${id}`),
  addTemplateTask: (tplId, data) => req('POST', `/templates/${tplId}/tasks`, data),
  updateTemplateTask: (tplId, tid, data) => req('PUT', `/templates/${tplId}/tasks/${tid}`, data),
  deleteTemplateTask: (tplId, tid) => req('DELETE', `/templates/${tplId}/tasks/${tid}`),
  applyTemplate: (tplId, data) => req('POST', `/templates/${tplId}/apply`, data),

  // task comments
  taskComments: (taskId) => req('GET', `/tasks/${taskId}/comments`),
  addTaskComment: (taskId, message) => req('POST', `/tasks/${taskId}/comments`, { message }),
  deleteTaskComment: (taskId, cid) => req('DELETE', `/tasks/${taskId}/comments/${cid}`),

  // project activity
  projectActivity: (projectId, options) => req('GET', `/projects/${projectId}/activity`, undefined, options),

  // workload
  workload: () => req('GET', '/workload'),
  workloadForecast: () => req('GET', '/workload/forecast'),
  workloadPlanning: (params = {}, options) => req('GET', '/workload/planning?' + new URLSearchParams(params).toString(), undefined, options),
  workloadEstimate: (body) => req('PUT', '/workload/planning/estimate', body),
  workloadAvailability: (body) => req('PUT', '/workload/planning/availability', body),
  customReportSources: (options) => req('GET', '/reports/custom/sources',undefined,options),
  customReportPreview: (definition,options) => req('POST','/reports/custom/preview',definition,options),
  savedReports: (params = {},options) => req('GET','/reports/custom/saved?' + new URLSearchParams(params).toString(),undefined,options),
  savedReport: (id,options) => req('GET',`/reports/custom/saved/${id}`,undefined,options),
  createSavedReport: (body) => req('POST','/reports/custom/saved',body),
  updateSavedReport: (id,body) => req('PUT',`/reports/custom/saved/${id}`,body),
  deleteSavedReport: (id,version) => req('DELETE',`/reports/custom/saved/${id}`,{ version }),
  customReportExport: async (definition,format = 'xlsx') => {
    const response = await fetch('/api/reports/custom/' + (format==='csv' ? 'export-csv' : 'export'),{ method: 'POST',credentials: 'same-origin',headers: { 'Content-Type': 'application/json','X-SolutionsHub-Request': '1' },body: JSON.stringify(definition) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      handleUnauthorized(response.status,data,true);
      throw new Error(data.error || 'Report export failed');
    }
    return response.blob();
  },

  // time logs
  timeLogs: (params) => req('GET', '/time-logs?' + new URLSearchParams(params).toString()),
  myTimeLogs: (from, to) => req('GET', `/time-logs/mine?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  logTime: (data) => req('POST', '/time-logs', data),
  deleteTimeLog: (id) => req('DELETE', `/time-logs/${id}`),

  // personal notes & todos
  getNote: () => req('GET', '/notes/note'),
  saveNote: (content) => req('PUT', '/notes/note', { content }),
  getTodos: () => req('GET', '/notes/todos'),
  createTodo: (title) => req('POST', '/notes/todos', { title }),
  updateTodo: (id, data) => req('PUT', `/notes/todos/${id}`, data),
  deleteTodo: (id) => req('DELETE', `/notes/todos/${id}`),
  clearDoneTodos: () => req('DELETE', '/notes/todos'),

  // notifications
  notifications: () => req('GET', '/notifications'),
  markNotificationRead: (id) => req('PATCH', `/notifications/${id}/read`, {}),
  markAllNotificationsRead: () => req('POST', '/notifications/read-all', {}),
  deleteNotification: (id) => req('DELETE', `/notifications/${id}`),
  clearNotifications: () => req('DELETE', '/notifications'),

  // global search
  search: (q) => req('GET', `/search?q=${encodeURIComponent(q)}`),
  smartSearch: (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== false)
    );
    return req('GET', '/search/smart?' + new URLSearchParams(clean).toString());
  },

  // statuses
  getStatuses: () => req('GET', '/statuses'),
  saveStatuses: (data) => req('PUT', '/statuses', data),

  // SLA
  slaOverview: () => req('GET', '/sla/overview'),

  // calendar
  calendar: (month, options) => req('GET', `/calendar?${new URLSearchParams({ month })}`, undefined, options),

  // settings / integrations
  getIntegrations: () => req('GET', '/settings/integrations'),
  saveIntegrations: (data) => req('POST', '/settings/integrations', data),
  testIntegration: (platform, settings) => req('POST', '/settings/integrations/test', { platform, settings }),

  // system update
  systemUpdateStatus:  () => req('GET',  '/settings/system-update/status'),
  systemUpdateCheck:   () => req('POST', '/settings/system-update/check', {}),
  systemUpdateStart:   () => req('POST', '/settings/system-update/start', {}),
  systemUpdateRestart: () => req('POST', '/settings/system-update/restart', {}),
  deploymentHealth:    () => req('GET',  '/settings/deployment-health'),

  // localization settings
  getLocalization: () => req('GET', '/settings/localization'),
  saveLocalization: (data) => req('PUT', '/settings/localization', data),

  // admin notifications
  getAdminNotifications: () => req('GET', '/settings/admin-notifications'),
  saveAdminNotifications: (data) => req('PUT', '/settings/admin-notifications', data),
  runSystemCheck: () => req('POST', '/settings/system-alerts/check', {}),

  // logging settings
  getLogging: () => req('GET', '/settings/logging'),
  saveLogging: (data) => req('PUT', '/settings/logging', data),
  downloadLogs: () => {
    return fetch(`${BASE}/settings/logging/download`, {
      credentials: 'same-origin',
    }).then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.blob();
    }).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'app-log.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  },

  // teams (Service Activity Tracking)
  teamsMine: () => req('GET', '/teams/mine'),
  teams: () => req('GET', '/teams'),
  team: (id) => req('GET', `/teams/${id}`),
  createTeam: (data) => req('POST', '/teams', data),
  updateTeam: (id, data) => req('PUT', `/teams/${id}`, data),
  deleteTeam: (id) => req('DELETE', `/teams/${id}`),
  setTeamMembers: (id, user_ids) => req('PUT', `/teams/${id}/members`, { user_ids }),

  // activity categories / subcategories
  activityCategories: (options) => req('GET', '/activity-categories', undefined, options),
  createActivityCategory: (data) => req('POST', '/activity-categories', data),
  updateActivityCategory: (id, data) => req('PUT', `/activity-categories/${id}`, data),
  deleteActivityCategory: (id) => req('DELETE', `/activity-categories/${id}`),
  createActivitySubcategory: (categoryId, data) => req('POST', `/activity-categories/${categoryId}/subcategories`, data),
  updateActivitySubcategory: (categoryId, subId, data) => req('PUT', `/activity-categories/${categoryId}/subcategories/${subId}`, data),
  deleteActivitySubcategory: (categoryId, subId) => req('DELETE', `/activity-categories/${categoryId}/subcategories/${subId}`),

  // technologies
  technologies: () => req('GET', '/technologies'),
  createTechnology: (data) => req('POST', '/technologies', data),
  updateTechnology: (id, data) => req('PUT', `/technologies/${id}`, data),
  deleteTechnology: (id) => req('DELETE', `/technologies/${id}`),

  // service activities (Activity Log / MSP Operations Log)
  exportServiceActivities: async (params = {}) => {
    const response = await fetch(`${BASE}/service-activities/export?${new URLSearchParams(params)}`, { credentials: 'same-origin', headers: { 'X-SolutionsHub-Request': '1' } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      handleUnauthorized(response.status, data, true);
      throw new Error(data.error || 'Failed to export activities');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'service_activities.xlsx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  serviceActivityMeta: () => req('GET', '/service-activities/meta'),
  serviceActivities: (params = {}, options) => req('GET', '/service-activities?' + new URLSearchParams(params).toString(), undefined, options),
  serviceActivity: (id, options) => req('GET', `/service-activities/${id}`, undefined, options),
  createServiceActivity: (data) => req('POST', '/service-activities', data),
  updateServiceActivity: (id, data) => req('PUT', `/service-activities/${id}`, data),
  deleteServiceActivity: (id) => req('DELETE', `/service-activities/${id}`),
  completeServiceActivity: (id) => req('POST', `/service-activities/${id}/complete`, {}),
  duplicateServiceActivity: (id) => req('POST', `/service-activities/${id}/duplicate`, {}),
  createFollowUpTask: (id) => req('POST', `/service-activities/${id}/follow-up-task`, {}),
  serviceActivityAttachments: (id, options) => req('GET', `/service-activities/${id}/attachments`, undefined, options),
  uploadServiceActivityAttachment: (id, file) => upload(`/service-activities/${id}/attachments`, 'file', file),
  downloadServiceActivityAttachmentUrl: (id, attId, downloadToken) =>
    `${BASE}/service-activities/${id}/attachments/${attId}/download?token=${encodeURIComponent(downloadToken)}`,
  deleteServiceActivityAttachment: (id, attId) => req('DELETE', `/service-activities/${id}/attachments/${attId}`),

  // customer service profile (customer-team/engineer assignment, activity summary)
  customerTeams: (id) => req('GET', `/customers/${id}/teams`),
  setCustomerTeams: (id, team_ids) => req('PUT', `/customers/${id}/teams`, { team_ids }),
  customerEngineers: (id) => req('GET', `/customers/${id}/engineers`),
  setCustomerEngineers: (id, user_ids) => req('PUT', `/customers/${id}/engineers`, { user_ids }),
  customerServiceActivities: (id, params = {}, options) => req('GET', `/customers/${id}/service-activities?` + new URLSearchParams(params).toString(), undefined, options),
  customerServiceSummary: (id, params = {}, options) => req('GET', `/customers/${id}/service-summary?` + new URLSearchParams(params).toString(), undefined, options),
  customerContractHours: (id, options) => req('GET', `/customers/${id}/contract-hours`, undefined, options),

  // service activity settings (admin) — retention, attachments/follow-up toggles
  getServiceActivitySettings: () => req('GET', '/service-activity-settings'),
  saveServiceActivitySettings: (data) => req('PUT', '/service-activity-settings', data),
  serviceActivityRetentionStatus: () => req('GET', '/service-activity-settings/retention-status'),
  purgeOldActivities: () => req('POST', '/service-activity-settings/purge', {}),

  // service activity reports (management)
  serviceActivityOverview: (params = {}) => req('GET', '/reports/service-activity/overview?' + new URLSearchParams(params).toString()),
  serviceActivityCustomerReport: (params) => req('GET', '/reports/service-activity/customer?' + new URLSearchParams(params).toString()),
  serviceActivityEngineerReport: (params) => req('GET', '/reports/service-activity/engineer?' + new URLSearchParams(params).toString()),
  serviceActivityTeamReport: (params) => req('GET', '/reports/service-activity/team?' + new URLSearchParams(params).toString()),

  // weekly report settings
  getSmtp: () => req('GET', '/report-settings/smtp'),
  saveSmtp: (data) => req('PUT', '/report-settings/smtp', data),
  testSmtp: (smtp, to) => req('POST', '/report-settings/smtp/test', { smtp, to }),
  getReportSchedule: () => req('GET', '/report-settings/schedule'),
  saveReportSchedule: (data) => req('PUT', '/report-settings/schedule', data),
  previewReportData: () => req('GET', '/report-settings/preview-data'),
  sendReportNow: () => req('POST', '/report-settings/send-now', {}),
  reportManagers: () => req('GET', '/report-settings/managers'),
};
