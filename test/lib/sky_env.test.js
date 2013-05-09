var testutil = require('testutil')
  , fs = require('fs-extra')
  , P = require('autoresolve')
  , SkyEnv  = require(P('lib/sky_env')).SkyEnv
  , libsky = require(P('lib/sky'))
  , path = require('path')

var TEST_DIR = null
  , CFG_FILE = null

function removePrivate(dir) {
  if (!dir) return null

  if (dir.indexOf('/private/tmp') === 0)  //MAC OS X symlinks /tmp to /private/tmp
    dir = dir.replace('/private', '');
  return dir
}

describe('SkyEnv', function() {
  beforeEach(function() {
    TEST_DIR = testutil.createTestDir('sky')
    CFG_FILE = path.join(TEST_DIR, 'sky', 'config.json')
    fs.outputFileSync(CFG_FILE, '')
  })

  describe('- getOutputDir()', function() {
    describe('> when outputDir is specified', function() {
      it('should return the absolute output dir', function() {
        process.chdir(TEST_DIR)
        fs.writeJsonSync(CFG_FILE, {build: {outputDir: 'superman/'}})
        
        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        EQ (removePrivate(se.getOutputDir()), path.join(TEST_DIR, 'superman'))
      })
    })

    describe('> when outputDir is not specified', function() {
      it('should return the absolute output dir', function() {
        process.chdir(TEST_DIR)
        fs.writeJsonSync(CFG_FILE, {})
        
        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        EQ (removePrivate(se.getOutputDir()), path.join(TEST_DIR, 'public'))
      })
    })
  })

  describe('- mdArticleToOutputFileWithPath(mdfile, [data])', function() {
    describe('> when no data is passed as an arg', function() {
      it('should return a file with slug based upon markdown file name', function() {
        var se = new SkyEnv('/tmp')
        se.configs = {get: function() { return ''}} //mock it up
        EQ (se.mdArticleToOutputFileWithPath('/tmp/articles/bitcoin-economics.md'), '/tmp/public/bitcoin-economics.html')
      })
    })

    describe('> when urlformat exists', function() {
      it('should return the proper name with the data slug', function() {
        process.chdir(TEST_DIR)
        var articlesDir = path.join(TEST_DIR, 'articles')
        fs.writeJsonSync(CFG_FILE, {articles: {urlformat: '{{slug}}'}})
        
        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        var data = {
          slug: 'burt-and-ernie'
        }
        EQ (se.mdArticleToOutputFileWithPath(path.join(articlesDir, 'bitcoin-economics.md'), data), path.join(se.getOutputDir(), data.slug))
      })
    })

    describe('> when urlformat does not exist', function() {
      it('should return the proper name with the data slug', function() {
        process.chdir(TEST_DIR)
        var articlesDir = path.join(TEST_DIR, 'articles')
        fs.writeJsonSync(CFG_FILE, {})
        
        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        var data = {
          slug: 'burt-and-ernie',
          'date-year': '2011',
          'date-month': '04'
        }

        var expected = "articles/2011/04/burt-and-ernie.html"
        EQ (se.mdArticleToOutputFileWithPath(path.join(articlesDir, 'bitcoin-economics.md'), data), path.join(se.getOutputDir(), expected))
      })
    })
  })

  describe('- getArticleIndex()', function() {
    describe('> when specified in config', function() {
      it('should return the proper index file', function() {
        process.chdir(TEST_DIR)
        fs.writeJsonSync(CFG_FILE, {articles: {index: 'superIndex'}})

        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        EQ (se.getArticleIndex(), 'superIndex')
      })
    })

    describe('> when not specified in config', function() {
      it('should return the proper index file', function() {
        process.chdir(TEST_DIR)
        fs.writeJsonSync(CFG_FILE, {})

        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        EQ (se.getArticleIndex(), 'index.html')
      })
    })
  })

  describe('- getTemplateName()', function() {
    describe('> when specified in config', function() {
      it('it should return the proper template', function() {
        process.chdir(TEST_DIR)
        fs.writeJsonSync(CFG_FILE, {blog: {template: 'shiny'}})
        
        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        EQ (se.getTemplateName(), 'shiny')
      })
    })

    describe('> when its not specified in config', function() {
      it('it should return the proper template', function() {
        process.chdir(TEST_DIR)
        fs.writeJsonSync(CFG_FILE, {})
        
        var se = new SkyEnv(libsky.findBaseDirSync())
        se.loadConfigsSync()
        EQ (se.getTemplateName(), 'basic')
      })
    })
  })

  describe('- getTemplateDir()', function() {
    it('should retrieve the template dir', function() {
      process.chdir(TEST_DIR)
        
      var se = new SkyEnv(libsky.findBaseDirSync())
      se.loadConfigsSync()
      EQ (removePrivate(se.getTemplateDir()), path.join(TEST_DIR, 'sky', 'templates', se.getTemplateName()))
    })
  })

  describe('- path()', function() {
    it('should join all the arguments with the base directory', function() {
      process.chdir(TEST_DIR)
      var baseDir = libsky.findBaseDirSync()
      var se = new SkyEnv(baseDir)
      var cfgFile = se.path('sky', 'config.json')
      EQ (cfgFile, path.join(baseDir, 'sky', 'config.json'))
    })
  })
})


