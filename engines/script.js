'use strict';

const _ = require('lodash');

const Model = require('../classes/model');

class ScriptEngine extends Model {
  constructor({modelData, database, internalDatabase, Container}) {
    super(modelData, database, internalDatabase);

    this.dbName = database.name;
    this.parameters = database.parameters;

    this.scripts = {};

    const operations = ['list', 'create', 'read', 'update', 'remove', 'count'];
    operations.forEach(operation => {
      if (modelData.jsonSchema[operation] instanceof Array) {
        const operationName = operation === 'remove' ? 'delete' : operation;
        this.scripts[operation] = Container.get('Script', {
          definition: {
            name: `${operationName}${modelData.name}`,
            steps: modelData.jsonSchema[operation]
          }
        });
      }
    });
  }

  ready() {
    return true;
  }

  async read(data) {
    const script = await this.scripts.read;
    return script.clone().run(data).then(result => {
      return this.castTypes(result);
    });
  }

  async list(filters, options) {
    const script = await this.scripts.list;
    return script.clone().run(_.defaults(filters, options)).then(result => {
      return this.castTypes(result);
    });
  }

  async create(data) {
    const script = await this.scripts.create;
    return script.clone().run(data).then(result => {
      return this.castTypes(result);
    });
  }

  async update(data) {
    const script = await this.scripts.update;
    return script.clone().run(data).then(result => {
      return this.castTypes(result);
    });
  }

  async remove(data) {
    const script = await this.scripts.remove;
    return script.clone().run(data).then(result => {
      return this.castTypes(result);
    });
  }

  async count(data) {
    const script = await this.scripts.count;
    return script.clone().run(data);
  }

  castTypes(data) {
    if (data instanceof Array) {
      return data.map(this.castTypes.bind(this));
    }
    Object.keys(this.jsonSchema.properties).forEach(name => {
      if (typeof data[name] === 'undefined' || data[name] === null) {
        return;
      }
      const type = this.jsonSchema.properties[name].type;
      if (type === 'integer') {
        data[name] = parseInt(data[name], 10);
      }
      if (type === 'number' || type === 'float') {
        data[name] = parseFloat(data[name], 10);
      }
      if (type === 'boolean') {
        data[name] = Boolean(data[name]);
      }
      if (type === 'string') {
        data[name] = String(data[name]);
      }
    });
    return data;
  }
}

ScriptEngine.require = ['Container'];

module.exports = ScriptEngine;
