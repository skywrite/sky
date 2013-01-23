var util = require('util')

function exit (code, message) {
  code = code || 0

  if (message) { 
    if (arguments.length >= 3) {
      var args = Array.prototype.slice.call(arguments, 2)
      message = util.format(message, args)
    }
    console.error(message)
  }
  process.exit(code)
}

module.exports.exit = exit