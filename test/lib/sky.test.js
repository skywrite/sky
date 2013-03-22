var testutil = require('testutil')
  , fs = require('fs-extra')
  , P = require('autoresolve')
  , libsky  = require(P('lib/sky'))
  , path = require('path')

var TEST_DIR = null
  , CFG_FILE = null

function removePrivate(dir) {
  if (!dir) return null

  if (dir.indexOf('/private/tmp') === 0)  //MAC OS X symlinks /tmp to /private/tmp
    dir = dir.replace('/private', '');
  return dir
}

describe('lib/sky', function() {
  beforeEach(function() {
    TEST_DIR = testutil.createTestDir('sky')
    CFG_FILE = path.join(TEST_DIR, 'sky', 'config.json')
    fs.outputFileSync(CFG_FILE, '')
  })

  describe('+ getOutputDir()', function() {
    describe('> when outputDir is specified', function() {
      it('should return the absolute output dir', function() {
        process.chdir(TEST_DIR)
        fs.writeJsonSync(CFG_FILE, {build: {outputDir: 'superman/'}})
        
        var cfgs = libsky.loadConfigsSync()
        EQ (removePrivate(libsky.getOutputDirSync(cfgs)), path.join(TEST_DIR, 'superman/'))
      })
    })
  })
})
