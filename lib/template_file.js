var cons = require('consolidate')
  , S = require('string')
  , fs = require('fs')
  , path = require('path')

module.exports = function(file, data, callback) {
  if (typeof data == 'function') {
    callback = data
    data = {}
  }

  //console.log('in TMPL func'.magenta)

  var nfile = file
  if (S(file).endsWith('.html')) {
    if (count(file, '.') >= 2) {
      var nfile = S(file).chompRight('.html').s
    } else 
      return fs.readFile(file, 'utf8', callback)
  }

  var ext = S(path.extname(nfile)).replace('.', '').s
  //console.log(ext.magenta)
  cons[ext](file, data, callback)
}

function count (str, ss) {
  var pos = 0
    , count = 0
  while (pos >= 0) {
    pos = str.indexOf(ss, pos)
    if (pos >= 0) {
      count +=1
      pos += ss.length 
    }
  }

  return count
}