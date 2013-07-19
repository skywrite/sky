'use strict'

var tmpl = require('../lib/template_file')
  , path = require('path')
  , fs = require('fs-extra')
  , rss = require('../lib/rss')
  , sutil = require('./util')
  , di = require('./doc_info')

module.exports = function genIndex (opts, callback) {
  var _skyEnv = opts.skyEnv
    , genRSS = opts.genRSS 
    , outputArticles = opts.outputArticles
    , configs = _skyEnv.configs
    , absIndexFile = opts.outputFile || path.join(_skyEnv.outputDir, _skyEnv.articleIndex)
     
  var data = di.initViewData(_skyEnv)

  data.ctx.author = data.ctx.author || (configs.get('config:site.author'))
  data.ctx.title = data.ctx.title = _skyEnv.indexTitle
  data.ctx.outputArticles = outputArticles;

  //TODO: fix this odd dependency of _skyEnv.themePaths
  tmpl(_skyEnv.themePaths.articleIndex, data, function(err, html) {
    if (err) return callback(err)
    data.sky.view = html

    if (genRSS) {
      var xml = rss(configs, outputArticles)
      fs.outputFileSync(path.join(path.dirname(absIndexFile), 'rss.xml'), xml)
    }

    tmpl(_skyEnv.themePaths.layout, data, function(err, html) {
      if (err) return callback(err)

      fs.outputFileSync(absIndexFile, html)
      callback(null)
    })
  })
}