/* eslint-env node, mocha */
'use strict';

const Crypto = require('crypto');

const _ = require('lodash');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const Bluebird = require('bluebird');

const Container = require('../classes/container');
const Script = require('../classes/script');

const GoogleSearchMockup = require('./mockups/google-search');
const WebsiteMockup = require('./mockups/website');

const expect = chai.expect;
chai.use(chaiAsPromised);

/**
 * @doc scripts
 * # Scripts
 *
 * Restapir supports an imperative-style scripting language based on JSON,
 * simply referenced as "scripts".
 * Scripts can be used for more complex and conditional operations that can be
 * used in various configurable parts, or run on their own using a schedule.
 *
 * The script must have a name and steps property.
 * Scripting is done by defining all steps in an array. Each step is one of the
 * following forms:
 *
 * * An object with a single property. That property name defines the method
 *   to be executed and its value contains the method arguments.
 * * A string that defines a label. This label can be used as a destination
 *   for jumps.
 *
 * For example, a script can be used to transform the following input:
 *
 * ```
 * {
 *   "body": {
 *     "items": [{
 *       "title": "Foo",
 *       "url": "http://foo/",
 *       "snippet": "..."
 *     }, {
 *       "title": "Bar",
 *       "url": "http://bar/",
 *       "snippet": "..."
 *     }]
 *   }
 * }
 * ```
 * Into the following output:
 * ```
 * [{
 *   "title": "Foo",
 *   "link": "http://foo/"
 * }, {
 *   "title": "Bar",
 *   "link": "http://bar/"
 * }]
 * ```
 * The script for this is:
 * ```
 * name: Search results
 * steps:
 *   - get: /body/items
 *   - map:
 *       - object:
 *           title: /title
 *           link: /url
 * ```
 *
 * The script has two top-level methods; 'get' and 'map'. The 'map' function
 * takes script steps as its arguments, while the 'get' method can only
 * consume strings. Every method declares their own argument format.
 * Note that every step takes the output of the preceding step as its input.
 * Scripts may have input as well, which is provided as input for the first
 * step. The output of the last (top-level) step is the script output.
 */
describe('Script', () => {
  let container;
  let app;
  let query;
  let googleSearch;
  let website;
  let createScript;

  const cx = Crypto.randomBytes(8).toString('base64');
  const key = Crypto.randomBytes(8).toString('base64');

  before(async () => {
    container = new Container();
    await container.startup();

    const configObject = {
      port: 10023,
      storage: {
        modelsDir: 'test/script/models',
        scriptsDir: 'test/script/scripts',
        databases: {
          internal: {
            engine: 'redis',
            host: 'localhost',
            port: 6379,
            prefix: ''
          },
          rethink: {
            engine: 'RethinkDB',
            host: 'localhost',
            port: 28015,
            name: 'test'
          },
          website: {
            engine: 'Script',
            parameters: {
              baseUri: 'http://localhost:8372'
            }
          }
        }
      }
    };

    const config = await container.get('Config');
    config.set(configObject);
    app = await container.get('Application');
    googleSearch = new GoogleSearchMockup(key, cx);
    website = new WebsiteMockup();
    await googleSearch.startup();
    await website.startup();
    const queryFactory = await container.get('QueryFactory');
    query = queryFactory.query.bind(queryFactory);

    createScript = async (definition, options, queryMock) => {
      let testContainer = container;
      if (queryMock) {
        testContainer = new Container();
        await testContainer.startup();
        const config = await testContainer.get('Config');
        config.set(_.defaults({port: 10024}, configObject));
        testContainer.mock('QueryFactory', class QueryFactory {
          async query(query, context, args) {
            return queryMock(query, context, args);
          }
        });
      }
      return await testContainer.get('Script', {definition, options});
    };
  });

  after(async () => {
    await container.shutdown();
    await googleSearch.shutdown();
    await website.shutdown();
  });

  /**
   * @doc
   * In its simplest form, the script has only a name and no steps.
   *
   * ```
   * name: Empty script
   * steps: []
   * ```
   */
  it('can run an empty script', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: []
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({});
    });
  });

  it('cannot create a script without name', async () => {
    try {
      const script = await createScript({
        steps: []
      });
      await script.run();
    } catch (err) {
      return;
    }
    throw new Error('Should have thrown an error');
  });

  it('cannot create a script without steps', async () => {
    try {
      const script = await createScript({
        name: 'Testscript'
      });
      await script.run({});
    } catch (err) {
      return;
    }
    throw new Error('Should have thrown an error');
  });

  /**
   * @doc
   * Each step can optionally contain a query, transformation, increment and
   * jump, which are executed in that order and explained below.
   *
   * ## Query
   *
   * Set the ``query`` property to execute a query. The output is written on
   * the ``result`` property.
   */
  it('can execute query', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        query: '{listItem{id}}'
      }]
    }, {}, query => {
      if (query === '{listItem{id}}') {
        return Promise.resolve({
          listItem: [{id: 1}, {id: 2}, {id: 3}]
        });
      }
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        result: {
          listItem: [{id: 1}, {id: 2}, {id: 3}]
        }
      });
    });
  });

  /**
   * @doc
   *
   * The output property can be overridden by setting the ``resultProperty``
   * parameter.
   */
  it('can override result property', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        query: {
          query: '{listItem{id}}',
          resultProperty: '/output'
        }
      }]
    }, {}, query => {
      if (query === '{listItem{id}}') {
        return Promise.resolve({
          listItem: [{id: 1}, {id: 2}, {id: 3}]
        });
      }
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        output: {
          listItem: [{id: 1}, {id: 2}, {id: 3}]
        }
      });
    });
  });

  it('can use root as result property', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        query: {
          query: '{listItem{id}}',
          resultProperty: ''
        }
      }]
    }, {}, query => {
      if (query === '{listItem{id}}') {
        return Promise.resolve({
          listItem: [{id: 1}, {id: 2}, {id: 3}]
        });
      }
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        listItem: [{id: 1}, {id: 2}, {id: 3}]
      });
    });
  });

  /**
   * @doc
   *
   * Query parameters can be specified with the ``arguments`` property. This
   * must be an object where the keys are parameter names and values are
   * transformations, or just json pointers to directly select a single value.
   */
  it('can execute parameterized query', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        query: {
          query: '{Item(id: $id){id title}}',
          arguments: {
            id: '/id'
          }
        }
      }]
    }, {}, (query, context, args) => {
      if (args.id === 2) {
        return Promise.resolve({
          Item: {id: 2, title: 'Foo'}
        });
      }
    });
    return script.run({id: 2}).then(output => {
      expect(output).to.deep.equal({
        id: 2,
        result: {
          Item: {id: 2, title: 'Foo'}
        }
      });
    });
  });

  /**
   * @doc
   *
   * Queries will run context-free by default. This means that no permissions
   * will be checked, and thus scripts can do things outside the scope that
   * the regular user would be able to do.
   * The `runInContext` option can be set to true to run the query in its
   * context.
   */
  it('will run queries context-free by default', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        query: {
          query: '{Item(id: $id){id title}}',
          arguments: {
            id: '/id'
          }
        }
      }]
    }, {}, (query, context, args) => {
      if (args.id === 2) {
        return Promise.resolve({
          Item: {
            id: 2,
            user: typeof context === 'undefined' ? 0 : context.getUser().id
          }
        });
      }
    });
    return script.run({id: 2}).then(output => {
      expect(output).to.deep.equal({
        id: 2,
        result: {
          Item: {id: 2, user: 0}
        }
      });
    });
  });

  it('can run queries in context', async () => {
    const context = {
      getUser: () => {
        return {id: 1};
      }
    };
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        query: {
          query: '{Item(id: $id){id title}}',
          runInContext: true,
          arguments: {
            id: '/id'
          }
        }
      }]
    }, {context}, (query, context, args) => {
      if (args.id === 2) {
        return Promise.resolve({
          Item: {
            id: 2,
            user: typeof context === 'undefined' ? 0 : context.getUser().id
          }
        });
      }
    });
    return script.run({id: 2}).then(output => {
      expect(output).to.deep.equal({
        id: 2,
        result: {
          Item: {id: 2, user: 1}
        }
      });
    });
  });

  /**
   * @doc
   * ## Requests
   *
   * The ``request`` property allows you to execute an HTTP GET request. its
   * value is either an json pointer to an uri or an uri directly. The response
   * is set in the result property (identical to queries). The response is
   * an object with the properties ``headers`` and ``body``. The body is parsed
   * when in JSON format, or a string otherwise.
   */
  it('can execute request', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        request: 'http://localhost:8372/list-pages'
      }]
    });
    return script.run({}).then(output => {
      expect(output).to.have.property('result');
      expect(output.result).to.have.property('headers');
      expect(output.result).to.have.property('body');
      expect(output.result.body).to.be.a('string');
      expect(output.result.headers).to.have.property('content-type');
    });
  });

  it('will parse JSON output on request', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        request: 'http://localhost:8372/feed.json'
      }]
    });
    return script.run({}).then(output => {
      expect(output.result.body instanceof Array).to.equal(true);
    });
  });

  it('will return XML output as object on request', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        request: 'http://localhost:8372/feed.xml'
      }]
    });
    return script.run({}).then(output => {
      expect(output.result.body).to.be.an('object');
    });
  });

  it('can use shorthand in url parametert', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        static: {url: 'http://localhost:8372/list-pages'}
      }, {
        request: {
          url: '/url'
        }
      }]
    });
    return script.run({}).then(output => {
      expect(output).to.have.property('result');
      expect(output.result).to.have.property('headers');
      expect(output.result).to.have.property('body');
      expect(output.result.body).to.be.a('string');
      expect(output.result.headers).to.have.property('content-type');
    });
  });

  it('will return cookies on request', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        request: 'http://localhost:8372/cookie/a'
      }]
    });
    return script.run({}).then(output => {
      expect(output.result.cookies).to.be.an('object');
    });
  });

  it('can provide cookies for request', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [
        {
          request: 'http://localhost:8372/cookie/a'
        }, {
          request: {
            url: 'http://localhost:8372/cookie/b',
            cookies: '/result/cookies'
          }
        }
      ]
    });
    return script.run({}).then(output => {
      expect(output.result.body).to.deep.equal({foundCookie: true});
    });
  });

  it('can post request body', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        request: {
          method: 'POST',
          url: 'http://localhost:8372/echo',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8'
          },
          body: 'Lorem ipsum'
        }
      }]
    });
    return script.run({}).then(output => {
      expect(output.result.headers['content-type'][0]).to.equal('text/plain; charset=utf-8');
      expect(output.result.body).to.equal('Lorem ipsum');
    });
  });

  /**
   * @doc
   * ## Transformations
   *
   * Transformations can be executed by using the ``transform`` property.
   * Transformations are executed after the query.
   */
  it('can execute transformation', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        object: {
          foo: [{static: 'bar'}]
        }
      }]
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        foo: 'bar'
      });
    });
  });

  it('can execute multiple steps', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        object: {
          foo: [{static: 'bar'}]
        }
      }, {
        object: {
          foo: [{get: '/foo'}],
          bar: [{static: 'baz'}]
        }
      }]
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        foo: 'bar',
        bar: 'baz'
      });
    });
  });

  /**
   * @doc
   * ## Jumps
   *
   * All steps are executed in sequence by default. Jump can be used to control
   * the flow and implement conditions.
   * The ``jump`` property can be used to specify which step should be executed
   * after this step. The value is an object with at least a ``to`` property.
   * This contains the label of the next step. The label is an optional name
   * that you can provide to a step. The example below shows an
   * unconditional jump.
   *
   * ```
   * name: Script with unconditional jump
   * steps:
   *   - label: start
   *     jump:
   *       to: last
   *   - query: ...
   *   - label: last
   * ```
   *
   * The second step will not get executed.
   */
  it('can do an unconditional jump', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [
        {
          jump: {to: 'last'}
        }, {
          object: {
            foo: [{static: 'bar'}]
          }
        },
        'last',
        {
          object: {
            foo: [{get: '/foo'}],
            bar: [{static: 'baz'}]
          }
        }
      ]
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        foo: null,
        bar: 'baz'
      });
    });
  });

  it('can provide label as string for unconditional jump', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [
        {
          jump: 'last'
        }, {
          object: {
            foo: [{static: 'bar'}]
          }
        },
        'last',
        {
          object: {
            foo: [{get: '/foo'}],
            bar: [{static: 'baz'}]
          }
        }
      ]
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        foo: null,
        bar: 'baz'
      });
    });
  });

  /**
   * @doc
   * Jumps can be conditional by defining an operator and operands. The operator
   * can be '==', '===', '!=', '!==', '<', '>', '<=', '>=' or 'in'. The 'in'
   * operator can be used for arrays and is true when the left operand is an
   * item in the second operand, where the left operand must be a scalar value
   * and the right operand an array. The left and right operands can be
   * specified as ``left`` and ``right``. The operand defaults to '=='. Left and
   * right operands both default to true. Thus not specifying any of these
   * properties causes the equation ``true == true``, which is the unconditional
   * jump as mentioned before. The operands are executed as a transformation
   * when objects are provided and used as a value directly when the value is
   * not an object.
   *
   * The example below shows a conditional jump.
   *
   * ```
   * name: Script with unconditional jump
   * steps:
   *   - transform:
   *       object:
   *         foo:
   *           static: 'bar'
   *   - jump:
   *       left:
   *         get: '/foo'
   *       right: 'baz'
   *       to: last
   *   - query: ...
   *   - label: last
   * ```
   *
   * The query will get executed in this example, because the equation
   * ``'bar' == 'baz'`` equals to false. The jump is ignored and the next step
   * is the thirth step with the query.
   */
  it('can do a conditional jump with the default operator', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [
        {
          jump: {
            to: 'last',
            left: false
          }
        }, {
          object: {
            foo: [{static: 'bar'}]
          }
        },
        'last',
        {
          object: {
            foo: [{get: '/foo'}],
            bar: [{static: 'baz'}]
          }
        }
      ]
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        foo: 'bar',
        bar: 'baz'
      });
    });
  });

  const operators = {
    '===': false,
    '==': false,
    '!=': true,
    '!==': true,
    '<': true,
    '>': false,
    '<=': true,
    '>=': false,
    unknown: false
  };
  Object.keys(operators).forEach(operator => {
    it('can do a conditional jump with the ' + operator + ' operator', async () => {
      const script = await createScript({
        name: 'Testscript',
        steps: [
          {
            jump: {
              to: 'last',
              left: 1,
              right: 2,
              operator
            }
          }, {
            object: {
              foo: [{static: 'bar'}]
            }
          },
          'last',
          {
            object: {
              foo: [{get: '/foo'}],
              bar: [{static: 'baz'}]
            }
          }
        ]
      });
      return script.run({}).then(output => {
        expect(output).to.deep.equal({
          foo: operators[operator] ? null : 'bar',
          bar: 'baz'
        });
      });
    });
  });

  it('can do a conditional jump with the "in" operator', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [
        {
          jump: {
            to: 'last',
            left: 2,
            right: [{get: '/array'}],
            operator: 'in'
          }
        }, {
          object: {
            foo: [{static: 'bar'}]
          }
        },
        'last',
        {
          object: {
            foo: [{get: '/foo'}],
            bar: [{static: 'baz'}]
          }
        }
      ]
    });
    return script.run({array: [1, 2, 3]}).then(output => {
      expect(output).to.deep.equal({
        foo: null,
        bar: 'baz'
      });
    });
  });

  /**
   * @doc
   * For-loops can be written using the ``increment`` property. The value is a
   * json pointer. It will increase its referenced value by 1, or set it to 0
   * if it isn't already set. This is executed before the jump condition is
   * evaluated.
   * We can use it to write a ``for (i = 0; i < n; ++i)`` loop:
   *
   * ```
   * name: For-loop
   * steps:
   *   - label: start
   *     increment: /i
   *     jump:
   *       left:
   *         get: /i
   *       operator: >=
   *       right:
   *         get: /n
   *       to: end
   *   - label: firstWorker
   *   - label: secondWorker
   *     jump:
   *       to: start
   *   - label: end
   * ```
   *
   * Note that we negated the jump conditon, which can now be read as "if i is
   * greater or equals n".
   */
  it('can initialize the i-counter', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        increment: '/i'
      }]
    });
    return script.run({}).then(output => {
      expect(output).to.deep.equal({
        i: 0
      });
    });
  });

  it('can increment the i-counter', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        increment: '/i'
      }]
    });
    return script.run({i: 0}).then(output => {
      expect(output).to.deep.equal({
        i: 1
      });
    });
  });

  it('can execute a for-loop', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [
        'start',
        {
          increment: '/i'
        },
        {
          jump: {
            left: '/i',
            operator: '>=',
            right: '/n',
            to: 'end'
          }
        },
        'worker...',
        {
          jump: {
            to: 'start'
          }
        },
        'end'
      ]
    });
    return script.run({n: 10}).then(output => {
      expect(output).to.deep.equal({
        i: 10,
        n: 10
      });
    });
  });

  /**
   * @doc
   * ### Endless loops
   *
   * A protection is build in to prevent endless loops. By default the script
   * bails after executing 1000 steps. You can override this number per script
   * in the ``maxSteps`` property, which value must be a positive integer.
   */
  it('will fail when executing more steps than maxSteps', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [
        'start',
        {
          jump: {
            to: 'start'
          }
        }
      ]
    });
    let failed = false;
    return script.run({n: 1e4}).catch(() => {
      failed = true;
    }).then(() => {
      if (!failed) {
        throw new Error('Script should fail');
      }
    });
  });

  it('will not fail when executing many steps (1k)', async () => {
    const script = await createScript({
      name: 'Testscript',
      maxSteps: (1e3 * 4) + 1,
      steps: [
        'start',
        {
          increment: '/i'
        },
        {
          jump: {
            left: [{get: '/i'}],
            operator: '>=',
            right: [{get: '/n'}],
            to: 'end'
          }
        },
        {
          jump: {
            to: 'start'
          }
        },
        'end'
      ]
    });
    return script.run({n: 1e3 / 2}).then(output => {
      expect(output).to.deep.equal({
        i: 1e3 / 2,
        n: 1e3 / 2
      });
    });
  });

  it('cannot run a script concurrently', async () => {
    const storage = {
      query() {
        return Bluebird.resolve({}).delay(100);
      }
    };
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        object: {}
      }]
    });
    // Let first instance run in background.
    script.run();
    await Bluebird.delay(50);
    let failed = false;
    try {
      script.run();
      failed = true;
    }
    catch (err) {
      // ...
    }
    if (!failed) {
      throw new Error('Script should fail');
    }
    await Bluebird.delay(60);
    // First script ended. Second was not started.
    // We should be able to start the script now.
    script.run();
  });

  /**
   * @doc
   * ## Scheduling
   *
   * Scripts can be scheduled for automatic execution by defining the
   * ``schedule`` property. Its value is in the crontab format, with seconds
   * included.
   * Write "* * * * * *" to execute a script every second or "0 /5 * * * *"
   * for execution every 5 minutes.
   * Execution will not start if the script is still running.
   *
   * The example below is an implementation of a task queue. The script will
   * consume the oldest task from the queue every second.
   *
   * ```
   * name: Queue worker
   * schedule: '* * * * * *'
   * steps:
   *   - query: |
   *       {
   *         item: listQueueItem(type: "addBadge", sort: "created", limit: 1) {
   *           id data
   *         }
   *       }
   *     transform:
   *       object:
   *         item: /result/item/0
   *     jump:
   *       left:
   *         get: '/item'
   *       operator: '==='
   *       right: null
   *       to: end
   *   - query: '{User(id: $id){ badges }}'
   *     arguments:
   *       id: '/item/data/userId'
   *     transform:
   *       object:
   *         item: '/item'
   *         badges:
   *           union:
   *             - /result/User/badges
   *             - array:
   *               - /item/data/badge
   *   - query: '{updateUser(id: $id, badges: $badges)}'
   *     arguments:
   *       id: /item/data/userId
   *       badges: /badges
   *   - query: '{deleteQueueItem(id: $id)}'
   *     arguments:
   *       id: /item/id
   *   - label: end
   * ```
   *
   * A new task can be created by running the query
   * ``{createQueueItem(type: "addBadge", data: $data)}``
   * where ``$data`` is ``{UserId: "123", "badge": "Winner"}``. It will add the
   * string "Winner" to the ``User.badges`` array.
   *
   * Note that this script will never run multiple instances concurrently,
   * since new instances are not started when the last is still running. There
   * is no risk of executing the job twice and thus no need to do any locking.
   *
   * This setup can process at most one job per second. We can change the design
   * a bit to allow processing more. Simple add a label "start" on the first
   * step and an unconditional jump to the first step just before the last step.
   * We can also use this trick to lower the number of invokes of this script.
   * This lowers the system resources used, but increases the latency before
   * new jobs are started.
   */
  it.skip('will automatically execute scheduled scripts', async () => {
    let userId;
    return query('{user: createUser(name: "John", mail: "john@example.com") { id }}').then(result => {
      userId = result.user.id;
      const data = {userId, badge: 'Winner'};
      return query('{createQueueItem(type: "addBadge", data: $data)}', {data});
    }).delay(1050).then(() => {
      return query('{User(id: $userId) { badges }}', {userId});
    }).then(result => {
      expect(result.User.badges).to.deep.equal(['Winner']);
    }).then(() => {
      return query('{deleteUser(id: $userId)}', {userId});
    });
  });

  /**
   * @doc
   * ## Run script on startup
   *
   * Add the property ``runOnStartup: true`` to run a script on startup. The
   * script will run 2 seconds after startup, to allow the application to boot.
   */
  it('can run script on startup', async () => {
    let ran = false;
    const script = await createScript({
      name: 'Testscript',
      runOnStartup: true,
      steps: [{
        query: '{}'
      }]
    }, {}, query => {
      ran = true;
      return Bluebird.resolve({});
    });
    // The script should start within 2s, without calling run().
    await Bluebird.delay(2100);
    expect(ran).to.equal(true);
  });

  /**
   * @doc
   * ## Run script from query
   *
   * It is possible to run scripts from a query, either by providing a name
   * (for scripts located in the scripts directory) or by providing the steps
   * inline.
   *
   * ```
   * {
   *   named: script(name: "Testscript", data: {})
   *   inline: script(steps: [{camelCase: {}}], data: "lorem ipsum")
   * }
   * ```
   *
   * The data property is optional and defaults to an empty object.
   *
   * Debug information can be enabled by providing `debug: true`. The output
   * format will change to an object with properties `output`, `definition`
   * and `children`.
   *
   * Running scripts from queries is currently only possible for context-free
   * queries.
   */
  it.skip('can execute named script from query', async () => {
    return query(`{
      script(name: "Uppercase", data: "test")
    }`).then(result => {
      expect(result).to.have.property('script');
      expect(result.script).to.equal('TEST');
    });
  });

  it.skip('can execute script provided in query', async () => {
    return query(`{
      script(steps: [{camelCase: {}}], data: "lorem ipsum")
    }`).then(result => {
      expect(result).to.have.property('script');
      expect(result.script).to.equal('loremIpsum');
    });
  });

  it.skip('can return debug information for query', async () => {
    return query(`{
      script(name: "Uppercase", data: "test", debug: true)
    }`).then(result => {
      expect(result).to.have.property('script');
      expect(result.script).to.have.property('children');
      expect(result.script).to.have.property('output');
    });
  });

  /**
   * @doc
   * ## Delay steps
   *
   * Add the property ``delay: 1000`` to add a delay between executing the
   * steps. The value is the interval in milliseconds.
   */
  it('can add delay between steps', async () => {
    const script = await createScript({
      name: 'Testscript',
      delay: 100,
      steps: [{
        object: {}
      }, {
        object: {}
      }, {
        object: {}
      }]
    });
    const start = new Date();
    return script.run().then(() => {
      const end = new Date();
      const interval = end - start;
      expect(interval > 250).to.equal(true);
      expect(interval < 350).to.equal(true);
    });
  });

  it.skip('will execute postprocessor scripts in model', async () => {
    return query('{createPost(title:"test"){id title}}').then(result => {
      expect(result.createPost.title).to.equal('TEST');
    });
  });

  it('can retain data in object transformation', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        object: {
          foo: 'bar',
          '...': '...'
        }
      }]
    });
    return script.run({bar: 'baz'}).then(result => {
      expect(result).to.deep.equal({
        foo: 'bar',
        bar: 'baz'
      });
    });
  });

  it.skip('can read data with Script engine', async () => {
    return query('{listWebsiteItem { id name }}').then(result => {
      expect(result.listWebsiteItem).to.have.length(10);
      expect(result.listWebsiteItem[0]).to.have.property('id');
      expect(result.listWebsiteItem[0]).to.have.property('name');
    });
  });

  it.skip('can read config', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        config: '/storage/databases/website/parameters/baseUri'
      }]
    }, app.storage);
    return script.run({}).then(result => {
      expect(result).to.equal('http://localhost:8372');
    });
  });

  it('can get object property keys', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        keys: {}
      }]
    }, app.storage);
    return script.run({a: 1, b: 2, c: 3}).then(result => {
      expect(result).to.deep.equal(['a', 'b', 'c']);
    });
  });

  it('can omit keys from object', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        object: {
          string: [{
            omit: 'a'
          }],
          array: [{
            omit: ['b', 'c']
          }]
        }
      }]
    }, app.storage);
    return script.run({a: 1, b: 2, c: 3}).then(result => {
      expect(result.string).to.deep.equal({b: 2, c: 3});
      expect(result.array).to.deep.equal({a: 1});
    });
  });

  it('can pick keys from object', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        object: {
          string: [{
            pick: 'a'
          }],
          array: [{
            pick: ['b', 'c']
          }]
        }
      }]
    }, app.storage);
    return script.run({a: 1, b: 2, c: 3}).then(result => {
      expect(result.string).to.deep.equal({a: 1});
      expect(result.array).to.deep.equal({b: 2, c: 3});
    });
  });

  it('can detect changes on object', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        changed: {
          left: '/left',
          right: '/right'
        }
      }]
    }, app.storage);
    const left = {a: 1, b: 'test', c: {foo: 'bar'}, d: {foo: 'bar'}, f: null};
    const right = {a: 1, e: 'test', c: {foo: 'baz'}, d: {foo: 'bar'}, g: null};
    return script.run({left, right}).then(result => {
      expect(result).to.deep.equal({
        b: null,
        c: {foo: 'baz'},
        e: 'test'
      });
    });
  });

  it('can apply changes to object', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        change: {
          target: '/target',
          changes: '/changes'
        }
      }]
    }, app.storage);
    const left = {a: 1, b: 'test', c: {foo: 'bar'}, d: {foo: 'bar'}};
    const right = {a: 1, e: 'test', c: {foo: 'baz'}, d: {foo: 'bar'}};
    const changes = {
      b: null,
      c: {foo: 'baz'},
      e: 'test'
    };
    return script.run({target: left, changes}).then(result => {
      expect(result).to.deep.equal(right);
    });
  });

  it('can convert text to base64', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        toBase64: {}
      }]
    }, app.storage);
    return script.run('test').then(result => {
      expect(result).to.equal(new Buffer('test').toString('base64'));
    });
  });

  it('can convert text from base64', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        fromBase64: {}
      }]
    }, app.storage);
    return script.run(new Buffer('test').toString('base64')).then(result => {
      expect(result).to.equal('test');
    });
  });

  it('can render HTML template', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        render: '<h1>{{title}}</h1>'
      }]
    }, app.storage);
    return script.run({title: 'Test'}).then(result => {
      expect(result).to.equal('<h1>Test</h1>');
    });
  });

  it('can parse date', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        parseDate: {
          format: 'D MMMM YYYY',
          locale: 'nl'
        }
      }]
    }, app.storage);
    return script.run('3 mei 2017').then(result => {
      expect(result).to.equal('2017-05-03T00:00:00.000Z');
    });
  });

  it('can format date', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        formatDate: {
          format: 'D MMMM YYYY',
          locale: 'nl'
        }
      }]
    }, app.storage);
    return script.run('2017-05-03').then(result => {
      expect(result).to.equal('3 mei 2017');
    });
  });

  /**
   * @doc
   * ## Filter
   *
   * Simple filtering of arrays can be done using the ``filter`` method.
   * The following script will transform ``[3, 2, 56, 0, 3]`` Into
   * ``[3, 2, 56, 3]``.
   *
   * ```
   * - filter: {}
   * ```
   */
  it('can do simple filtering on arrays', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        filter: {}
      }]
    }, app.storage);
    return script.run([3, 2, 56, 0, 3]).then(result => {
      expect(result).to.deep.equal([3, 2, 56, 3]);
    });
  });

  /**
   * @doc
   *
   * A script can be provided as option. This allows for filtering on values
   * inside objects. We can use this to filter out objects with a count of 0
   * in the following input:
   *
   * ```
   * [{
   *  id: 1, count: 3
   * }, {
   *  id: 2, count: 0
   * }]
   * ```
   *
   * Script for filtering:
   *
   * ```
   * - filter:
   *     - get: /count
   * ```
   */
  it('can filter with subscript on arrays', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        filter: [{
          get: '/count'
        }]
      }]
    }, app.storage);
    const input = [{
      id: 1, count: 3
    }, {
      id: 2, count: 0
    }];
    return script.run(input).then(result => {
      expect(result).to.deep.equal([{
        id: 1, count: 3
      }]);
    });
  });

  /**
   * @doc
   *
   * More complex filtering can be done by specifying ``source`` and ``filter``
   * properties as the method arguments. The ``source`` is a script (shorthand)
   * that provides the input for filtering, and ``filter`` provides the script.
   * The advantage is that we can use values outside the array in our filtering
   * script. The example below filters all items from the array that have an
   * ``id`` that is equal to ``excludeId``.
   *
   * ```
   * - filter:
   *     source: /items
   *     filter:
   *       - jump:
   *           left: /excludeId
   *           right: /item/id
   *           to: identical
   *       - static: true
   *       - jump: end
   *       - identical
   *       - static: false
   *       - end
   * ```
   */
  it('can filter with source / filter keys on arrays', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        filter: {
          source: '/items',
          filter: [
            {
              jump: {
                left: '/excludeId',
                right: '/item/id',
                to: 'identical'
              }
            },
            {static: true},
            {jump: 'end'},
            'identical',
            {static: false},
            'end'
          ]
        }
      }]
    }, app.storage);
    const input = {
      excludeId: 2,
      items: [{
        id: 1, count: 3
      }, {
        id: 2, count: 0
      }]
    };
    return script.run(input).then(result => {
      expect(result).to.deep.equal([{
        id: 1, count: 3
      }]);
    });
  });

  /**
   * @doc
   * ## Split
   *
   * Strings can be split using the ``split`` method.
   *
   * ```
   * - split:
   *     separator: '/'
   * ```
   *
   * This will produce the output ``["a", "b", "c"]`` for input ``"a/b/c"``.
   */
  it('can split strings', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        split: {
          separator: '/'
        }
      }]
    }, app.storage);
    return script.run('a/b/c').then(result => {
      expect(result).to.deep.equal(['a', 'b', 'c']);
    });
  });

  /**
   * @doc
   * A maximum number of items can be specified using ``maxItems``.
   *
   * ```
   * - split:
   *     separator: '/'
   *     maxItems: 2
   * ```
   *
   * This will produce the output ``["a", "b"]`` for input ``"a/b/c"``.
   */
  it('can split strings with maxItems', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        split: {
          separator: '/',
          maxItems: 2
        }
      }]
    }, app.storage);
    return script.run('a/b/c').then(result => {
      expect(result).to.deep.equal(['a', 'b']);
    });
  });

  /**
   * @doc
   * The remainder can be added to the last item by setting ``addRemainder``
   * to true.
   *
   * ```
   * - split:
   *     separator: '/'
   *     maxItems: 2
   *     addRemainder: true
   * ```
   *
   * This will produce the output ``["a", "b/c"]`` for input ``"a/b/c"``.
   */
  it('can add remainder on split', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        split: {
          separator: '/',
          maxItems: 2,
          addRemainder: true
        }
      }]
    }, app.storage);
    return script.run('a/b/c').then(result => {
      expect(result).to.deep.equal(['a', 'b/c']);
    });
  });

  /**
   * @doc
   * ## Match
   *
   * The ``match`` method can be used to check if the value matches a given
   * regular expression. The result is either false or an array containing
   * the full match as first element followed by all captured groups.
   * All matches are returned when the "g" flag is provided, but no captured
   * groups are returned in that case.
   *
   * The provided expression must be a full literal, in the form
   * ``/body/flags``.
   *
   * ```
   * - match: /^[a-z]$/i
   * ```
   */
  it('can match value with regex', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        match: '/^(.)[a-z]$/i'
      }]
    }, app.storage);
    return script.run('ab').then(result => {
      expect(result).to.deep.equal(['ab', 'a']);
      return script.run('abc');
    }).then(result => {
      expect(result).to.equal(false);
    });
  });

  /**
   * @doc
   * The value for ``match`` may be an object with the keys ``pattern`` and
   * ``input``. Let both be a shorthand which resolves to the regular expression
   * and input.
   */
  it('can use shorthand in match', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        match: {
          pattern: '/pattern',
          input: '/input'
        }
      }]
    }, app.storage);
    const input = {
      pattern: '/^(.)[a-z]$/i',
      input: 'ab'
    };
    return script.run(input).then(result => {
      expect(result).to.deep.equal(['ab', 'a']);
      return script.run('abc');
    }).then(result => {
      expect(result).to.equal(false);
    });
  });

  /**
   * @doc
   * ## Eval
   * The ``eval`` method can be used to execute arbitrary scripts.
   * The options must provide an array with the script steps. It is allowed
   * to use the shorthand syntax.
   *
   * Example script:
   * ```
   * - eval: /steps
   * ```
   *
   * Example input:
   * ```
   * {
   *   steps: [{
   *     get: '/foo'
   *   }],
   *   foo: 'bar'
   * }
   * ```
   *
   * Output: ``"bar"``.
   */
  it.skip('can run script with eval', async () => {
    const script = await createScript({
      name: 'Testscript',
      steps: [{
        eval: '/steps'
      }]
    }, app.storage);
    const input = {
      steps: [{
        get: '/foo'
      }],
      foo: 'bar'
    };
    return script.run(input).then(result => {
      expect(result).to.equal('bar');
    });
  });

  it.skip('can provide debug information', async () => {
    const steps = [{
      static: {foo: 'bar'}
    }, {
      object: {
        baz: '/foo'
      }
    }];
    const script = await createScript({name: 'Testscript', steps}, {}, {debug: true});
    return script.run({}).then(result => {
      // The result is split up in 'output', 'definition' and 'children'.
      expect(result).to.have.property('output');
      expect(result).to.have.property('definition');
      expect(result).to.have.property('children');

      expect(result.output).to.deep.equal({baz: 'bar'});
      expect(result.definition).to.deep.equal(steps);
      expect(result.children).to.have.length(2);

      expect(result.children[1].definition).to.deep.equal({
        object: {baz: '/foo'}
      });
      expect(result.children[1].children).to.have.length(1);
      expect(result.children[1].children[0].definition).to.deep.equal([{
        get: '/foo'
      }]);
      expect(result.children[1].children[0].output).to.equal('bar');
      expect(result.children[1].children[0].info).to.equal('baz property, using shorthand');
    });
  });

  it.skip('can run a named script', async () => {
    const steps = [{
      script: 'Uppercase'
    }];
    const script = await createScript({name: 'Testscript', steps}, app.storage);
    return script.run('foo').then(result => {
      expect(result).to.equal('FOO');
    });
  });
});
