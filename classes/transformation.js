'use strict';

const Crypto = require('crypto');

const _ = require('lodash');
const $ = require('cheerio');
const JsonPointer = require('jsonpointer');
const isMyJsonValid = require('is-my-json-valid');
const XmlConvJson = require('xml-conv-json');

class Transformation {
  constructor(template) {
    this._template = template;
  }

  transform(value) {
    if (value === null || typeof value === 'undefined') {
      return null;
    }
    let output = _.cloneDeep(value);
    const keys = Object.keys(this._template);
    for (let i = 0; i < keys.length; ++i) {
      const key = keys[i];
      if (typeof this[`_${key}`] !== 'function') {
        throw new Error(`Unknown function ${key}`);
      }
      output = this[`_${key}`](output, this._template[key]);
      if (output === null || typeof output === 'undefined') {
        // Bails when missing output in chain. For example when
        // executing get: '/unknown' followed by substring.
        return null;
      }
    }
    return output;
  }

  _get(value, options) {
    if (typeof options !== 'string') {
      throw new Error('Value of "get" function must be a string');
    }
    try {
      return JsonPointer.get(value, options);
    } catch (err) {
      // JsonPointer throws an exception when trying to get a property on null,
      // for example "/a/b" on {a: null}. This is inconsistent with the behavior
      // to return null for "/a/b" on {a: {}}. Catch the exception and return
      // null for all error cases.
      return null;
    }
  }

  _static(value, options) {
    return options;
  }

  _object(value, options) {
    if (typeof options !== 'object') {
      throw new Error('Value of "object" functions must be an object');
    }
    const output = {};
    Object.keys(options).forEach(key => {
      const template = typeof options[key] === 'string' ? {get: options[key]} : options[key];
      const transformer = new Transformation(template);
      output[key] = transformer.transform(value);
    });
    return output;
  }

  _map(value, options) {
    if (!(value instanceof Array)) {
      return null;
    }
    const output = [];
    value.forEach(item => {
      const template = typeof options === 'string' ? {get: options} : options;
      const transformer = new Transformation(template);
      output.push(transformer.transform(item));
    });
    return output;
  }

  _substring(value, options) {
    if (typeof value !== 'string') {
      throw new Error('Cannot execute substring on ' + (typeof value));
    }
    const start = typeof options.start === 'number' ? options.start : 0;
    const length = typeof options.length === 'number' ? options.length : Infinity;
    return value.substring(start, start + length);
  }

  _length(value) {
    if (typeof value !== 'string' && !(value instanceof Array)) {
      throw new Error('Can only get length of arrays and strings');
    }
    return value.length;
  }

  _hash(value, options) {
    if (typeof value !== 'string') {
      value = JSON.stringify(value);
    }
    options = _.defaults(options, {
      encoding: 'hex',
      algorithm: 'md5'
    });
    return Crypto.createHash(options.algorithm).update(value).digest(options.encoding);
  }

  _array(value, options) {
    if (!(options instanceof Array)) {
      throw new Error('Options for array transformation must be an array');
    }
    return options.map(item => {
      const transformer = new Transformation(typeof item === 'string' ? {get: item} : item);
      return transformer.transform(value);
    });
  }

  _union(value, options) {
    if (!(options instanceof Array)) {
      throw new Error('Options for union transformation must be an array');
    }
    return _.union.apply(_, this._array(value, options));
  }

  _join(value, options) {
    if (!(value instanceof Array)) {
      throw new Error('Value for join transformation must be an array');
    }
    const separator = options.separator ? options.separator : '';
    return value.join(separator);
  }

  _split(value, options) {
    if (!options.separator) {
      throw new Error('Missing separator for split transformation');
    }
    if (typeof value !== 'string') {
      return [];
    }
    return value.split(options.separator);
  }

  _filter(value) {
    if (!(value instanceof Array)) {
      throw new Error('Value for filter transformation must be an array');
    }
    return value.filter(item => item);
  }

  _slice(value, options) {
    if (!(value instanceof Array)) {
      throw new Error('Value for slice transformation must be an array');
    }
    options = _.defaults(options, {
      from: 0,
      to: Infinity
    });
    return value.slice(options.from, options.to);
  }

  _count(value) {
    if (typeof value !== 'string' && !(value instanceof Array)) {
      return 0;
    }
    return value.length;
  }

  _case(value, options) {
    if (typeof options !== 'object' || options === null) {
      throw new Error('Value of "case" functions must be an object');
    }
    const operand = String(value);
    if (typeof options[operand] !== 'undefined') {
      return options[operand];
    }
    if (typeof options.default !== 'undefined') {
      return options.default;
    }
    return null;
  }

  _htmlTag(value, options) {
    if (typeof options !== 'string') {
      throw new Error('Value of "htmlTag" functions must be a string');
    }
    if (typeof value === 'string') {
      const result = $(options, value);
      if (result.length > 0) {
        return $(result[0]).toString();
      }
    }
    return null;
  }

  _htmlTags(value, options) {
    if (typeof options !== 'string') {
      throw new Error('Value of "htmlTags" functions must be a string');
    }
    const output = [];
    if (typeof value === 'string') {
      const result = $(options, value);
      for (let i = 0; i < result.length; ++i) {
        output.push($(result[i]).toString());
      }
    }
    return output;
  }

  _htmlTagText(value, options) {
    if (typeof options !== 'string') {
      throw new Error('Value of "htmlTagText" functions must be a string');
    }
    if (typeof value === 'string') {
      const result = $(options, value);
      if (result.length > 0) {
        return $(result[0]).text();
      }
    }
    return null;
  }

  _htmlTagsText(value, options) {
    if (typeof options !== 'string') {
      throw new Error('Value of "htmlTagsText" functions must be a string');
    }
    const output = [];
    if (typeof value === 'string') {
      const result = $(options, value);
      for (let i = 0; i < result.length; ++i) {
        output.push($(result[i]).text());
      }
    }
    return output;
  }

  _htmlAttribute(value, options) {
    if (typeof options !== 'string') {
      throw new Error('Value of "htmlAttribute" functions must be a string');
    }
    if (typeof value === 'string') {
      const result = $(value).attr(options);
      return typeof result === 'undefined' ? null : result;
    }
    return null;
  }

  _htmlTable(value, options) {
    if (typeof options !== 'object' || typeof options.cell !== 'number' || typeof options.text !== 'string') {
      throw new Error('Value of "htmlTable" functions must be an object with cell and text properties');
    }
    if (typeof value === 'string') {
      const selector = typeof options.selector === 'string' ? `${options.selector}>tr ${options.selector}>tbody>tr` : 'tr';
      const rows = $(selector, value);
      for (let i = 0; i < rows.length; ++i) {
        const cells = $('td', rows[i]);
        if (cells.length >= options.cell && $(cells[options.cell]).text().trim().toLowerCase() === options.text.trim().toLowerCase()) {
          if (typeof options.returnCell === 'number') {
            const cells = $('td', rows[i]);
            return cells.length >= options.returnCell ? $(cells[options.returnCell]).text() : null;
          }
          return $(rows[i]).toString();
        }
      }
    }
    return null;
  }

  _replace(value, options) {
    if (typeof options !== 'object' || typeof options.search !== 'string' || typeof options.replace !== 'string') {
      throw new Error('Value of "replace" functions must be an object with search and replace properties');
    }
    if (typeof value === 'string') {
      let search = options.search;
      const match = search.match(/^\/(.+)\/([img]*)$/);
      if (match) {
        search = new RegExp(match[1], match[2]);
      }
      return value.replace(search, options.replace);
    }
    return null;
  }

  _fromJson(value) {
    return JSON.parse(value);
  }

  _toJson(value) {
    return JSON.stringify(value);
  }

  _fromXml(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return JSON.parse(XmlConvJson.parseXML(value));
  }

  _now() {
    return ~~(new Date() / 1e3);
  }

  _lowerCase(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return _.lowerCase(value);
  }

  _upperCase(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return _.upperCase(value);
  }

  _camelCase(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return _.camelCase(value);
  }

  _kebabCase(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return _.kebabCase(value);
  }

  _snakeCase(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return _.snakeCase(value);
  }

  _nameCase(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return value.toLowerCase().split(/[\s]/).map(word => {
      return word.substring(0, 1).toUpperCase() + word.substring(1);
    }).join(' ');
  }

  _capitalize(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return _.capitalize(value);
  }

  _deburr(value) {
    if (typeof value !== 'string') {
      return null;
    }
    return _.deburr(value);
  }

  _assert(value, options) {
    const schema = {
      type: 'object',
      properties: options
    };
    if (!isMyJsonValid(schema)(value)) {
      throw new Error('Assertion did not pass: ' + JSON.stringify(value));
    }
    return value;
  }
}

module.exports = Transformation;
