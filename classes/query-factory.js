'use strict';

const Query = require('./query');

class QueryFactory {
  constructor({Models, ScriptFactory}) {
    this.models = Models;
    this.scriptFactory = ScriptFactory;
  }

  query(query, context, args) {
    return new Query(this.models, query, context, args, this.scriptFactory).execute();
  }
}

QueryFactory.singleton = true;
QueryFactory.require = ['Config', 'Models', 'ScriptFactory'];

module.exports = QueryFactory;
