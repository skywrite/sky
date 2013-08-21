'use strict'

var testutil = require('testutil')
  , shell = testutil.shell
  , P = require('autoresolve')
  , runSkySync = require(P('test/test-lib/testsky')).runSkySync
  , path = require('path')
  , fs = require('fs-extra')

var TEST_DIR = ''

describe('bin/', function() {
  beforeEach(function() {
    TEST_DIR = testutil.createTestDir('sky')
    shell.cd(TEST_DIR)
  })

  describe('sky-build-pages', function() {
    it('should build the site and pages', function() {
      var res = runSkySync('new', '-r', 'personal-blog', 'myblog')
      EQ (res.code, 0)

      TEST_DIR = path.join(TEST_DIR, 'myblog')
      shell.cd(TEST_DIR)

      var content1H = [
        "<--",
        "author: JP Richardson",
        "publish: 2013-08-20",
        "title: About",
        "-->"
      ].join("\n")

      var content2H = [
        "<--",
        "author: JP Richardson",
        "publish: 2013-08-20",
        "title: Tesla",
        "-->"
      ].join("\n")

      //create some pages
      var content1 = "Hi, I am JP and I write code...."
      var content2 = "This project is super **secret** and cool..."

      var md1 = path.join(TEST_DIR, 'pages', 'about.md')
      var md2 = path.join(TEST_DIR, 'pages', 'secret-project', 'tesla.md')
      fs.outputFileSync(md1, content1H + "\n\n" + content1)
      fs.outputFileSync(md2, content2H + "\n\n" + content2)

      res = runSkySync('build-pages')
      EQ (res.code, 0)

      var outputDir = path.join(TEST_DIR, 'public')

      var page1 = path.join(outputDir, 'pages', "about.html")
      var page2 = path.join(outputDir, 'pages', 'secret-project', 'tesla.html')

      T (shell.test('-f', page1))
      T (shell.test('-f', page2))

      T (fs.readFileSync(page1, 'utf8').indexOf(content1) > 0)
      T (fs.readFileSync(page2, 'utf8').indexOf("<strong>secret</strong>") > 0)
    })
  })
})