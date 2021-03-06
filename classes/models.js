'use strict';

const fs = require('fs');
const Path = require('path');

const Yaml = require('js-yaml');
const _ = require('lodash');
const globby = require('globby');

const Script = require('./script');

class Models {
  constructor(models, options, storage) {
    this.models = models;
    this.storage = storage;
    this.scriptsDir = options.scriptsDir;
    this.databases = options.databases;
    this.engines = {};
    this.instances = {};
    this.plugins = {};
    this.scripts = {};
    this.pluginFields = {};
    this.preprocessors = {};
    this.postprocessors = {};

    this.ready = new Promise(resolve => {
      globby([Path.join(__dirname, '../engines/**/*.js')]).then(files => {
        files.forEach(file => {
          const load = require;
          const engine = load(file);
          this.engines[engine.name] = engine;
        });
        Object.keys(models).forEach(name => {
          const databaseName = this.models[name].database;
          if (typeof this.databases[databaseName] === 'undefined') {
            throw new Error('Unknown database ' + databaseName + ' in model ' + name);
          }
          const database = this.databases[databaseName];
          const engine = database.engine;
          if (typeof this.engines[engine] === 'undefined') {
            throw new Error('Unknown engine ' + engine + ' in database ' + databaseName);
          }
          try {
            this.instances[name] = new this.engines[engine](this.models[name], database, this.databases.internal, this.storage);
          } catch (err) {
            console.log(err.stack);
          }
          this.preprocessors[name] = [];
          this.postprocessors[name] = [];
        });
        return globby([Path.join(__dirname, '../plugins/**/*.js')]);
      }).then(files => {
        files.forEach(file => {
          const name = file.match(/\/([^/]+)\.js$/)[1];
          const load = require;
          this.plugins[name] = new (load(file))(this.models, this.storage);
        });
        Object.keys(this.plugins).forEach(name => {
          const plugin = this.plugins[name];

          // Fields.
          const fields = {};
          const names = plugin.getFields();
          names.forEach(name => {
            fields[name] = {
              plugin
            };
          });
          this.pluginFields = _.merge(this.pluginFields, fields);

          // Preprocess functions.
          plugin.getPreprocessors().forEach(name => {
            this.preprocessors[name].push(plugin);
          });

          // Postprocess functions.
          plugin.getPostprocessors().forEach(name => {
            this.postprocessors[name].push(plugin);
          });
        });
        return globby([Path.resolve(__dirname, '../', this.scriptsDir) + '/**/*.yml']);
      }).then(files => {
        files.forEach(file => {
          const name = file.match(/\/([^/]+)\.yml$/)[1];
          const definition = Yaml.safeLoad(fs.readFileSync(file));
          this.scripts[name] = new Script(definition, this.storage);
        });
      }).then(() => {
        resolve();
      }).catch(error => {
        console.log(error);
      });
    });
  }

  has(name) {
    return this.ready.then(() => {
      return typeof this.instances[name] !== 'undefined';
    });
  }

  get(name) {
    return this.ready.then(() => {
      if (typeof this.instances[name] === 'undefined') {
        throw new Error('Model "' + name + '" does not exists');
      }
      return this.instances[name];
    });
  }

  getScript(name) {
    return this.ready.then(() => {
      if (typeof this.scripts[name] === 'undefined') {
        throw new Error('Script "' + name + '" does not exists');
      }
      return this.scripts[name];
    });
  }

  hasPluginField(model, field) {
    const name = model.name + '.' + field.name;
    return typeof this.pluginFields[name] !== 'undefined';
  }

  getPluginFieldValue(model, field, id, context) {
    const name = model.name + '.' + field.name;
    return this.pluginFields[name].plugin.getValue(this, model, field, id, context);
  }

  getPreprocessors(model) {
    return this.preprocessors[model.name];
  }

  getPostprocessors(model) {
    return this.postprocessors[model.name];
  }
}

module.exports = Models;
