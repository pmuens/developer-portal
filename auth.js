'use strict';
var async = require('async');
var aws = require('aws-sdk');
var identity = require('lib/identity');
var log = require('lib/log');
var moment = require('moment');
var mysql = require('mysql');
var vandium = require('vandium');
require('dotenv').config({silent: true});

/**
 * Confirm
 */
module.exports.confirm = vandium.createInstance({
  validation: {
    schema: {
      path: vandium.types.object().keys({
        email: vandium.types.string().required().error(Error("[422] Parameter email is required and should have " +
          "format of email address")),
        code: vandium.types.string().required().error(Error("[422] Parameter code is required"))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authConfirm', event);
  var provider = new aws.CognitoIdentityServiceProvider({region: process.env.REGION});
  async.waterfall([
    function (callbackLocal) {
      provider.confirmSignUp({
        ClientId: process.env.COGNITO_CLIENT_ID,
        ConfirmationCode: event.path.code,
        Username: event.path.email
      }, function(err) {
        return callbackLocal(err);
      });
    },
    function(callbackLocal) {
      provider.adminDisableUser({
        UserPoolId: process.env.COGNITO_POOL_ID,
        Username: event.path.email
      }, function(err) {
        return callbackLocal(err);
      });
    }
  ], function (err) {
    if (err) return callback(err);

    var ses = new aws.SES({apiVersion: '2010-12-01', region: process.env.REGION});
    ses.sendEmail({
      Source: process.env.SES_EMAIL,
      Destination: { ToAddresses: [process.env.SES_EMAIL] },
      Message: {
        Subject: {
          Data: '[dev-portal] User ' + event.path.email + ' requests approval'
        },
        Body: {
          Text: {
            Data: 'User ' + event.path.email + ' just signed up'
          }
        }
      }
    }, function(err) {
      return callback(err);
    });
  });
});


/**
 * Confirm Resend
 */
module.exports.confirmResend = vandium.createInstance({
  validation: {
    schema: {
      body: vandium.types.object().keys({
        email: vandium.types.string().required().error(Error("[422] Parameter email is required and should have format " +
          "of email address")),
        password: vandium.types.string().required().error(Error("[422] Parameter password is required"))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authConfirmResend', event);
  var provider = new aws.CognitoIdentityServiceProvider({region: process.env.REGION});
  provider.adminInitiateAuth({
    AuthFlow: 'ADMIN_NO_SRP_AUTH',
    ClientId: process.env.COGNITO_CLIENT_ID,
    UserPoolId: process.env.COGNITO_POOL_ID,
    AuthParameters: {
      USERNAME: event.body.email,
      PASSWORD: event.body.password
    }
  }, function(err) {
    if (!err || err.code === 'NotAuthorizedException') {
      return callback(Error('[400] Already confirmed'));
    } else {
      if (err.code === 'UserNotConfirmedException') {
        provider.resendConfirmationCode({
          ClientId: process.env.COGNITO_CLIENT_ID,
          Username: event.body.email
        }, function(err) {
          return callback(err);
        });
      } else {
        return callback(err);
      }
    }
  });
});


/**
 * Forgot
 */
module.exports.forgot = vandium.createInstance({
  validation: {
    schema: {
      path: vandium.types.object().keys({
        email: vandium.types.string().required().error(Error("[422] Parameter email is required and should have format " +
          "of email address"))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authForgot', event);
  var provider = new aws.CognitoIdentityServiceProvider({region: process.env.REGION});
  provider.forgotPassword({
    ClientId: process.env.COGNITO_CLIENT_ID,
    Username: event.path.email
  }, function(err) {
    return callback(err);
  });
});


/**
 * Forgot Confirm
 */
module.exports.forgotConfirm = vandium.createInstance({
  validation: {
    schema: {
      path: vandium.types.object().keys({
        email: vandium.types.string().required().error(Error('[422] Parameter email is required and should have format ' +
          'of email address')),
      }),
      body: vandium.types.object().keys({
        password: vandium.types.string().required().min(8)
          .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/)
          .error(Error('[422] Parameter newPassword is required, must have at least 8 characters and contain at least one '
            + 'lowercase letter, one uppercase letter and one number')),
        code: vandium.types.string().required().error(Error('[422] Parameter code is required'))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authForgotConfirm', event);
  var provider = new aws.CognitoIdentityServiceProvider({region: process.env.REGION});
  provider.confirmForgotPassword({
    ClientId: process.env.COGNITO_CLIENT_ID,
    ConfirmationCode: event.body.code,
    Password: event.body.password,
    Username: event.path.email
  }, function(err) {
    return callback(err);
  });
});


/**
 * Login
 */
module.exports.login = vandium.createInstance({
  validation: {
    schema: {
      body: vandium.types.object().keys({
        email: vandium.types.email().required().error(Error("[422] Parameter email is required and should have format " +
          "of email address")),
        password: vandium.types.string().required().error(Error("[422] Parameter password is required"))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authLogin', event);
  var provider = new aws.CognitoIdentityServiceProvider({region: process.env.REGION});
  provider.adminInitiateAuth({
    AuthFlow: 'ADMIN_NO_SRP_AUTH',
    ClientId: process.env.COGNITO_CLIENT_ID,
    UserPoolId: process.env.COGNITO_POOL_ID,
    AuthParameters: {
      USERNAME: event.body.email,
      PASSWORD: event.body.password
    }
  }, function(err, data) {
    if (err) {
      err.message = '[401] ' + err.message;
      return callback(err);
    }

    return callback(null, {
      token: data.AuthenticationResult.AccessToken, //data.AuthenticationResult.IdToken,
      expires: moment().add(data.AuthenticationResult.ExpiresIn, 's').utc().format()
    });
  });
});


/**
 * Profile
 */
module.exports.profile = vandium.createInstance({
  validation: {
    schema: {
      headers: vandium.types.object().keys({
        Authorization: vandium.types.string().required().error(Error('[422] Authorization header is required'))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authProfile', event);
  identity.getUser(process.env.REGION, event.headers.Authorization, callback);
});


/**
 * Profile Change
 */
module.exports.profileChange = vandium.createInstance({
  validation: {
    schema: {
      headers: vandium.types.object().keys({
        Authorization: vandium.types.string().required().error(Error('[422] Authorization header is required'))
      }),
      body: vandium.types.object().keys({
        oldPassword: vandium.types.string().required().error(Error('[422] Parameter oldPassword is required')),
        newPassword: vandium.types.string().required().min(8)
          .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/)
          .error(Error('[422] Parameter newPassword is required, must have at least 8 characters and contain at least one '
            + 'lowercase letter, one uppercase letter and one number'))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authProfileChange', event);
  var provider = new aws.CognitoIdentityServiceProvider({region: process.env.REGION});
  provider.changePassword({
    PreviousPassword: event.body.oldPassword,
    ProposedPassword: event.body.newPassword,
    AccessToken: event.headers.Authorization
  }, function(err) {
    return callback(err);
  });
});


/**
 * Signup
 */
module.exports.signup = vandium.createInstance({
  validation: {
    schema: {
      body: vandium.types.object().keys({
        name: vandium.types.string().required().error(Error('[422] Parameter name is required')),
        email: vandium.types.email().required().error(Error('[422] Parameter email is required and should have format ' +
          'of email address')),
        password: vandium.types.string().required().min(8)
          .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/)
          .error(Error('[422] Parameter password is required, must have at least 8 characters and contain at least one '
            + 'lowercase letter, one uppercase letter and one number')),
        vendor: vandium.types.string().required().error(Error('[422] Parameter vendor is required'))
      })
    }
  }
}).handler(function(event, context, callback) {
  log.start('authSignup', event);
  var db = mysql.createConnection({
    host: process.env.RDS_HOST,
    user: process.env.RDS_USER,
    password: process.env.RDS_PASSWORD,
    database: process.env.RDS_DATABASE,
    ssl: 'Amazon RDS'
  });

  async.waterfall([
    function(callbackLocal) {
      db.query('SELECT * FROM `vendors` WHERE `id` = ?', [event.body.vendor], function(err, result) {
        if (err) return callbackLocal(err);

        if (result.length === 0) {
          return callbackLocal(Error('[400] Vendor ' + id + ' does not exist'));
        }

        return callbackLocal();
      });
    },
    function(callbackLocal) {
      var provider = new aws.CognitoIdentityServiceProvider({region: process.env.REGION});
      provider.signUp({
        ClientId: process.env.COGNITO_CLIENT_ID,
        Username: event.body.email,
        Password: event.body.password,
        UserAttributes: [
          {
            Name: 'email',
            Value: event.body.email
          },
          {
            Name: 'name',
            Value: event.body.name
          },
          {
            Name: 'profile',
            Value: event.body.vendor
          }
        ]
      }, function(err) {
        return callbackLocal(err);
      });
    }
  ], function(err) {
    db.destroy();
    return callback(err);
  });
});

module.exports.emailTrigger = function(event, context, callback) {
  switch(event.triggerSource) {
    case 'CustomMessage_SignUp':
      event.response.emailSubject = 'Welcome to Keboola Developer Portal';
      event.response.emailMessage = 'Thank you for signing up. Confirm your email using this link: ' +
        'https://m8pbt5jpi8.execute-api.us-east-1.amazonaws.com/dev/auth/confirm/' + event.userName + '/' +
        event.request.codeParameter;
      break;
    case 'CustomMessage_ForgotPassword':
      event.response.emailSubject = "Forgot Password to Keboola Developer Portal";
      event.response.emailMessage = "Your confirmation code is " + event.request.codeParameter;
      break;
    case 'CustomMessage_ResendCode':
      event.response.emailSubject = "Confirmation code for Keboola Developer Portal";
      event.response.emailMessage = 'Confirm your email using this link: ' +
        'https://m8pbt5jpi8.execute-api.us-east-1.amazonaws.com/dev/auth/confirm/' + event.userName + '/' +
        event.request.codeParameter;
      break;
  }
  callback(null, event);
};