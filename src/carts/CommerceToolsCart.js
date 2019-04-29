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

const CommerceToolsClientBase = require('@adobe/commerce-cif-commercetools-common/CommerceToolsClientBase');
const HttpStatusCodes = require('http-status-codes');
const CcifIdentifier = require('@adobe/commerce-cif-commercetools-common/CcifIdentifier');
const ERROR_TYPE = require('./constants').ERROR_TYPE;

/**
 * Commerce Tools cart API implementation.
 */
class CommerceToolsCart extends CommerceToolsClientBase {

    /**
     * Builds a cart client for Commerce Tools
     *
     * @param args                      parameters as received from open whisk
     * @param createClient {Function}   commerce tool's createClient function builder
     * @param cartMapper {Function}     commerce tools cif cart mapper handler
     */
    constructor(args, createClient, cartMapper) {
        super(args, createClient, cartMapper, ERROR_TYPE);
        this.requestBuilder = this.requestBuilder.myCarts;
        this.responseArgs.cacheControl = 'no-cache, no-store, no-transform, must-revalidate';
        this._setExpandConfiguration();
    }

    /**
     *
     * @protected
     */
    _setExpandConfiguration() {
        this.expand('lineItems[*].productType')
            .expand('lineItems[*].discountedPricePerQuantity[*].discountedPrice.includedDiscounts[*].discount')
            .expand('shippingInfo.discountedPrice.includedDiscounts[*].discount')
            .expand('paymentInfo.payments[*]')
            .expand('discountCodes[*].discountCode');
    }

    /**
     * Creates an empty cart and if defined adds a first product to it.
     *
     * @param data {Object}      product data for the new entry
     * @return {Promise}         Promise with cart data
     */
    create(data) {
        return this._handle(this._buildBaseUrl(), 'POST', data);
    }

    /**
     * Generic purpose method that updates a cart based on provided data.
     *
     * @param id           The cart id.
     * @param data         The  data to be updated.
     *
     * @return {Promise}
     */
    postCartData(id, data) {
        let ccifId = new CcifIdentifier(id);
        this.requestBuilder.byId(ccifId.getCommerceToolsId());
        const baseUrl = this._buildBaseUrl();
        data.version = ccifId.getCommerceToolsVersion();
        //if cached version should not be use first get cart and then post data.
        if (typeof this.args.USE_CACHED_CART_VERSION === 'boolean' && !this.args.USE_CACHED_CART_VERSION) {
            return this._ctCartById(baseUrl).then(result => {
                data.version = result.body.version;
                return this._handlePostCart(baseUrl, data);
            }).catch(error => {
                console.error("Received error when updating uncached cart", baseUrl, data, error);
                return this._handleError(error);
            });
        } else {
            return this._handlePostCart(baseUrl, data).catch(error => {
                console.error("Received error when updating cached cart", baseUrl, data, error);
                return this._handleError(error);
            });
        }
    }

    /**
     * Internal helper method for post cart.
     *
     * @param baseUrl
     * @param data
     * @private
     */
    _handlePostCart(baseUrl, data) {
        return this._handle(baseUrl, 'POST', data).catch((error) => {
            //check again for error code conflict. could be customer not allowed error.
            if (error && error.code === HttpStatusCodes.CONFLICT) {
                console.log("Cart is outdated, fetch latest cart", error);
                return this._ctCartById(baseUrl).then(result => {
                    data.version = result.body.version;
                    return this._handle(baseUrl, 'POST', data);
                });
            }
            throw error;
        });
    }

    /**
     * Gets a CCIF cart by id.
     *
     * @param id           The cart id.
     * @param args         OpenWhisk action arguments
     * @return {Promise}   Promise with CCIF cart Object.
     */
    getById(id, args) {
        let ccifId = new CcifIdentifier(id);
        this.requestBuilder.byId(ccifId.getCommerceToolsId());
        const baseUrl = this._buildBaseUrl();
        return this._ctCartById(baseUrl).then(result => {
            return this._handleSuccess(this.mapper(result, args));
        }).catch(error => {
            console.error("Could not retrieve cart", baseUrl, error);
            return this._handleError(error);
        });
    }

    /**
     * Gets a commerce tools cart by id
     *
     * @param id          Cart id.
     * @return {Request}  CommerceTools response.
     * @protected
     */
    _ctCartById(baseUrl) {
        return this._execute(baseUrl, 'GET');
    }

}

module.exports = CommerceToolsCart;