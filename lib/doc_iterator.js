
var EventEmitter = require('events').EventEmitter
  , mdwalker = require('markdown-walker')
  , batch = require('batchflow')
  , MarkdownPage = require('markdown-page').MarkdownPage //maybe eventually remove
  , brucedown = require('brucedown')


function DocIterator (opts) {
  this.path = opts.path
  this.lastModified = opts.lastModified
  this.batchLimit = opts.limit || 32
  this.documentCallback = function(){}
}

DocIterator.prototype.document = function(callback) {
  this.documentCallback = callback
  return this
}

DocIterator.prototype.end = function(endCallback) {
  var _this = this
    , stats = {}
    , mfiles = {}

  mdwalker(this.path, {lastModified: this.lastModified})
  .on('markdown', function(file, stat) {
    mfiles[file] = true //if lastBuild is 0, this needs to be here
    stats[file] = stat
  })
  .on('notModified', function(file) {
    mfiles[file] = false
  })
  .on('modified', function(file) {
    mfiles[file] = true
  })
  .on('end', function() {
    batch(stats).par(_this.batchLimit).each(function(file, fileStats, next) {
      MarkdownPage.readFile(file, function(err, mdp) {
        if (err) return _this.documentCallback(err, null)

        brucedown(mdp.markdown, function(err, html) {
          if (err) return _this.documentCallback(err, null)

          mdp.html = html

          var ret = {document: mdp, file: file, stat: fileStats, modified: mfiles[file]}
          _this.documentCallback(null, ret, next)
        })
      })
    })
    .end(function() {
      endCallback()
    })
  })
}

module.exports = function(opts) {
  return new DocIterator(opts)
}