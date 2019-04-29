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

const createAuthMiddlewareForAnonymousSessionFlow = require('@commercetools/sdk-middleware-auth').createAuthMiddlewareForAnonymousSessionFlow;
const createAuthMiddlewareForPasswordFlow = require('@commercetools/sdk-middleware-auth').createAuthMiddlewareForPasswordFlow;
const createHttpMiddleware = require('@commercetools/sdk-middleware-http').createHttpMiddleware;
const tokenCookieMiddleware = require('./tokenCookieMiddleware.js');
const respondWithCommerceToolsError = require('./web-response-utils').respondWithCommerceToolsError;
const createRequestBuilder = require('@commercetools/api-request-builder').createRequestBuilder;
const fetch = require('isomorphic-fetch');
const HttpStatusCodes = require('http-status-codes');

/**
 * Base class for commerce tools client. This should be extended for each implemented business domain api like catalog,
 * products or cart.
 */
class CommerceToolsClientBase {
    /**
     * Initialise commerce tools client.
     * @param args                        parameters as received from open whisk
     * @param createClient {Function}     commerce tools factory function
     */
    constructor(args, createClient, mapper, errorType) {

        args.response = args.response || {};
        this.args = args;
        this.errorType = errorType;
        this.requestBuilder = createRequestBuilder({projectKey: args.CT_PROJECTKEY});
        this.mapper = mapper;
        this.mapperArgs = [];
        //if any, set from children
        this.responseArgs = {};

        //configuration from property file
        const authConfig = {
            host: args.CT_AUTH_HOST,
            projectKey: args.CT_PROJECTKEY,
            credentials: {
                clientId: args.CT_CLIENTID,
                clientSecret: args.CT_CLIENTSECRET
            },
            fetch,
        };
        let createAuthMiddleware;
        //if email and password then create a customer login token
        if (args.email && args.password) {
            authConfig.credentials.user = {
                username: args.email,
                password: args.password
            };
            authConfig.scopes = [`manage_project:${args.CT_PROJECTKEY}`];
            createAuthMiddleware = createAuthMiddlewareForPasswordFlow(authConfig);
        } else {
            createAuthMiddleware = createAuthMiddlewareForAnonymousSessionFlow(authConfig);
        }

        this.client = createClient({
            middlewares: [
                tokenCookieMiddleware.extractOauthTokenMiddleware(args.__ow_headers),
                createAuthMiddleware,
                tokenCookieMiddleware.setOauthTokenMiddleware(args.response),
                createHttpMiddleware({host: args.CT_API_HOST})
            ]
        });

    }

    /**
     * @private
     */
    _execute(baseUrl, method, data) {
        const config = {
            uri: baseUrl,
            headers: this.args.headers
        };
        if (method !== 'undefined' && method) {
            config.method = method;
        }
        if (data !== 'undefined' && data) {
            config.body = JSON.stringify(data);
        }

        if (this.args.DEBUG) {
            return this._profileRequest(config);
        }

        return this.client.execute(config);
    }

    /**
     *  @protected
     */
    _handleError(error) {
        return respondWithCommerceToolsError(error, this.args, Promise.resolve.bind(Promise), this.errorType);
    }

    handleInternalError(internalError) {
        this.args.response = {
            error: internalError,
            errorType: this.errorType
        };
        return Promise.resolve(this.args);
    }

    /**
     * @protected
     */
    _handleSuccess(response) {
        let headers = this.args.response.headers || {};
        if (this.args.DEBUG) {
            headers['OW-Activation-Id'] = process.env.__OW_ACTIVATION_ID;
        }
        Object.assign(this.args.response, {'statusCode': 200, 'body': response, 'headers': headers});
        for (let name in this.responseArgs) {
            if (typeof this.responseArgs[name] !== 'function') {
                this.args[name] = this.responseArgs[name];
            }
        }
        return Promise.resolve(this.args);
    }

    /**
     * Wraps a request and prints out debug information to the log.
     * 
     * @param {Object} config  Request options.
     */
    _profileRequest(config) {
        let s = process.hrtime();
         // Create a reference to the _logRequest function with the class context
        // bound, so it can be used within the request Promise.
        let logRequest = this._logRequest.bind(this);
         return this.client.execute(config)
            .then((res) => {
                logRequest(config, s, true);
                return Promise.resolve(res);
            })
            .catch((res) => {
                logRequest(config, s, false);
                return Promise.reject(res);
            });
    }

    /**
     * @protected
     */
    _handle(baseUrl, method, data) {
        return this._execute(baseUrl, method, data).then(result => {
            //insert result in mapperArgs
            this.mapperArgs.splice(0, 0, result);
            //insert client arguments (action invoke arguments) in mapperArgs;
            this.mapperArgs.splice(1, 0, this.args);
            return this._handleSuccess(this.mapper.apply(this, this.mapperArgs));
        }).catch(error => {
            if (error && error.code === HttpStatusCodes.CONFLICT) {
                throw error;
            }
            console.error("Received error for request", baseUrl, method, data, error);
            return this._handleError(error);
        });
    }

    /**
     * Logs a request to Commercetools.
     * 
     * @param {Object} options      Request options.
     * @param {Array} start         HR starting time of request.
     * @param {Boolean} passed      true, if request returned with 2xx status.
     */
    _logRequest(options, start, passed) {
        let end = process.hrtime(start);
        let duration = Math.round(((end[0] * 1e9) + end[1]) / 1e6);
        console.log("BACKEND-CALL", options.method, options.uri, duration, passed ? "PASS" : "FAIL");
    }

    /**
     * @protected
     */
    _buildBaseUrl() {
        return this.requestBuilder.build();
    }

    /**
     * Expand wrapper.
     */
    expand(expandData) {
        this.requestBuilder.expand(expandData);
        return this;
    }

    /**
     * ById wrapper.
     */
    byId(value) {
        this.requestBuilder.byId(value);
        return this;
    }

    /**
     * Sort wrapper.
     */
    sort(sort, bool) {
        this.requestBuilder.sort(sort, bool);
        return this;
    }

    /**
     * Text wrapper.
     */
    text(text, language) {
        this.requestBuilder.text(text, language);
        return this;
    }

    /**
     * facet wrapper.
     */
    facet(facetValue) {
        this.requestBuilder.facet(facetValue);
        return this;
    }

    /**
     * filterByQuery wrapper.
     */
    filterByQuery(filter) {
        this.requestBuilder.filterByQuery(filter);
        return this;
    }

    /**
     * filter wrapper.
     */
    filter(filter) {
        this.requestBuilder.filter(filter);
        return this;
    }

    /**
     * filter facets wrapper.
     */
    filterByFacets(filter) {
        this.requestBuilder.filterByFacets(filter);
        return this;
    }

    /**
     * perPage wrapper.
     */
    perPage(limit) {
        this.requestBuilder.perPage(limit);
        return this;
    }

    /**
     * page wrapper.
     */
    page(offset) {
        this.requestBuilder.page(offset);
        return this;
    }

    /**
     * query predicate.
     */
    where(predicate) {
        this.requestBuilder.where(predicate);
        return this;
    }
}

module.exports = CommerceToolsClientBase;