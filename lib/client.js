var xmpp = require('node-xmpp');

var XmppCampfireRoom = require('./room').XmppCampfireRoom;

var XmppCampfireClient = function(router, client_jid) {
  this.jid = new xmpp.JID(client_jid);
  this.router = router;

  this.rooms = {};
};

XmppCampfireClient.prototype = {
  
  handle_stanza: function(stanza) {
    if (stanza.attrs.from !== this.jid.toString()) {
      this.log('handle_stanza', stanza.attrs.from);
      return;
    }

    if (stanza.attrs.type === 'error') {
      // TODO handle client errors (exit, probably):
      //  <gone/>, <item-not-found/>, <recipient-unavailable/>, <redirect/>,
      //  <remote-server-not-found/>, <remote-server-timeout/>
      this.log('error stanza\n', stanza.toString());
      return;
    }
    
    var room_jid = new xmpp.JID(stanza.attrs.to);
    var key = room_jid.user.toLowerCase();
    
    var room = this.rooms[key];
    if (!room) {
      room = this.rooms[key] = new XmppCampfireRoom(this, room_jid);
    }
    room.handle_stanza(stanza);
  },

  send_stanza: function(stanza) {
    stanza = stanza.root();
    stanza.attrs.to = this.jid.toString();
    this.router.send(stanza);
  },

  exit_all: function() {
    for (var room_key in this.rooms) {
      if (this.rooms[room_key].handle_exit) {
        this.rooms[room_key].handle_exit(null, 332);
      }
    }
  },
  
  log: function() {
    Array.prototype.unshift.call(arguments, this.jid.toString());
    
    var err = arguments[arguments.length - 1];
    if (err && err.stack) {
      arguments[arguments.length - 1] = err.stack;
    }
    console.log.apply(null, arguments);
  }
};


exports.XmppCampfireClient = XmppCampfireClient;
