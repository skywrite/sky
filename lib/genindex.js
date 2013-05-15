'use strict'

var tmpl = require('../lib/template_file')
  , path = require('path')
  , fs = require('fs-extra')
  , S = require('string')
  , _ = require('underscore')
  , rss = require('../lib/rss')
  , sutil = require('./util')

module.exports = function genIndex (opts, callback) {
  var _skyEnv = opts.skyEnv
    , genRSS = opts.genRSS 
    , outputArticles = opts.outputArticles
    , configs = _skyEnv.configs
    , absIndexFile = opts.outputFile || path.join(_skyEnv.getOutputDir(), _skyEnv.getArticleIndex)

  var templateDir = _skyEnv.getTemplateDir()
  var indexTemplateFile = path.join(templateDir, 'article', 'index.ejs.html')
  var layoutTemplateFile = path.join(templateDir, 'layout.ejs.html')
     
  var data = {S: S, _: _, sky: sutil.deepClone(configs.config), self: {}, skyenv: _skyEnv, cache: false}
  //set homepage
  data.sky.homepage = 'https://github.com/skywrite'

  data.self.author = data.self.author || (configs.get('config:blog.author'))

  data.self.title = data.self.title = _skyEnv.getIndexTitle()

  data.self.outputArticles = outputArticles;
  //console.dir(outputArticles)
  data.filename = indexTemplateFile
  tmpl(indexTemplateFile, data, function(err, html) {
    if (err) return callback(err)
    data.sky.view = html

    if (genRSS) {
      var xml = rss(configs, outputArticles)
      fs.outputFileSync(path.join(path.dirname(absIndexFile), 'rss.xml'), xml)
    }

    data.filename = layoutTemplateFile

    tmpl(layoutTemplateFile, data, function(err, html) {
      if (err) return callback(err)

      fs.outputFileSync(absIndexFile, html)
      callback(null)
    })
  })
}