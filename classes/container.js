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

  async get(name, params) {
    if (typeof this.services[name] === 'undefined') {
      throw new Error('Unknown service ' + name);
    }
    const service = this.services[name];
    const Service = service.service;
    params = _.defaults(params, await this.getDependencies(service.require));
    let instance;
    try {
      if (service.singleton) {
        if (service.instance) {
          return service.instance;
        }
        service.instance = new Service(params);
        if (typeof service.instance.startup === 'function') {
          await service.instance.startup();
        }
        return service.instance;
      }
      instance = new Service(params);
      if (typeof instance.startup === 'function') {
        await instance.startup();
      }
    } catch (err) {
      console.error('Error initializing ' + name);
      console.error(err.stack);
      throw err;
    }
    return instance;
  }

  mock(name, instance) {
    this.services[name].instance = instance;
  }

  listServices() {
    return Object.keys(this.services);
  }
}

module.exports = Container;
