const { RequestTrackerProvider } = require('./requestTrackerProvider');

function createTicketingProvider(type,config,options) {
  if (type!=='request_tracker') throw Object.assign(new Error('Unsupported ticketing provider'),{ status:400 });
  return new RequestTrackerProvider(config,options);
}

module.exports={ createTicketingProvider,RequestTrackerProvider };
