/* eslint-env node, mocha */
'use strict';

const Crypto = require('crypto');

const _ = require('lodash');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

const Container = require('../classes/container');

const GoogleSearchMockup = require('./mockups/google-search');
const WebsiteMockup = require('./mockups/website');

const expect = chai.expect;
chai.use(chaiAsPromised);

describe('Http', () => {
  let queryFactory;
  let container;
  let googleSearch;
  let website;

  const cx = Crypto.randomBytes(8).toString('base64');
  const key = Crypto.randomBytes(8).toString('base64');

  before(async () => {
    container = new Container();
    await container.startup();

    const config = await container.get('Config');
    config.set({
      storage: {
        modelsDir: 'test/http/models',
        databases: {
          internal: {
            engine: 'redis',
            host: 'localhost',
            port: 6379,
            prefix: ''
          },
          googlesearch: {
            engine: 'Http',
            parameters: {
              baseUri: 'http://localhost:8371',
              key,
              cx
            }
          },
          website: {
            engine: 'Http',
            parameters: {
              baseUri: 'http://localhost:8372'
            }
          }
        }
      }
    });
    queryFactory = await container.get('QueryFactory');

    googleSearch = new GoogleSearchMockup(key, cx);
    website = new WebsiteMockup();
    await googleSearch.startup();
    await website.startup();
  });

  after(async () => {
    await googleSearch.shutdown();
    await website.shutdown();
    await container.shutdown();
  });

  it('can list results', () => {
    const keyword = 't';
    const query = `{
      results: listGoogleSearch(query:$keyword) {
        id title link snippet
      }
    }`;
    return queryFactory.query(query, {keyword}).then(result => {
      // The number of returned items from the mockup is 7 times
      // the character count of the search query.
      expect(result.results).to.have.length(7);
      for (let i = 0; i < result.results.length; ++i) {
        expect(result.results[i].title).equals(googleSearch.searchResults[keyword].items[i].title);
      }
      // Result can be fetched with a single request.
      expect(googleSearch.requestCount()).to.equal(1);
    });
  });

  it('can compose result of multiple pages', () => {
    const keyword = 'test';
    const query = `{
      results: listGoogleSearch(query:$keyword) {
        id title link snippet
      }
    }`;
    return queryFactory.query(query, {keyword}).then(result => {
      // Number of results should be 4 * 7.
      expect(result.results).to.have.length(28);
      for (let i = 0; i < result.results.length; ++i) {
        expect(result.results[i].title).equals(googleSearch.searchResults[keyword].items[i].title);
      }
      expect(googleSearch.requestCount()).to.equal(3);
    });
  });

  it('will not return more results than maxPages * itemsPerPage', () => {
    const keyword = 'lorem';
    const query = `{
      results: listGoogleSearch(query:$keyword) {
        id title link snippet
      }
    }`;
    return queryFactory.query(query, {keyword}).then(result => {
      // Total result count should be 5 * 7 = 35,
      // but maximum number is 3 * 10 = 30.
      expect(result.results).to.have.length(30);
      for (let i = 0; i < result.results.length; ++i) {
        expect(result.results[i].title).equals(googleSearch.searchResults[keyword].items[i].title);
      }
      expect(googleSearch.requestCount()).to.equal(3);
    });
  });

  it('can fetch HTML page', () => {
    const id = 'http://localhost:8372/item/1';
    const query = `{
      results: readWebsiteItems(id: $id) {
        id name age
      }
    }`;
    return queryFactory.query(query, {id}).then(result => {
      expect(result.results.id).to.equal(id);
      expect(result.results.name).to.equal(website.people[1].name);
      expect(result.results.age).to.equal(website.people[1].age);
    });
  });

  it('can list items on HTML page', () => {
    const id = 'http://localhost:8372/list-more';
    const query = `{
      results: listWebsiteItems {
        id name
      }
    }`;
    return queryFactory.query(query, {id}).then(result => {
      expect(result.results).to.have.length(25);
    });
  });
});
