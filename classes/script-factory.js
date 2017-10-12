'use strict';

class ScriptFactory {
  constructor({Container}) {
    this.container = Container;
  }

  create(definition, options) {
    return this.container.get('Script', {definition, options});
  }
}

ScriptFactory.singleton = true;
ScriptFactory.require = ['Container'];

module.exports = ScriptFactory;
