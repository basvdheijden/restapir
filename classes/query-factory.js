'use strict';

const Query = require('./query');

class QueryFactory {
  constructor({Models}) {
    this.models = Models;
  }

  query(query, context, args) {
    return new Query(this.models, query, context, args).execute();
  }
}

QueryFactory.singleton = true;
QueryFactory.require = ['Config', 'Models'];

module.exports = QueryFactory;
