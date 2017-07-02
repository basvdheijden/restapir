'use strict';

const _ = require('lodash');
const HttpError = require('http-errors');

class ScriptApi {
  constructor({HttpServer, Container}) {
    HttpServer.authorisation('POST /script', admin => {
      if (!admin) {
        throw new HttpError(403, 'Unauthorized');
      }
    });

    HttpServer.process('POST /script', request => {
      const body = _.defaults(request.body, {
        input: {},
        options: {}
      });

      return Container.get('Script', {
        definition: body.definition,
        options: body.options
      }).then(script => {
        return script.run(body.input);
      }).then(data => {
        return {data};
      });
    });
  }
}

ScriptApi.require = ['HttpServer', 'Container'];

module.exports = ScriptApi;
