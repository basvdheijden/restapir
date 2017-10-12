'use strict';

const _ = require('lodash');
const HttpError = require('http-errors');

const FilesApi = require('./files-api.js');
const HttpCache = require('./http-cache.js');
const Authentication = require('./authentication.js');

class Application {
  constructor({Config, HttpServer, QueryFactory, Log, Models}) {
    const config = _.defaults(Config.get(), {
      port: 80,
      queryFactory: {},
      authentication: {},
      files: {
        enabled: true
      }
    });
    this.app = HttpServer;
    this.log = Log;

    this.queryFactory = QueryFactory;

    this.instances = {};
    this.instances.authentication = new Authentication(this.app, this.queryFactory, config.authentication);
    if (config.files.enabled) {
      this.instances.files = new FilesApi({HttpServer, QueryFactory, Models});
    }
    this.instances.httpCache = new HttpCache(this.app, this.queryFactory, config.httpCache);

    this.app.error(request => {
      if (request.error instanceof HttpError.HttpError) {
        request.status = request.error.status;
        let errors;
        if (request.error.expose) {
          if (request.error.errors instanceof Array) {
            errors = request.error.errors;
          } else {
            errors = [{message: request.error.message}];
          }
        } else {
          errors = ['An error occurred. Please try again later.'];
        }
        Object.keys(request.error.headers || {}).forEach(key => {
          request.setHeader(key, request.error.headers[key]);
        });
        return _.merge({errors}, request.error.body);
      }
      this.log.exception(request.error, `${request.method} ${request.path}: `);
    });
  }
}

Application.singleton = true;
Application.require = [
  'Config',
  'HttpServer',
  'QueryFactory',
  'Log',
  'GraphqlApi',
  'ScriptApi',
  'Models'
];

module.exports = Application;
