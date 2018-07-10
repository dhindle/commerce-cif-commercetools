/*******************************************************************************
 *
 *    Copyright 2018 Adobe. All rights reserved.
 *    This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License. You may obtain a copy
 *    of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software distributed under
 *    the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *    OF ANY KIND, either express or implied. See the License for the specific language
 *    governing permissions and limitations under the License.
 *
 ******************************************************************************/

'use strict';

const chai = require('chai');
const chaiHttp = require('chai-http');
const HttpStatus = require('http-status-codes');
const setup = require('../lib/setupIT.js').setup;

const expect = chai.expect;

chai.use(chaiHttp);


describe('commercetools getCategories', function() {

    describe('Integration tests', function() {

        // Get environment
        let env = setup();

        // Increase test timeout
        this.slow(env.slow);
        this.timeout(env.timeout);

        const rootCategories = [
            "693b0fc5-7283-4673-a362-589d37fb7b73",
            "4104387b-a208-430e-9072-3376b633a67a",
            "192f8ad3-a7c4-4478-89de-1b38c82f2660"];
        
        it('returns all categories in tree structure', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'tree'
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);
                    expect(res.body.count).to.equal(24);
                    expect(res.body.results).to.have.lengthOf(3);

                    // Verify structure
                    for(let category of res.body.results) {
                        expect(category).to.have.own.property('subCategories');
                        for(let subCategory of category.subCategories) {
                            expect(subCategory).to.have.own.property('parentCategories');
                        }
                    }
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns all categories in flat structure', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'flat'
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);
                    expect(res.body.count).to.equal(24);
                    expect(res.body.results).to.have.lengthOf(24);

                    // Verify structure
                    for(let category of res.body.results) {
                        expect(category).to.not.have.own.property('subCategories');
                    }
                })
                .catch(function(err) {
                    throw err;
                });
        });


        it('returns a single category', function() {
            const categoryId = '693b0fc5-7283-4673-a362-589d37fb7b73';
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    id: categoryId
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);

                    // Verify structure
                    const category = res.body;
                    expect(category).to.have.own.property('name');
                    expect(category.name.en).to.equal('Men');
                    expect(category).to.have.own.property('description');
                    expect(category).to.have.own.property('id');
                    expect(category).to.have.own.property('lastModifiedDate');
                    expect(category).to.have.own.property('createdDate');
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns all categories in a tree structure with only root nodes', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'tree',
                    depth: 0
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);
                    expect(res.body.count).to.equal(3);
                    expect(res.body.results).to.have.lengthOf(3);

                    // Check that only root nodes are shown
                    const ids = res.body.results.map(r => r.id);
                    expect(ids).to.have.members(rootCategories);

                    // Verify structure
                    for(let category of res.body.results) {
                        expect(category).to.not.have.own.property('subCategories');
                    }
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns all categories in a flat structure with only root nodes', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'flat',
                    depth: 0
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);
                    expect(res.body.count).to.equal(3);
                    expect(res.body.results).to.have.lengthOf(3);

                    // Check that only root nodes are shown
                    const ids = res.body.results.map(r => r.id);
                    expect(ids).to.have.members(rootCategories);

                    // Verify structure
                    for(let category of res.body.results) {
                        expect(category).to.not.have.own.property('subCategories');
                    }
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns all categories in tree structure sorted by their names', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'tree',
                    sort: 'name.en.desc'
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);

                    // Verfiy sorting
                    const names = res.body.results.map(r => r.name.en);
                    expect(names).to.have.ordered.members(names.sort().reverse());
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns all categories in tree structure with subcategories sorted by their names', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'tree',
                    sort: 'name.en.desc'
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);

                    // Verify sorting of subcategories
                    for(let category of res.body.results) {
                        const subnames = category.subCategories.map(r => r.name.en);
                        expect(subnames).to.have.ordered.members(subnames.sort().reverse());
                    }
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns all categories in flat structure sorted by their names', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'flat',
                    sort: 'name.en.desc'
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);

                    // Verfiy sorting
                    const names = res.body.results.map(r => r.name.en);
                    expect(names).to.have.ordered.members(names.sort().reverse());
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns a 400 error for invalid sorting parameters', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    sort: 'abc.asc'
                })
                .catch(function(err) {
                    expect(err.response).to.have.status(HttpStatus.BAD_REQUEST);
                });
        });


        it('returns a subset of categories in tree structure as defined by paging parameters', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'tree',
                    limit: 5,
                    offset: 10
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);
                    expect(res.body.offset).to.equal(10);
                    expect(res.body.count).to.equal(5);
                    expect(res.body.total).to.equal(24);
                    expect(res.body.results).to.have.lengthOf(5);
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns a subset of categories in flat structure as defined by paging parameters', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    type: 'flat',
                    limit: 7,
                    offset: 14
                })
                .then(function (res) {
                    expect(res).to.be.json;
                    expect(res).to.have.status(HttpStatus.OK);
                    expect(res.body.offset).to.equal(14);
                    expect(res.body.count).to.equal(7);
                    expect(res.body.total).to.equal(24);
                    expect(res.body.results).to.have.lengthOf(7);
                })
                .catch(function(err) {
                    throw err;
                });
        });

        it('returns a 400 error for invalid paging parameters', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({
                    limit: -7,
                })
                .catch(function(err) {
                    expect(err.response).to.have.status(HttpStatus.BAD_REQUEST);
                });
        });

        it('returns a 404 error for a non existent category', function() {
            return chai.request(env.openwhiskEndpoint)
                .get(env.categoriesPackage + 'getCategories')
                .query({id: '526dc571-104f-XXXX-b761-71781a97910b'})
                .catch(function(err) {
                    expect(err.response).to.have.status(HttpStatus.NOT_FOUND);
                });
        });

    });
});