'use strict';

const _ = require('lodash');

const Plugin = require('../classes/plugin');

class ProcessScriptsPlugin extends Plugin {
  /**
   * Loop though models to find cascading fields.
   */
  async startup() {
    this.data = {};
    this.postprocessors = [];
    this.preprocessors = [];
    Object.keys(this.models).forEach(modelName => {
      if (this.models[modelName].jsonSchema.preprocess instanceof Array) {
        this.preprocessors.push(modelName);
      }
      if (this.models[modelName].jsonSchema.postprocess instanceof Array) {
        this.postprocessors.push(modelName);
      }
    });
  }

  async process(model, operation, params, name, context) {
    const script = await this.scriptFactory.create({
      name: `${operation}${model.name}:${name}`,
      steps: this.models[model.name].jsonSchema[name]
    }, {context});
    const response = await script.run({
      operation,
      params
    });
    return response.params;
  }

  /**
   * List models that this plugin does Preprocessing for.
   */
  getPreprocessors() {
    return this.preprocessors;
  }

  /**
   * Execute preprocessing.
   */
  preprocess(models, model, operation, params, context) {
    return this.process(model, operation, params, 'preprocess', context);
  }

  /**
   * List models that this plugin does postprocessing for.
   */
  getPostprocessors() {
    return this.postprocessors;
  }

  /**
   * Execute postprocessing.
   */
  postprocess(models, model, operation, params, context) {
    return this.process(model, operation, params, 'postprocess', context);
  }
}

ProcessScriptsPlugin.require = ['ScriptFactory'];

module.exports = ProcessScriptsPlugin;
