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

const CommerceToolsCartVersion = require('./CommerceToolsCartVersion');
const CommerceToolsOrder = require('./CommerceToolsOrder');
const CcifIdentifier = require('@adobe/commerce-cif-commercetools-common/CcifIdentifier');
const HttpStatusCodes = require('http-status-codes');

/**
 * Commerce Tools cart API implementation for the order.
 */
class CommerceToolsCartOrder extends CommerceToolsCartVersion {


    /**
     * Builds a cart order client for Commerce Tools
     *
     * @param args                      parameters as received from open whisk
     * @param createClient {Function}   commerce tool's createClient function builder
     * @param orderMapper {Function}    commerce tools cif orderMapper handler
     */
    constructor(args, createClient, orderMapper) {
        super(args, createClient);
        this.orderClient = new CommerceToolsOrder(args, createClient, orderMapper);
    }

    /**
     * Creates a order based on cart id.
     *
     * @param cartId         cart id
     * @return {Promise}
     */
    postOrder(cartId) {
        let ccifId = new CcifIdentifier(cartId);
        this.requestBuilder.byId(ccifId.getCommerceToolsId());
        const baseUrl = this._buildBaseUrl();
        let data = {
            id: ccifId.getCommerceToolsId(),
            version: ccifId.getCommerceToolsVersion()
        };
        //if cached cart version should not be used first load the cart version and then post the order data.
        if (typeof this.args.USE_CACHED_CART_VERSION === 'boolean' && !this.args.USE_CACHED_CART_VERSION) {
            return this._ctCartById(baseUrl).then(result => {
                data.version = result.body.version;
                return this._handlePostOrder(baseUrl, data);
            }).catch(error => {
                console.error("Received error for uncached postOrder request", baseUrl, data, error);
                return this._handleError(error);
            });
        } else {
            return this._handlePostOrder(baseUrl, data).catch((error) => {
                console.error("Received error for cached postOrder request", baseUrl, data, error);
                return this._handleError(error);
            });
        }
    }

    /**
     * Internal helper method for post order.
     * @param baseUrl
     * @param data
     * @private
     */
    _handlePostOrder(baseUrl, data) {
        return this.orderClient.post(data).catch((error) => {
            if (error && error.code === HttpStatusCodes.CONFLICT) {
                console.log("Cart is outdated, fetch latest cart", error);
                return this._ctCartById(baseUrl).then(result => {
                    data.version = result.body.version;
                    return this.orderClient.post(data);
                });
            }
            throw error;
        });
    }

}

module.exports = CommerceToolsCartOrder;