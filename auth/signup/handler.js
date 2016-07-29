var aws = require('aws-sdk');
var jwt = require('../../lib/jwt');
var response = require('../../lib/response');

var CognitoHelper = require('../../lib/cognito-helper/cognito-helper');
var cognito = new CognitoHelper({
  AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
  COGNITO_IDENTITY_POOL_ID: process.env.COGNITO_IDENTITY_POOL_ID,
  COGNITO_DEVELOPER_PROVIDER_NAME: process.env.COGNITO_DEVELOPER_PROVIDER_NAME,
  COGNITO_SEPARATOR: process.env.COGNITO_SEPARATOR || '----',
  COGNITO_DATASET_NAME: process.env.COGNITO_DATASET_NAME || 'profile',
  COGNITO_PASSWORD_RESET_URL: process.env.COGNITO_PASSWORD_RESET_URL || 'http://localhost:8100/app.html#/reset/{email}/{reset}',
  COGNITO_PASSWORD_RESET_BODY: process.env.COGNITO_PASSWORD_RESET_BODY || 'Dear {name}, please follow the link below to reset your password:',
  COGNITO_PASSWORD_RESET_SUBJECT: process.env.COGNITO_PASSWORD_RESET_SUBJECT || 'Password reset',
  COGNITO_PASSWORD_RESET_SOURCE: process.env.COGNITO_PASSWORD_RESET_SOURCE || 'Password reset <noreply@yourdomain.com>'
});

var db = require('../../lib/db');

var vandium = require('vandium');

vandium.validation({
  name: vandium.types.string().required(),
  email: vandium.types.email().required(),
  password: vandium.types.string().required().min(8),
  vendor: vandium.types.string().required()
});

module.exports.handler = vandium(function (event, context, callback) {
  var tokenCallback = function (err, data) {
    if (err) {
      dbCloseCallback(response.makeError(err), data);
    }
    else {
      delete event.password;
      var ses = new aws.SES({apiVersion: '2010-12-01', region: process.env.SERVERLESS_REGION});
      ses.sendEmail({
        Source: process.env.SES_EMAIL,
        Destination: { ToAddresses: [process.env.SES_EMAIL] },
        Message: {
          Subject: {
            Data: '[dev-portal] User ' + event.email + ' requests approval'
          },
          Body: {
            Text: {
              Data: JSON.stringify(event, null, 4)
            }
          }
        }
      }, function(err) {
        if(err) return dbCloseCallback(err);

        return dbCloseCallback();
      });
    }
  };

  var dbCloseCallback = function(err, result) {
    db.end();
    return callback(err, result);
  };

  db.getVendor(event.vendor, function (err) {
    if (err) return dbCloseCallback(err);

    cognito.signup(event.name, event.email, event.password, event.vendor, tokenCallback);
  });
});
