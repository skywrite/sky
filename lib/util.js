module.exports.template = template

function template (str, data) {
  var r = /\{\{(.+?)\}\}/g
  var matches = str.match(r)
  matches.forEach(function(match) {
    var key = match.substring(2, match.length - 2)//chop {{ and }}
    if (data[key]) 
      str = str.replace(match, data[key])
  })
  return str;
}