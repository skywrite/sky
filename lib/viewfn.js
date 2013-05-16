'use strict'

var tmpl = require('./template_file')

//all sync methods accessible to the view

function viewfn (skyEnv, data) {
  this.skyEnv = skyEnv
  this.data = data
}

viewfn.prototype.partial = function(partialBaseName) {
  var partialsDir = this.skyEnv.path('sky', 'partials')
  var partialFile = tmpl.findFromBaseSync(partialsDir, partialBaseName)

  if (!partialFile) throw new Error("Can't find a partial that matches " + partialBaseName + " in " + partialsDir)

  return tmpl.renderTmplSync(partialFile, this.data)
}

module.exports = function(skyEnv, data) {
  return new viewfn(skyEnv, data)
}