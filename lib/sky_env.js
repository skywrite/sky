
module.exports.SkyEnv = SkyEnv

var fs = require('fs-extra')
  , path = require('path')
  , jsoncfg = require('jsoncfg')
  , S = require('string') 
  , _ = require('underscore')

var CFG_FILE = 'sky/config.json'; //relative to the base dir


function SkyEnv (baseDir) {
  if (!baseDir) throw new Error("Must pass in baseDir into SkyEnv")

  this.baseDir = baseDir
  this.configFile = path.join(this.baseDir, CFG_FILE)
  this.configs = null
}

SkyEnv.prototype.loadConfigsSync = function() {
  var dirs = ['./', './sky']
    , configs = {}
    , errors = {}
    , _this = this

  dirs.forEach(function(dir) {
    var cfgs = jsoncfg.loadFilesSync(path.join(_this.baseDir, dir))
    errors = _.extend(errors, cfgs.errors)
    configs = _.extend(configs, cfgs)
  })

  configs.errors = errors
  this.configs = configs
  return this
}

SkyEnv.prototype.getArticleIndex = function() {
  return this.configs.get('config:articles.index') || 'index.html'
}

SkyEnv.prototype.getOutputDir = function() {
  if (this.configs.get('config:build.outputDir')) 
    return path.resolve(path.join(this.baseDir, this.configs.get('config:build.outputDir')))
  else
    return path.resolve(path.join(this.baseDir, 'public'))
}

SkyEnv.prototype.getTemplate = function() {
  return this.configs.get('config:blog.template') || 'basic'
}

SkyEnv.prototype.getTemplateDir = function() {
  return path.join(this.baseDir, 'sky', 'templates', this.getTemplate()) 
}

SkyEnv.prototype.mdArticleToOutputFile = function(mdfile, data) {
  var outputDir = this.getOutputDir()

  if (data) {
    var articleUrlFormat = this.configs.get('config:articles.urlformat') || "articles/{{date-year}}/{{date-month}}/{{slug}}.html"
    var relOut = S(articleUrlFormat).template(data).s
    return relOut
  } else {
    var base = path.basename(mdfile, '.md')
    return S(base).slugify() + '.html'
  }
}

//this is a bit verbose
SkyEnv.prototype.mdArticleToOutputFileWithPath = function() {
  return path.join(this.getOutputDir(), this.mdArticleToOutputFile.apply(this, arguments))
}

SkyEnv.prototype.path = function(paths) {
  var paths = Array.prototype.slice.call(arguments, 0)
  paths.unshift(this.baseDir)

  return path.join.apply(path, paths)
}


