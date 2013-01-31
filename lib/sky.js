
var pp = require('parentpath')

function findBaseDir (callback) {
  pp('sky/config.json', callback)
}

module.exports.findBaseDir = findBaseDir