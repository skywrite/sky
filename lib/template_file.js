var cons = require('consolidate')
  , S = require('string')
  , fs = require('fs')
  , path = require('path')
  , sutil = require('./util')
  , jade = require('jade')
  , ejs = require('ejs')

module.exports = function(file, data, callback) {
  if (typeof data == 'function') {
    callback = data
    data = {}
  }

  //i think ejs has this stupid requirement
  data.filename = file

  var ext = getExt(file)
  //console.log(ext.magenta)
  cons[ext](file, data, callback)
}

module.exports.findFromBase = function(dir, base, callback) {
  fs.readdir(dir, function(err, files) {
    if (err) 
      return callback(err)
    
    for (var i = 0; i < files.length; ++i) {
      var b = path.basename(files[i], path.extname(files[i]))
      if (b === base) 
        return callback(null, path.join(dir, files[i]))
    }

    callback(null, null)
  })
}

module.exports.findFromBaseSync = function(dir, base) {
  var files = fs.readdirSync(dir)
  //console.dir(files)
  
  for (var i = 0; i < files.length; ++i) {
    var b = sutil.chopext(files[i])
    if (b === base) 
      return path.join(dir, files[i])
  }

  return null
}

module.exports.renderTmplSync = function(file, data) {
  var ext = getExt(file)

  var text = fs.readFileSync(file, 'utf8')
  switch (ext) {
    case 'html': return text;
    case 'ejs': return ejs.render(text, data)
    case 'jade': return jade.compile(text, data)(data)
    default:
      throw new Error(ext + ' extension not supported.')
  }
}


function getExt (file) {
  var nfile = file
  if (S(file).endsWith('.html')) {
    if (count(file, '.') >= 2) {
      var nfile = S(file).chompRight('.html').s
    } else 
      return fs.readFile(file, 'utf8', callback)
  }

  var ext = S(path.extname(nfile)).replace('.', '').s
  return ext
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