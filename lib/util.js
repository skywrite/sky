var me = module.exports

me.deepClone = function(obj) {
  //pooo man's clone
  return JSON.parse(JSON.stringify(obj))
}

me.datefmt = function(date) {
  return date.getFullYear() + '-' + ('0' + (date.getMonth()+1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2)
}