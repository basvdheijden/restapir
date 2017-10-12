'use strict';

const _ = require('lodash');
const globby = require('globby');

class Container {
  constructor() {
    this.filePatterns = [
      'classes/**/*.js',
      'engines/**/*.js',
      'models/**/*.js',
      'plugins/**/*.js'
    ];
    this.services = {
      Container: {
        service: {},
        instance: this,
        singleton: true,
        require: []
      }
    };
  }

  async startup() {
    const include = require;
    const files = await globby(this.filePatterns);
    files.forEach(file => {
      const service = include(process.cwd() + '/' + file);
      const name = service.prototype.constructor.name;
      if (name) {
        this.services[name] = {
          service,
          instance: null,
          singleton: Boolean(service.singleton),
          require: service.require || []
        };
      }
    });
  }

  async shutdown() {
    const names = Object.keys(this.services);
    for (let i = 0; i < names.length; ++i) {
      const name = names[i];
      const instance = this.services[name].instance;
      if (instance && typeof instance.shutdown === 'function') {
        await instance.shutdown();
      }
    }
  }

  async getDependencies(require) {
    const dependencies = {};
    for (let i = 0; i < require.length; ++i) {
      const name = require[i];
      dependencies[name] = await this.get(name);
    }
    return dependencies;
  }

  async startupInstance(instance) {
    if (typeof instance.startup === 'function' && !instance._started) {
      await instance.startup();
    }
    instance._started = true;
  }

  async startupDependencies(services) {
    const names = Object.keys(services);
    for (let i = 0; i < names.length; ++i) {
      const name = names[i];
      await this.startupInstance(services[name]);
    }
  }

  async get(name, params) {
    if (name === 'Container') {
      return this;
    }
    if (typeof this.services[name] === 'undefined') {
      throw new Error('Unknown service ' + name);
    }
    const service = this.services[name];
    const Service = service.service;
    params = _.defaults(params, await this.getDependencies(service.require));
    if (service.singleton) {
      if (service.instance) {
        return service.instance;
      }
      service.instance = new Service(params);
      await this.startupInstance(service.instance);
      return service.instance;
    }
    const instance = new Service(params);
    await this.startupInstance(instance);
    return instance;
  }

  mock(name, service) {
    if (this.services[name].instance) {
      throw new Error('Unable to mock ' + name + ': already instantiated');
    }
    this.services[name].mocked = true;
    this.services[name].service = service;
  }

  listServices() {
    return Object.keys(this.services);
  }
}

module.exports = Container;
