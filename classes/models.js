'use strict';

const fs = require('fs');
const Path = require('path');

const Yaml = require('js-yaml');
const _ = require('lodash');
const globby = require('globby');

class Models {
  constructor({ModelsCompiler, Config, Container}) {
    this.compiler = ModelsCompiler;
    this.container = Container;
    const config = _.defaults(Config.get('/storage'), {
      cacheDir: '/tmp/cache',
      modelsDir: 'models',
      scriptsDir: 'scripts',
      databases: []
    });
    this.scriptsDir = config.scriptsDir;
    this.databases = config.databases;

    this.instances = {};
    this.plugins = {};
    this.scripts = {};
    this.pluginFields = {};
    this.preprocessors = {};
    this.postprocessors = {};
  }

  async startup() {
    await this.loadModels();
    await this.loadPlugins();
    await this.loadScripts();
  }

  async loadModels() {
    const models = await this.compiler.getModels();
    this.models = models;

    const modelNames = Object.keys(models);
    for (let i = 0; i < modelNames.length; ++i) {
      const name = modelNames[i];
      const databaseName = models[name].database;
      if (typeof this.databases[databaseName] === 'undefined') {
        throw new Error('Unknown database ' + databaseName + ' in model ' + name);
      }
      const database = this.databases[databaseName];
      const engine = database.engine + 'Engine';
      try {
        this.instances[name] = await this.container.get(engine, {
          modelData: models[name],
          database,
          internalDatabase: this.databases.internal
        });
      } catch (err) {
        console.error(err.stack);
      }
      this.preprocessors[name] = [];
      this.postprocessors[name] = [];
    }
  }

  async loadPlugins() {
    const pluginNames = this.container.listServices().filter(name => {
      return name.match(/.+Plugin$/);
    });

    for (let i = 0; i < pluginNames.length; ++i) {
      const name = pluginNames[i];
      const plugin = await this.container.get(name, {
        models: this.models
      });
      this.plugins[name] = plugin;

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
    }
  }

  async loadScripts() {
    const files = await globby([Path.resolve(__dirname, '../', this.scriptsDir) + '/**/*.yml']);
    for (let i = 0; i < files.length; ++i) {
      const file = files[i];
      const name = file.match(/\/([^/]+)\.yml$/)[1];
      const contents = fs.readFileSync(file);
      const definition = Yaml.safeLoad(contents);
      this.scripts[name] = await this.container.get('Script', {definition});
    }
  }

  has(name) {
    return typeof this.instances[name] !== 'undefined';
  }

  get(name) {
    if (typeof this.instances[name] === 'undefined') {
      throw new Error('Model "' + name + '" does not exists');
    }
    return this.instances[name];
  }

  getScript(name) {
    if (typeof this.scripts[name] === 'undefined') {
      throw new Error('Script "' + name + '" does not exists');
    }
    return this.scripts[name];
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

Models.singleton = true;
Models.require = ['ModelsCompiler', 'Config', 'Container'];

module.exports = Models;
