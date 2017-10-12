'use strict';

const _ = require('lodash');
const Bluebird = require('bluebird');
const HttpError = require('http-errors');

const parser = require('./parser');

class Query {
  constructor(models, query, context, args, ScriptFactory) {
    this.scriptFactory = ScriptFactory;

    // Allow us to omit the second argument.
    if (typeof context !== 'undefined' && typeof args === 'undefined' && context.constructor.name === 'Object') {
      args = context;
      context = undefined;
    }

    this.models = models;

    // Check for the dry flag, which may be prepended in front of the query.
    this.dry = false;
    if (typeof query === 'string' && query.match(/^([\w]*dry)/, query)) {
      query = query.replace(/^([\w]*dry)/, '');
      this.dry = true;
    }

    this.query = query;
    this.context = context;
    try {
      this.parsed = typeof query === 'string' ? parser(query, args) : query;
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  }

  getOperation(method) {
    const parts = method.name.match(/^([a-z]+)?([A-Z][\w]*)$/);
    if (!parts) {
      return 'read';
    }
    let operation = parts[1] ? parts[1] : 'read';
    operation = operation === 'delete' ? 'remove' : operation;
    return operation;
  }

  async getModel(method) {
    const parts = method.name.match(/^([a-z]+)?([A-Z][\w]*)$/);
    if (parts) {
      const model = this.models.get(parts[2]);
      return model;
    }
    throw new Error('Model "' + method.name + '" does not exists');
  }

  callMethod(method) {
    const parts = method.name.match(/^([a-z]+)?([A-Z][\w]*)$/);
    if (parts) {
      const operation = this.getOperation(method);

      // Allow us to get the logged in user by requesting readUser without params.
      // @todo: Move to some query preprocessing function.
      if (operation === 'read' && parts[2] === 'User' && Object.keys(method.params).length === 0) {
        const user = typeof this.context === 'undefined' ? {} : this.context.getUser();
        if (user.id) {
          method.params.id = user.id;
        } else {
          return {model: null, data: null};
        }
      }

      // @todo: The model is already loaded in executeMethod(). Re-use that one.
      return Promise.resolve(this.models.has(parts[2])).then(exists => {
        if (exists) {
          let model;
          return Promise.resolve(this.models.get(parts[2])).then(_model => {
            model = _model;

            if (this.context) {
              // Check entity-level access. Read, update and delete operations
              // are checked on id. Other parameters are not passed.
              // All params are passed for list and create operations.
              const id = typeof method.params.id === 'undefined' ? null : method.params.id;
              let data = {id};
              if (operation === 'list' || operation === 'create') {
                data = _.cloneDeep(method.params);
              }
              return this.context.access(this.models, model, operation, data, null);
            }
            // Context-free queries do not involve access checks.
            return true;
          }).then(access => {
            if (!access) {
              throw new HttpError(403, `Permission denied on "${method.name}"`);
            }

            const functionName = 'execute' + _.capitalize(operation);
            // We call the 'executeOperation' function, but also check for
            // existence of the 'operation' function, which indicates if the
            // models engine supports this operation.
            if (typeof model[operation] === 'function' && typeof model[functionName] === 'function') {
              // Always add the "id" field. It is required for references and field access checks.
              method.fieldNames = _.union(method.fieldNames, ['id']);
              return model[functionName](method.params, method.fieldNames, this.dry);
            }
            throw new HttpError(400, `Operation "${operation}" is not supported by model`);
          }).then(data => {
            return {model, data};
          });
        }
      });
    }
  }

  extractFields(model, item, fields, fieldNames, reread) {
    const output = {};
    const promises = [];
    const missing = [];

    if (item === null) {
      return null;
    }

    Object.keys(fields).forEach(alias => {
      const field = fields[alias];

      // Add __typename field.
      // @see http://graphql.org/learn/queries/#meta-fields
      if (field.name === '__typename') {
        output[alias] = model.name;
        return;
      }

      let references;
      if (typeof model.jsonSchema.properties[field.name] !== 'undefined') {
        references = model.jsonSchema.properties[field.name].references;
      }

      let expand = typeof references !== 'undefined' && Object.keys(field.fields).length;
      if (item[field.name] === null) {
        // Do not expand empty references.
        expand = false;
      }

      if (typeof item[field.name] !== 'undefined' && !expand) {
        output[alias] = item[field.name];
      }

      if (typeof item[field.name] !== 'undefined' && expand) {
        const submethod = _.clone(field);
        submethod.name = references;
        submethod.params = {id: item[field.name]};
        const promise = this.executeMethod(submethod).then(fieldResult => {
          output[alias] = fieldResult;
        });
        promises.push(promise);
      }

      if (this.models.hasPluginField(model, field)) {
        const promise = this.models.getPluginFieldValue(model, field, item.id, this.context).then(value => {
          output[alias] = value;
        });
        promises.push(promise);
      }
    });
    return Promise.all(promises).then(() => {
      Object.keys(fields).forEach(alias => {
        if (typeof output[alias] === 'undefined') {
          missing.push(fields[alias].name);
        }
      });
      if (missing.length > 0 && typeof item.id !== 'undefined' && reread) {
        return model.executeRead(_.pick(item, 'id'), missing).then(data => {
          data = _.merge(data, item);
          return this.extractFields(model, data, fields, fieldNames, false);
        });
      }
      if (missing.length > 0) {
        const errors = missing.map(key => {
          return `Unknown field "${key}"`;
        });
        throw new HttpError(400, 'Unknown fields in query', {errors});
      }
      return output;
    });
  }

  checkFieldPermissions(model, id, fieldNames, operation) {
    if (!this.context) {
      return true;
    }
    const errors = [];
    return Bluebird.reduce(fieldNames, (access, field) => {
      return Bluebird.resolve(this.context.access(this.models, model, operation, {id}, field)).then(fieldAccess => {
        if (!fieldAccess) {
          errors.push(`Permission denied on field ${field}`);
        }
        return fieldAccess ? access : false;
      });
    }).then(access => {
      if (!access) {
        throw new HttpError(403, 'Permission denied', {errors});
      }
    });
  }

  executeScript(method) {
    const params = _.defaults(method.params, {
      name: null,
      data: {},
      steps: [],
      debug: false
    });
    let script;
    if (params.name) {
      script = this.models.getScript(params.name);
    } else {
      script = this.scriptFactory.create({
        name: 'Query',
        steps: params.steps
      });
    }
    return Promise.resolve(script).then(script => {
      if (params.debug) {
        script = script.clone().setDebug(true);
      }
      return script.run(params.data);
    });
  }

  executeMethod(method) {
    if (method.name === 'script' && typeof this.context === 'undefined') {
      // @todo: Allow plugins to add fields and move to plugin.
      return this.executeScript(method);
    }

    let model;
    let result;
    return this.getModel(method).then(_model => {
      model = _model;
      return this.preprocess(method, model);
    }).then(_method => {
      method = _method;
      return this.callMethod(method);
    }).then(_result => {
      result = _result;
      return this.postprocess(method, model, result.data);
    }).then(_data => {
      result.data = _data;
      const isArray = result.data instanceof Array;
      const data = isArray ? result.data : [result.data];
      return Bluebird.resolve(data).each(item => {
        if (item === null) {
          // Skip permission checks on empty items.
          return;
        }
        let operation;
        const parts = method.name.match(/^([a-z]+)?([A-Z][\w]*)$/);
        if (parts) {
          operation = parts[1] ? parts[1] : 'read';
        }
        return this.checkFieldPermissions(result.model, item.id, method.fieldNames, operation);
      }).map(item => {
        if (typeof item === 'object') {
          return this.extractFields(result.model, item, method.fields, method.fieldNames, true);
        }
        // Operations MAY return scalar values (i.e. 'count').
        return item;
      }).then(items => {
        return isArray ? items : items[0];
      });
    });
  }

  preprocess(method, model) {
    const preprocessors = this.models.getPreprocessors(model);
    const operation = this.getOperation(method);
    return Bluebird.resolve(preprocessors).each(plugin => {
      const result = plugin.preprocess(this.models, model, operation, method.params, this.context);
      return Bluebird.resolve(result).then(result => {
        method.params = result;
      });
    }).then(() => {
      return method;
    });
  }

  postprocess(method, model, data) {
    const postprocessors = this.models.getPostprocessors(model);
    const operation = this.getOperation(method);
    return Bluebird.resolve(postprocessors).each(plugin => {
      const result = plugin.postprocess(this.models, model, operation, data, this.context);
      return Bluebird.resolve(result).then(result => {
        data = result;
      });
    }).then(() => {
      return data;
    });
  }

  execute() {
    const output = {};
    return Bluebird.resolve(Object.keys(this.parsed)).each(alias => {
      return Bluebird.resolve(this.executeMethod(this.parsed[alias])).then(result => {
        output[alias] = result;
      });
    }).then(() => {
      return output;
    });
  }
}

module.exports = Query;
