'use strict';
var async = require('async');
var db = require('lib/db');
var identity = require('lib/identity');
var log = require('lib/log');
var vandium = require('vandium');
require('dotenv').config({silent: true});

module.exports.handler = vandium.createInstance({
  validation: {
    schema: {
      headers: vandium.types.object().keys({
        Authorization: vandium.types.string().required().error(Error('[422] Authorization header is required'))
      }),
      path: vandium.types.object().keys({
        appId: vandium.types.string().required(),
        version: vandium.types.number().integer()
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('appsDetail', event);
  db.connect({
    host: process.env.RDS_HOST,
    user: process.env.RDS_USER,
    password: process.env.RDS_PASSWORD,
    database: process.env.RDS_DATABASE,
    ssl: process.env.RDS_SSL
  });
  async.waterfall([
    function (callbackLocal) {
      identity.getUser(process.env.REGION, event.headers.Authorization, callbackLocal);
    },
    function (user, callbackLocal) {
      db.checkAppAccess(event.path.appId, user.vendor, function(err) {
        return callbackLocal(err);
      });
    },
    function (callbackLocal) {
      db.getApp(event.path.appId, event.path.version, callbackLocal);
    },
    function(app, callbackLocal) {
      app.icon = {
        32: process.env.ICONS_PUBLIC_FOLDER + '/' + app.icon32,
        64: process.env.ICONS_PUBLIC_FOLDER + '/' + app.icon64
      };
      delete app.icon32;
      delete app.icon64;
      callbackLocal(null, app);
    }
  ], function(err, result) {
    db.end();
    return callback(err, result);
  });
});
