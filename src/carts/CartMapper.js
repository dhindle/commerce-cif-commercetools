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

const Cart = require('@adobe/commerce-cif-model').Cart;
const CartEntry = require('@adobe/commerce-cif-model').CartEntry;
const Discount = require('@adobe/commerce-cif-model').Discount;
const DiscountType = require('@adobe/commerce-cif-common/model').DiscountType;
const CartEntryType = require('@adobe/commerce-cif-common/model').CartEntryType;
const Address = require('@adobe/commerce-cif-model').Address;
const ShippingInfo = require('@adobe/commerce-cif-model').ShippingInfo;
const MissingPropertyException = require('@adobe/commerce-cif-common/exception').MissingPropertyException;
const PaymentMapper = require('./PaymentMapper');
const CouponMapper = require('./CouponMapper');
const CcifIdentifier = require('@adobe/commerce-cif-commercetools-common/CcifIdentifier');
const MoneyValue = require('@adobe/commerce-cif-model').MoneyValue;
const TaxInfo = require('@adobe/commerce-cif-model').TaxInfo;
const TaxPortion = require('@adobe/commerce-cif-model').TaxPortion;
const ProductMapper = require('@adobe/commerce-cif-commercetools-product/ProductMapper');

/**
 * Utility class to map commercetools cart objects to CCIF objects. Private marked methods should not be used outside
 * of this class.
 */
class CartMapper {

    /**
     * Constructor.
     * 
     * @param {LanguageParser} languageParser LanguageParser reference
     */
    constructor(languageParser) {
        this.languageParser = languageParser;
        this.productMapper = new ProductMapper(languageParser);
        this.couponMapper = new CouponMapper(languageParser);
        this.paymentMapper = new PaymentMapper();
    }

    static get GIFT_LINE_ITEM() {
        return 'GiftLineItem';
    }

    /**
     * Maps the CommerceTools cart to the CCIF cart representation.
     *
     * @param ctCart            JSON containing cart information as returned by CommerceTools.
     * @returns {Cart}          CCIF Cart representation.
     */
    mapCart(ctCart) {
        if (!ctCart || !ctCart.body) {
            console.error('invalid cart response received from commerce tools', ctCart);
            throw new MissingPropertyException('invalid cart response received from commerce tools');
        }
        if (!ctCart.body.id) {
            console.error('id missing for commercetools cart', ctCart);
            throw new MissingPropertyException('id missing for commercetools cart');
        }

        return this._mapCart(ctCart.body);
    }


    /**
     * @protected
     */
    _mapCart(ctCart) {
        let cartEntries = [];
        if (ctCart.lineItems && ctCart.lineItems.length > 0) {
            cartEntries = this._mapCartEntries(ctCart.lineItems);
        }
        const cifId = CcifIdentifier.buildCcifIdentifier(ctCart.id, ctCart.version);
        let productTotalPrice = new MoneyValue.Builder()
            .withAmount(ctCart.totalPrice.centAmount)
            .withCurrency(ctCart.totalPrice.currencyCode)
            .build();

        let cart = new Cart.Builder()
            .withId(cifId)
            .withEntries(cartEntries)
            .withCurrency(ctCart.totalPrice.currencyCode)
            .withProductTotalPrice(productTotalPrice)
            .build();

        cart.discounts = [];

        if (ctCart.taxedPrice) {
            cart.netTotalPrice = new MoneyValue.Builder()
                .withAmount(ctCart.taxedPrice.totalNet.centAmount)
                .withCurrency(ctCart.taxedPrice.totalNet.currencyCode)
                .build();
            cart.grossTotalPrice = new MoneyValue.Builder()
                .withAmount(ctCart.taxedPrice.totalGross.centAmount)
                .withCurrency(ctCart.taxedPrice.totalGross.currencyCode)
                .build();
        }

        cart.createdAt = ctCart.createdAt;
        cart.lastModifiedAt = ctCart.lastModifiedAt;
        cart.customerId = ctCart.customerId;
        if (ctCart.shippingAddress) {
            cart.shippingAddress = this._mapAddress(ctCart.shippingAddress);
        }
        if (ctCart.billingAddress) {
            cart.billingAddress = this._mapAddress(ctCart.billingAddress);
        }
        if (ctCart.discountCodes) {
            cart.coupons = this._mapCoupons(ctCart.discountCodes);
        }
        //shipping discount is added to the cart discounts.
        if (ctCart.shippingInfo) {
            cart.shippingInfo = this._mapShippingInfo(ctCart.shippingInfo);
            if (ctCart.shippingInfo.discountedPrice) {
                this._addCartDiscounts(cart, ctCart.shippingInfo.discountedPrice.includedDiscounts,
                    DiscountType.SHIPPING);
            }
        }
        if (ctCart.paymentInfo && ctCart.paymentInfo.payments) {
            cart.payments = this._mapPayments(ctCart.paymentInfo.payments);
            cart.payment = cart.payments.length > 0 ? cart.payments[0]: {};
        }
        if (ctCart.taxedPrice) {
            cart.taxInfo = this._mapTaxInfo(ctCart.taxedPrice);
            if (ctCart.lineItems && ctCart.lineItems.length > 0) {
                if (ctCart.lineItems[0].taxRate) {
                    cart.taxIncludedInPrices = ctCart.lineItems[0].taxRate.includedInPrice;
                }
            }
        }
        this._calculateTotalProductPrice(cart); // MUST be called after shippingInfo is added to the cart
        return cart;
    }

    /**
     * @private
     */
    _calculateTotalProductPrice(cart) {
        if (cart.shippingInfo) {
            if (cart.shippingInfo.discountedPrice) {
                cart.productTotalPrice.amount -= cart.shippingInfo.discountedPrice.amount;
            } else {
                cart.productTotalPrice.amount -= cart.shippingInfo.cost.amount;
            }
        }
    }

    /**
     * @private
     */
    _mapCartEntries(lineItems) {
        return lineItems.map(lineItem => {
            const type = (lineItem.lineItemMode === CartMapper.GIFT_LINE_ITEM ? CartEntryType.PROMOTION : CartEntryType.REGULAR);
            const unitPrice = new MoneyValue.Builder()
                .withAmount(lineItem.price.value.centAmount)
                .withCurrency(lineItem.price.value.currencyCode)
                .build();
            const price = new MoneyValue.Builder()
                .withAmount(lineItem.price.value.centAmount * lineItem.quantity)
                .withCurrency(lineItem.totalPrice.currencyCode)
                .build();
            const productVariant = this.productMapper.mapProductVariant(lineItem);
            const cartEntry = new CartEntry.Builder()
                .withId(lineItem.id)
                .withPrice(price)
                .withProductVariant(productVariant)
                .withQuantity(lineItem.quantity)
                .withType(type)
                .withUnitPrice(unitPrice)
                .build();

            if (lineItem.discountedPricePerQuantity && lineItem.discountedPricePerQuantity.length > 0) {
                cartEntry.discounts = this._mapCartEntryDiscounts(lineItem.discountedPricePerQuantity);
                cartEntry.discountedPrice = new MoneyValue.Builder()
                    .withAmount(lineItem.totalPrice.centAmount)
                    .withCurrency(lineItem.totalPrice.currencyCode)
                    .build();
            }

            if (lineItem.taxedPrice && lineItem.taxRate) {
                cartEntry.taxInfo = this._mapItemTaxInfo(lineItem.taxedPrice, lineItem.taxRate);
            }

            return cartEntry;
        });

    }

    /**
     * @param discountedPricePerQuantityArray
     * @return {Discount[]}
     * @private
     */
    _mapCartEntryDiscounts(discountedPricePerQuantityArray) {
        const map = new Map();

        discountedPricePerQuantityArray.forEach(discountedPricePerQuantity => {
            const quantity = discountedPricePerQuantity.quantity;

            discountedPricePerQuantity.discountedPrice.includedDiscounts.forEach(includedDiscount => {
                let id = includedDiscount.discount.id;
                if (!map.has(id)) {
                    const discount = this._mapDiscount(includedDiscount, DiscountType.CART_ENTRY);
                    discount.value.amount = 0;
                    map.set(id, discount);
                }
                map.get(id).value.amount += includedDiscount.discountedAmount.centAmount * quantity;
            });
        });

        return [...map.values()];
    }

    /**
     * @param includedDiscount          Value of included discount from CommerceTools. See
     *                                  https://dev.commercetools.com/http-api-projects-carts.html#discountedlineitemportion
     * @param {string} type             The CCIF type of discount
     * @returns {Discount}
     * @private
     */
    _mapDiscount(includedDiscount, type) {
        const value = new MoneyValue.Builder()
            .withAmount(includedDiscount.discountedAmount.centAmount)
            .withCurrency(includedDiscount.discountedAmount.currencyCode)
            .build();
        const discount = new Discount.Builder()
            .withValue(value)
            .withId(includedDiscount.discount.id)
            .withType(type)
            .build();

        if (includedDiscount.discount.obj) {
            if (includedDiscount.discount.obj.name) {
                discount.name = this.languageParser.pickLanguage(includedDiscount.discount.obj.name);
            }
            if (includedDiscount.discount.obj.description) {
                discount.description = this.languageParser.pickLanguage(includedDiscount.discount.obj.description);
            }
        }

        return discount;
    }

    /**
     *
     * @param ctAddress
     * @return {Address}    CCIF Address
     * @private
     */
    _mapAddress(ctAddress) {
        const address = new Address.Builder()
            .withCity(ctAddress.city)
            .withCountry(ctAddress.country)
            .withFirstName(ctAddress.firstName)
            .withId(ctAddress.id || '')
            .withLastName(ctAddress.lastName)
            .withPostalCode(ctAddress.postalCode)
            .withStreetName(ctAddress.streetName)
            .build();
        address.title = ctAddress.title;
        address.salutation = ctAddress.salutation;
        address.streetNumber = ctAddress.streetNumber;
        address.additionalStreetInfo = ctAddress.additionalStreetInfo;
        address.region = ctAddress.region;
        address.organizationName = ctAddress.company;
        address.department = ctAddress.department;
        address.phone = ctAddress.phone;
        address.mobile = ctAddress.mobile;
        address.email = ctAddress.email;
        address.fax = ctAddress.fax;
        address.additionalAddressInfo = ctAddress.additionalAddressInfo;
        return address;
    }

    /**
     * Maps array of cart coupon codes to CIF coupons.
     * 
     * @param {string} ctCoupons    Array of JSON representation of CommerceTools coupons.
     * @returns {Array}             returns array of Coupon instances.
     * @private
     */
    _mapCoupons(ctCoupons) {
        return ctCoupons.map(ctCoupon => {
            return this.couponMapper.mapCoupon(ctCoupon.discountCode.obj);
        });
    }

    /**
     *
     * @param ctShippingInfo
     * @return {ShippingInfo} CCIF ShippingInfo
     * @private
     */
    _mapShippingInfo(ctShippingInfo) {
        let id = null;
        let taxInfo = null;

        let cost = new MoneyValue.Builder()
            .withAmount(ctShippingInfo.price.centAmount)
            .withCurrency(ctShippingInfo.price.currencyCode)
            .build();

        if (ctShippingInfo.shippingMethod) {
            id = ctShippingInfo.shippingMethod.id;
        }

        if (ctShippingInfo.taxedPrice && ctShippingInfo.taxRate) {
            taxInfo = this._mapItemTaxInfo(ctShippingInfo.taxedPrice, ctShippingInfo.taxRate);
        }

        let shippingInfo = new ShippingInfo.Builder()
            .withId(id)
            .withName(ctShippingInfo.shippingMethodName)
            .withCost(cost)
            .withTaxInfo(taxInfo)
            .build();

        if (ctShippingInfo.discountedPrice) {
            shippingInfo.discountedPrice = new MoneyValue.Builder()
                .withAmount(ctShippingInfo.discountedPrice.value.centAmount)
                .withCurrency(ctShippingInfo.discountedPrice.value.currencyCode)
                .build();
        }

        return shippingInfo;
    }

    /**
     * Adds discounts(like shipping discounts) to the cart discounts.
     *
     * @param {Cart} cart
     * @param ctDiscounts               DiscountedLineItemPortion from CommerceTools response. See
     *                                  https://dev.commercetools.com/http-api-projects-carts.html#discountedlineitemportion
     * @param {string} discountType
     * @private
     */
    _addCartDiscounts(cart, ctDiscounts, discountType) {
        cart.discounts.push(...ctDiscounts.map(includedDiscount => {
            return this._mapDiscount(includedDiscount, discountType);
        }));
    }

    /**
     * Maps the payment received from CT to CCIF Model. If more than one payment is found in the Commerce Tools cart an
     * UnexpectedError is thrown.
     *
     * @param ctPayments
     * @private
     */
    _mapPayments(ctPayments) {
        return ctPayments.map(p => this.paymentMapper._mapPayment(p.obj));

    }

    /**
     * Maps CommerceTools taxed price and rate to Commerce Integration Framework TaxInfo. This mapping applies for cart
     * items like cart entries or shipping info.
     *
     * @param ctTaxedPrice  Commerce Tools taxed price.
     * @param ctTaxRate     Commerce Tools tax rate.
     * @return {TaxInfo}    Commerce Integration Framework tax info.
     * @private
     */
    _mapItemTaxInfo(ctTaxedPrice, ctTaxRate) {
        let name = ctTaxRate.name;
        let amount = ctTaxedPrice.totalGross.centAmount - ctTaxedPrice.totalNet.centAmount;

        let value = new MoneyValue.Builder()
            .withAmount(amount)
            .withCurrency(ctTaxRate.currencyCode);

        let taxInfo = new TaxInfo.Builder()
            .withValue(value).build();
        let taxPortion = new TaxPortion.Builder()
            .withValue(value)
            .withName(name)
            .build();
        taxInfo.portions = [];
        taxInfo.portions.push(taxPortion);

        return taxInfo;
    }

    /**
     * Maps CommerceTools taxed price and tax portion to Commerce Integration Framework TaxInfo. This mapping applies
     * for cart tax summary.
     *
     * @param ctTaxedPrice  Commerce Tools cart taxed price
     * @param ctTaxPortions Commerce Tools cart tax portions
     * @return {TaxInfo}    Commerce Integration Framework tax info.
     * @private
     */
    _mapTaxInfo(ctTaxedPrice) {

        let amount = ctTaxedPrice.totalGross.centAmount - ctTaxedPrice.totalNet.centAmount;
        let value = new MoneyValue.Builder()
            .withAmount(amount)
            .withCurrency(ctTaxedPrice.totalGross.currencyCode)
            .build();

        let taxInfo = new TaxInfo.Builder()
            .withValue(value)
            .build();
        taxInfo.portions = [];

        if (ctTaxedPrice.portions) {
            taxInfo.portions.push(...ctTaxedPrice.portions.map(ctTaxPortion => {
                return new TaxPortion.Builder()
                    .withValue(new TaxPortion.Builder()
                        .withAmount(ctTaxPortion.amount.centAmount)
                        .withCurrency(ctTaxPortion.amount.currencyCode))
                    .withName(ctTaxPortion.name)
                    .build();
            }));
        }

        return taxInfo;
    }
}

module.exports = CartMapper;