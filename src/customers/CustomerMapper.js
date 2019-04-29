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

const Customer = require('@adobe/commerce-cif-model').Customer;
const LoginResult = require('@adobe/commerce-cif-model').LoginResult;
const MissingPropertyException = require('@adobe/commerce-cif-common/exception').MissingPropertyException;
const CartMapper = require('@adobe/commerce-cif-commercetools-cart/CartMapper');

/**
 * Utility class to map commercetools customer objects to CCIF objects. Private marked methods should not be used outside
 * of this class.
 */
class CustomerMapper {

    /**
     * Constructor.
     * 
     * @param {LanguageParser} languageParser LanguageParser reference
     */
    constructor(languageParser) {
        this.languageParser = languageParser;
        this.cartMapper = new CartMapper(languageParser);
    }

    /**
     * Maps a CommerceTools customer to a CCIF Customer object.
     *
     * @param ctCustomer        A CommerceTools customer object.
     * @returns {Customer}      A CCIF Customer object.
     */
    mapCustomer(ctCustomer) {
        if (!ctCustomer || !ctCustomer.body || !ctCustomer.body.id) {
            console.error('invalid customer response received from commerce tools', ctCustomer);
            throw new MissingPropertyException('invalid customer response received from commerce tools');
        }

        return this._mapCustomer(ctCustomer.body);
    }

    /**
     * @private
     */
    _mapCustomer(ctCustomer) {
        if (!ctCustomer || !ctCustomer.id) {
            console.error('invalid customer object received from commerce tools', ctCustomer);
            throw new MissingPropertyException('invalid customer object received from commerce tools');
        }

        let customer = new Customer.Builder()
            .withId(ctCustomer.id)
            .withEmail(ctCustomer.email)
            .withFirstName(ctCustomer.firstName)
            .withLastName(ctCustomer.lastName)
            .build();
        customer.createdAt = ctCustomer.createdAt;
        customer.lastModifiedAt = ctCustomer.lastModifiedAt;
        return customer;
    }

    /**
     * Maps a CommerceTools login response to a CCIF LoginResult object.
     *
     * @param ctResult          A CommerceTools login response.
     * @param args              OpenWhisk action arguments.
     * @returns {LoginResult}   A CCIF LoginResult object.
     */
    mapCustomerLogin(ctResult) {
        if (!ctResult || !ctResult.body || !ctResult.body.customer) {
            console.error('invalid customer response received from commerce tools', ctResult);
            throw new MissingPropertyException('invalid customer response received from commerce tools');
        }


        let customer = this._mapCustomer(ctResult.body.customer);
        let loginResult = new LoginResult.Builder().withCustomer(customer).build();
        if (ctResult.body.cart) {
            loginResult.cart = this.cartMapper._mapCart(ctResult.body.cart);
        }

        return loginResult;
    }

}

module.exports = CustomerMapper;