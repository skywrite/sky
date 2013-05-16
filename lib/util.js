var path = require('path')

var me = module.exports

me.chopext = function(file) { //great for files with multiple extensions like: index.ejs.html
  var ext = path.extname(file)
  file = path.basename(file, ext)

  while (ext) {
    ext = path.extname(file)
    file = path.basename(file, ext)
  }

  return file
}

me.deepClone = function(obj) {
  //pooo man's clone
  return JSON.parse(JSON.stringify(obj))
}

me.datefmt = function(date) {
  return date.getFullYear() + '-' + ('0' + (date.getMonth()+1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2)
}