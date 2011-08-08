var xmpp = require('node-xmpp');

var XmppCampfireClient = require('./lib/client').XmppCampfireClient;

var clients = {};

var xmpp_domain = process.argv[2];

if (!xmpp_domain) {
  console.log('usage: ' + process.argv[1] + ' <xmpp domain>');
  process.exit(1);
}

var router = new xmpp.Router();
router.register('campfire.lannbox.com', function(stanza) {
  var key = stanza.attrs.from.toLowerCase();
  var client = clients[key];
  if (!client) {
    client = clients[key] = new XmppCampfireClient(router, stanza.attrs.from);
  }
  client.handle_stanza(stanza);
});

process.on('uncaughtException', function (err) {
  console.log('Uncaught exception: ' + err.stack || err);
});

process.once('SIGINT', function() {
  console.log('Shutting down...');
  
  for (var client_key in clients) {
    if (clients[client_key].exit_all) {
      clients[client_key].exit_all();
    }
  }

  router.unregister('campfire.lannbox.com');
  
  setTimeout(process.exit, 1000);
});
