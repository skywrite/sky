
var pp = require('parentpath')
  , jsoncfg = require('jsoncfg')
  , path = require('path')
  , S = require('string') 

var CFG_FILE = 'sky/config.json'; //relative to the base dir

var _baseDir = null

var me = module.exports

me.findBaseDir = function (callback) {
  pp(CFG_FILE, callback)
}

me.findBaseDirSync = function () {
  return pp.sync(CFG_FILE)
}


me.loadConfigsSync = function (baseDir) {
  var dirs = ['./', './sky']
    , configs = {}
    , errors = {}

  dirs.forEach(function(dir) {
    var cfgs = jsoncfg.loadFilesSync(path.join(baseDir, dir))
    errors = extend(errors, cfgs.errors)
    configs = extend(configs, cfgs)
  })

  configs.errors = errors
  return configs
}

/*
 private methods */

function extend (obj1, obj2) {
  Object.keys(obj2).forEach(function(key) {
    obj1[key] = obj2[key]
  })
  return obj1
}

