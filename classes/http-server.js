'use strict';

const _ = require('lodash');
const BlueGate = require('bluegate');

class HttpServer {
  constructor({Config, Log}) {
    this.config = _.defaults(Config.get(), {
      port: 80
    });
    this.app = new BlueGate({log: false});
    this.log = Log;
  }

  async startup() {
    await this.app.listen(this.config.port);
  }

  prevalidation(path, callback) {
    this.app.prevalidation(path, callback);
  }

  postvalidation(path, callback) {
    this.app.postvalidation(path, callback);
  }

  process(path, callback) {
    this.app.process(path, callback);
  }

  error(path, callback) {
    this.app.error(path, callback);
  }

  authentication(path, callback) {
    this.app.authentication(path, callback);
  }

  authorisation(path, callback) {
    this.app.authorisation(path, callback);
  }

  async shutdown() {
    await this.app.close();
  }
}

HttpServer.singleton = true;
HttpServer.require = ['Config', 'Log'];

module.exports = HttpServer;
