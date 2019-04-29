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

const CommerceToolsCart = require('./CommerceToolsCart');
const CommerceToolsPayment = require('./CommerceToolsPayment');
const CcifIdentifier = require('@adobe/commerce-cif-commercetools-common/CcifIdentifier');
const Error = require('@adobe/commerce-cif-commercetools-common/Error');

/**
 * Commerce Tools cart API implementation for the payment.
 */
class CommerceToolsCartPayment extends CommerceToolsCart {


    /**
     * Builds a cart payment client for Commerce Tools
     *
     * @param args                          parameters as received from open whisk
     * @param createClient {Function}       commerce tool's createClient function builder
     * @param cartMapper {Function}         commerce tools cif cartMapper handler
     * @param paymentMapper {Function}      commerce tools cif paymentMapper handler
     * @param paymentDraftMapper {Function} commerce tools cif paymentDraftMapper handler
     * @param singlePayment {Boolean}       a flag to indicate whether we should check that another payment is already associated with the cart.
     */
    constructor(args, createClient, cartMapper, paymentMapper, paymentDraftMapper, singlePayment) {
        super(args, createClient, cartMapper);
        this.paymentClient = new CommerceToolsPayment(args, createClient, paymentMapper);
        //need this to avoid a new cart get when sending second cart request (for payment POST or DELETE)
        this.cartVersion = null;
        this.singlePayment = singlePayment;
        this.paymentDrafMapper = paymentDraftMapper;
    }

    /**
     * Creates a new CommerceTools payment and adds it to the cart.
     *
     * @param id             cart id
     * @param payment        a CCIF payment object
     * @return {Promise}
     */
    addCartPayment(id, payment) {   
        let ccifId = new CcifIdentifier(id);
        this.requestBuilder.byId(ccifId.getCommerceToolsId());
        const baseUrl = this._buildBaseUrl();
        return this._createPayment(baseUrl, payment).then(newPayment => {
            const data = {
                actions: [{action: 'addPayment', payment: {id: newPayment.response.body.id}}]
            };
            data.version = this.cartVersion;
            //we need it as the configuration is removed  after first cart request
            this._setExpandConfiguration();
            return this._handle(baseUrl, 'POST', data);
        }).catch(error => {
            console.error("Failed to add cart payment", baseUrl, payment, error);
            return this._handleError(error);
        });
    }

    /**
     * Creates a payment in commerce tools payments.
     *
     * @param baseUrl           the base url for this request
     * @param payment           a CCIF payment object
     * @return {Promise}
     * @private
     */
    _createPayment(baseUrl, payment) {
        return this._getCartVersion(baseUrl).then(() => {
            let paymentDraft = this.paymentDrafMapper(payment);
            return this.paymentClient.post(paymentDraft);
        });
    }

    /**
     *
     * Gets the cart version (required to set the new payment to the cart). If a payment already exists, the request is rejected.
     *
     * @param baseUrl       the base url for this request
     * @return {Promise}
     * @private
     */
    _getCartVersion(baseUrl) {
        return this._ctCartById(baseUrl)
        .then(result => {
            this.cartVersion = result.body.version;
            if (this.singlePayment && result.body.paymentInfo && result.body.paymentInfo.payments.length >= 1) {
                return Promise.reject(Error.PAYMENT_ALREADY_SET_ERROR());
            } else {
                return Promise.resolve();
            }  
        });
    }

    /**
     * Deletes the payment from cart and from commerce tools payments.
     *
     * @param id                cart id
     * @return {Promise}
     */
    deletePayment(id) {
        let ccifId = new CcifIdentifier(id);
        this.requestBuilder.byId(ccifId.getCommerceToolsId());
        const baseUrl = this._buildBaseUrl();
        return this._getCartPaymentIdentifier(baseUrl).then(payment => {
            const data = {
                actions: [{action: 'removePayment', payment: {id: payment.id, version: payment.version}}]
            };
            data.version = this.cartVersion;
            return this._handle(baseUrl, 'POST', data).then(cart => {
                this.paymentClient.delete(payment.id, payment.version);
                return Promise.resolve(cart);
            });
        }).catch(error => {
            console.error("Failed to delete payment", baseUrl, error);
            return this._handleError(error);
        });
    }

     /**
     * Deletes one of the payments from cart and from commerce tools payments.
     *
     * @param id                cart id
     * @param paymentId         the id of the payment
     * @return {Promise}
     */
    deleteCartPayment(id, paymentId) {
        let ccifId = new CcifIdentifier(id);
        this.requestBuilder.byId(ccifId.getCommerceToolsId());
        const baseUrl = this._buildBaseUrl();
        let _localPayment;
        let _localCart;
        return this._getCartPaymentIdentifier(baseUrl, paymentId)
            .then(payment => {
                const data = {
                    actions: [{action: 'removePayment', payment: {id: payment.id, version: payment.version}}]
                };
                _localPayment = payment;
                data.version = this.cartVersion;
                return this._handle(baseUrl, 'POST', data);
            })
            .then(cartResponse => {
                // we "clone" the response here because subsquent calls may overwrite it.
                // we'll fix this properly in the near future
                _localCart = JSON.stringify(cartResponse);
                return this.paymentClient.delete(_localPayment.id, _localPayment.version);
            })
            .then(() => {
                return Promise.resolve(JSON.parse(_localCart));
            })
            .catch(error => {
                console.error("Failed to delete cart payment", baseUrl, paymentId, error);
                return this._handleError(error);
            });
    }

    /**
     *
     * Get's the payment id and version based on cart id. If no payment exists reject the request.
     *
     * @param id            cart id
     * @return {Promise}    the payment id and version for the payment
     * @private
     */
    _getCartPaymentIdentifier(baseUrl, paymentId) {
        return this._ctCartById(baseUrl)
            .then(result => {
                const paymentInfo = result.body.paymentInfo;
                this.cartVersion = result.body.version;
                if (!paymentInfo || paymentInfo.payments.length < 1) {
                    return Promise.reject(Error.PAYMENT_UNSET_ERROR());
                } else {
                    let payment;
                    if (paymentId) {
                        payment = paymentInfo.payments.find( p => p.id === paymentId)
                    } else {
                        payment = paymentInfo.payments[0];
                    }
                    return Promise.resolve({
                        'id':payment.id,
                        'version':payment.obj.version
                    });
                }
        });
    }
}

module.exports = CommerceToolsCartPayment;