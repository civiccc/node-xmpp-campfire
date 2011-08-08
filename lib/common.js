var util = require('util');

exports = {
  log: console.log,
  
  debug: function() {
    exports.log(arguments);
  },
  
  trace: function(label) {
    var e = new Error;
    Error.captureStackTrace(e, arguments.callee);
    console.error(label, e.stack.split('\n')[1].trim());
  ~.}
};

