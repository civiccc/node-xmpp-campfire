# node-xmpp-campfire

XMPP gateway for Campfire (beta)

Requires an XMPP (Jabber) client and hosted account. Google accounts will work with many third-party clients like Pidgin or Adium (Google apps accounts require DNS SRV records to be set for the apps domain - see below).


## Running the gateway

- Make sure there is a DNS SRV record for your gateway host (see below)
- Clone repository:

        git clone https://github.com/causes/node-xmpp-campfire.git
        git submodule update --init
    
- Install dependencies:

        npm install node-stringprep node-xmpp step
      
- Start the server with the gateway's domain:

        node xmpp-campfire.js campfire.example.com


## Using the gateway

"Join Group Chat" (wording may vary by client):

- Room: &lt;Campfire account&gt;+&lt;Campfire room&gt; (e.g. "mycompany+myroom")
- Server: &lt;Gateway domain&gt;
- Password: &lt;Campfire username&gt;:&lt;Password&gt; OR &lt;Campfire API authentication token (recommended)&gt;


## DNS SRV records

node-xmpp-capfire requires xmpp-server [DNS SRV records](http://en.wikipedia.org/wiki/SRV_record) for both your XMPP host and the gateway host.

Examples:

    // Gateway record
    _xmpp-server._tcp.campfire.example.com. 7200 IN SRV 0 0 5269 server.example.com.
    
    // Google apps
    _xmpp-server._tcp.appsdomain.com. 7200 IN SRV 0 0 5269 talk.google.com.


## TODO

- XMPP s2s encryption
- Support for Gmail web client
- Better error/disconnect handling
