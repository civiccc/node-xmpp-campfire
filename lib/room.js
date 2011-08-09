var Step     = require('step');
var xmpp     = require('node-xmpp');

var _campfire = require('../vendor/node-campfire/lib/campfire');
var Campfire  = _campfire.Campfire;
var Room      = _campfire.Room;

var ERROR_NS    = 'urn:ietf:params:xml:ns:xmpp-stanzas';
var MUC_NS      = 'http://jabber.org/protocol/muc';
var MUC_USER_NS = MUC_NS + '#user';

var TWITTER_STATUS_PREFIX = 'http://twitter.com/twitter/status/';

var XmppCampfireRoom = function(client, room_jid) {
  if (typeof(room_jid) === 'string') {
    room_jid = new xmpp.JID(room_jid);
  }
  
  this.client = client;
  this.jid = room_jid.bare();
  this.connecting = false;
  this.present = false;

  this.campfire = null;
  this.campfire_user = {};
  this.campfire_room = null;
  this.campfire_roster = [];
  this.campfire_users = {};

  // JID "buffer"
  this._jid = room_jid;
};

XmppCampfireRoom.prototype = {
  
  handle_stanza: function(stanza) {
    this.log('>>>', stanza.name);
    
    if (stanza.is('presence')) {
      if (stanza.attrs.type === 'unavailable') {
        if (this.present) {
          this.handle_exit(stanza);
        }
      } else if (stanza.children.length) {
        this.handle_enter(stanza);
      }

      if (stanza.attrs.type !== 'unsubscribed') {
        this.handle_xmpp_presence(stanza);
      }
    } else if (!this.present) {
      this.send_stanza(
        null, build_xmpp_error(
          stanza, 'modify', 'not-acceptable', 'Not in room'));
    } else if (stanza.is('message') && stanza.attrs.type === 'groupchat') {
      this.handle_xmpp_message(stanza);
    } else if (stanza.is('iq')) {
      if (stanza.attrs.type === 'get' && stanza.getChild('vCard', 'vcard-temp')) {
        this.handle_xmpp_vcard(stanza);
      }
      this.send_stanza(
        stanza.attrs.from.split('/')[1], build_xmpp_error(
          stanza, 'cancel', 'service-unavailable'));
    } else {
      this.log('unhandled stanza:', stanza.toString());
    }
  },
  
  handle_enter: function(stanza) {
    var self = this;
    var options = {ssl: true};
    var room_name;
    
    Step(
      function auth() {
        if (self.present &&
            self._prev_id === stanza.attrs.id) {
          self.log('duplicate presence received');
          return;
        }
        self._prev_id = stanza.attrs.id;
        
        if (self.connecting) {
          self.log('already connecting');
          return;
        }
        self.connecting = true;
        
        var i = self.jid.user.indexOf('+');
        if (i > -1) {
          options.account = self.jid.user.substr(0, i).trim();
          room_name = self.jid.user.substr(i + 1).trim();
        } else {
          throw 302;
        }
  
        var x = stanza.getChild('x', MUC_NS);
        options.token = x ? x.getChildText('password') : null;
        if (!options.token) {
          throw 401;
        }
        
        self.campfire = new Campfire(options);

        if (options.token.length != 40) {
          var username = stanza.attrs.to.split('/')[1];
          self.campfire.authorization = 'Basic ' + new Buffer(
            username + ':' + options.token).toString('base64');
        }
        
        self.campfire.me(this);
      },
      
      function get_rooms(err, response) {
        if (err) throw err;

        self.campfire_user = response.user;
        self.campfire_users[response.user.id] = response.user;

        // Reset token in case we used username/password
        if (response.user.api_auth_token) {
          options.token = response.user.api_auth_token;
          self.campfire = new Campfire(options);
        }

        self.campfire.rooms(this);
      },
      
      function find_room(err, rooms) {
        if (err) throw err;

        // .some() to emulate for loop with break
        var found_room = null;
        rooms.some(function(room) {
          if (room.id == room_name ||
              room.name.trim().toLowerCase() == room_name.toLowerCase()) {
            found_room = room;
            return true;
          }
          return false;
        });

        if (found_room) {
          self.campfire_room = found_room;
          self.campfire_room.join(this);
        } else {
          throw 302;
        }
      },

      function join_room(err, room) {
        self.connecting = false;
        
        if (err == 302) {
          self.send_stanza(
            null, build_xmpp_error(
              stanza, 'cancel', 'item-not-found', 'Room not found'));
          self.log('not found');
          return;
        } else if (err == 401) {
          self.send_stanza(
            null, build_xmpp_error(
              stanza, 'auth', 'not-authorized', 'Auth failed'));
          self.log('not authorized');
          return;
        } else if (err) {
          throw err;
        }

        self.present = true;

        self.refresh_room(this);
        // TODO parallelize next steps?
      },

      function finish_join(err) {
        if (err) throw err;

        // Send user self presence
        self.send_stanza(
          self.campfire_user.name, build_xmpp_presence(
            {status_codes: [110, 170, 210]}));
        
        self.campfire_room.messages(this);
      },

      function send_room_state(err, messages) {
        if (err) {
          self.log('messages', err);
        };
        
        if (messages) {
          // Filter types for history
          messages = messages.filter(function(msg) {
            return ['TextMessage', 'PasteMessage', 'TweetMessage',
                    'SystemMessage', 'TopicChangeMessage'
                   ].indexOf(msg.type) > -1;
          });

          // Obey (some) client history limits
          try {
            var history = stanza.getChild('x', MUC_NS).getChild('history');
          } catch (e) {}
          if (history && history.attrs.maxstanzas) {
            messages.splice(0, messages.length - history.attrs.maxstanzas);
          }
        
          // Send messages through normal handler
          messages.forEach(function(msg) {
            self.handle_campfire_message(msg, true);
          });
        }
        
        if (self.campfire_room.topic) {
          self.send_stanza(
            null, build_xmpp_message(
              self.campfire_room.topic, 'subject'));
        }

        self.campfire_start_listen();
      },

      function errors(err) {
        self.send_stanza(
          null, build_xmpp_error(
            stanza, 'wait', 'internal-server-error', err));
        self.log('join_error', err);
      }
    );
  },

  handle_exit: function(stanza, status_code) {
    this.campfire_stop_listen();
    
    if (this.present) {
      var self = this;
      this.campfire_room.leave(function() {
        self.send_stanza(
          self.campfire_user.name, build_xmpp_presence(
            {type: 'unavailable', status_codes: [status_code || 110]}));
      });
    }
    
    this.present = false;
  },

  handle_xmpp_message: function(stanza) {
    var body = stanza.getChildText('body');
    if (body) {
      var self = this;
      this.campfire_room.message(body, undefined, function(err) {
        if (err) {
          self.send_stanza(
            null, build_xmpp_error(
              stanza, 'wait', 'internal-server-error', err));
        }
      });
    }
    // TODO handle other messages (subject change)
  },

  handle_xmpp_presence: function(stanza) {
    if (this._probe_timer) {
      clearTimeout(this._probe_timer);
      this._probe_timer = undefined;
    }

    if (this.presence) {
      if (!stanza) {
        this.send_stanza(
          null, new xmpp.Element('presence', {type: 'probe'}));
      }
    
      this._probe_timer = setTimeout(this.handle_xmpp_presence.bind(this), 30000);
    }
  },
  
  handle_xmpp_vcard: function(stanza) {
    var name = stanza.attrs.to.split('/')[1];
    for (var user_id in this.campfire_users) {
      var user = this.campfire_users[user_id];
      if (user && user.name === name) {
        var vcard = new xmpp.Element('iq', {type: 'result', id: stanza.attrs.id})
            .c('vCard', {xmlns: 'vcard-temp'})
              .c('FN').t(name).up();

        if (user.email_address) {
          vcard.c('EMAIL').c('USERID').t(user.email_address);
        }

        if (user.avatar_url) {
          vcard.c('PHOTO').c('EXTVAL').t(user.avatar_url);
        }

        this.send_stanza(name, vcard);
        return;
      }
    }
    this.send_stanza(
      name, build_xmpp_error(
        stanza, 'cancel', 'item-not-found'));
  },
    
  refresh_room: function(callback) {
    var self = this;

    self.campfire.get(self.campfire_room.path, function(err, response) {
      if (!err) {
        try {
          // Build current roster
          var roster = response.room.users.map(function(user) {
            if (user.id != self.campfire_user.id) {
              self.send_stanza(
                user.name, build_xmpp_presence());
            }
            self.campfire_users[user.id] = user;
            return user.id;
          });

          // Send exit notifications
          self.campfire_roster.forEach(function(user_id) {
            if (roster.indexOf(user_id) < 0 && self.campfire_users[user_id]) {
              self.send_stanza(
                self.campfire_users[user_id].name, build_xmpp_presence(
                  {type: 'unavailable'}));
            }
          });

          self.campfire_roster = roster;
          
        } catch (e) {
          err = e;
        }
      }
      
      if (callback) {
        callback(err);
      } else if (err) {
        self.log('refresh_room:', err);
      }
    });
  },
    
  send_stanza: function(from_resource, stanza) {
    stanza = stanza.root();
    this._jid.setResource(from_resource);
    stanza.attrs.from = this._jid.toString();
    this.client.send_stanza(stanza);
    this.log('<<<', stanza.name);
  },
  
  campfire_start_listen: function() {
    this.campfire_stop_listen();

    if (this.present) {
      this._listen_req = this.campfire_room.listen(
        this.handle_campfire_message.bind(this));
    
      var self = this;
      this._listen_req.on('error', function(err) {
        self.log('listen', err);
        setTimeout(function() {
          self.campfire_start_listen();
        }, 1000);
      });
    }
  },

  campfire_stop_listen: function() {
    if (this._listen_req) {
      this._listen_req.abort();
    }
  },
  
  handle_campfire_message: function(msg, history) {
    var self = this;
    Step(
      function lookup_name() {
        if (msg.userId && self.campfire_users[msg.userId] === undefined) {
          self.campfire.user(msg.userId, this);
        } else {
          return null;
        }
      },
      
      function translate_message(err, response) {
        if (err == 404) {
          self.campfire_users[msg.userId] = null;
        } else if (err) {
          self.log('user', msg.userId, err);
        } else {
          // Cache user name if retrieved
          var _user = response && response.user;
          if (_user && _user.id) {
            self.campfire_users[_user.id] = _user;
          }
        }
        
        var user = self.campfire_users[msg.userId];
        
        var stanza = null;
        if (['TextMessage', 'PasteMessage', 'SystemMessage']
            .indexOf(msg.type) > -1) {
          stanza = build_xmpp_message(msg.body);
          
        } else if (msg.type === 'TweetMessage') {
          var body = msg.body;
          if (msg.tweet) {
            body = msg.tweet.message + ' -- @' + msg.tweet.author_username +
              ', ' + TWITTER_STATUS_PREFIX + msg.tweet.id;
          } else if (body.indexOf('---\n') === 0) {
            self.log('YAML tweet body without .tweet data');
          }
          stanza = build_xmpp_message(body);
        } else if (msg.type === 'TopicChangeMessage') {
          stanza = build_xmpp_message(msg.body, 'subject');
          
        } else if (msg.type === 'EnterMessage') {
          self.refresh_room();
          
        } else if (msg.type === 'LeaveMessage') {
          var i = self.campfire_roster.indexOf(msg.userId);
          if (i > -1 && user) {
            stanza = build_xmpp_presence({type: 'unavailable'});
          } else {
            self.refresh_room();
          }
          
        } else {
          self.log('unhandled campfire message', msg.type);
        }
        
        if (stanza) {
          if (history) {
            stanza.root()
              .c('delay', {xmlns: 'urn:xmpp:delay',
                           stamp: msg.createdAt.toISOString()});
          }

          self.send_stanza(
            user && user.name || 'User ' + msg.userId, stanza);
        }
      },

      function errors(err) {
        self.log('campfire_message error', err);
      }
    );
  },  

  log: function() {
    Array.prototype.unshift.call(arguments, '-', this.jid.toString());
    this.client.log.apply(this.client, arguments);
  }
};

exports.XmppCampfireRoom = XmppCampfireRoom;

// XMPP Helpers

function build_xmpp_presence(options) {
  options = options || {};
  options.role = options.role || (
    options.type === 'unavailable' ? 'none' : 'participant');
  
  var stanza = new xmpp.Element('presence', {type: options.type})
        .c('x', {xmlns: MUC_USER_NS})
          .c('item', {role: options.role, affiliation: 'member'}).up();
  
  (options.status_codes || []).forEach(function(status_code) {
    stanza.c('status', {code: status_code});
  });
  
  return stanza;
}

function build_xmpp_message(body, body_type) {
  body_type = body_type || 'body';
  return new xmpp.Element('message', {type: 'groupchat'})
    .c(body_type)
      .t(body);
}

function build_xmpp_error(stanza, error_type, error, text) {
  if (typeof(stanza) === 'string') {
    stanza = {name: stanza, attrs: {}};
  }
  return new xmpp.Element(stanza.name, {type: 'error', id: stanza.attrs.id})
    .c('x', {xmlns: MUC_NS}).up()
    .c('error', {type: error_type})
      .c(error, {xmlns: ERROR_NS}).up()
      .c('text', {xmlns: ERROR_NS})
        .t(text || '');
}
