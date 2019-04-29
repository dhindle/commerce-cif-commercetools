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

const Product = require('@adobe/commerce-cif-model').Product;
const MoneyValue = require('@adobe/commerce-cif-model').MoneyValue;
const Asset = require('@adobe/commerce-cif-model').Asset;
const Attribute = require('@adobe/commerce-cif-model').Attribute;
const ProductVariant = require('@adobe/commerce-cif-model').ProductVariant;
const Category = require('@adobe/commerce-cif-model').Category;
const PagedResponse = require('@adobe/commerce-cif-model').PagedResponse;
const Facet = require('@adobe/commerce-cif-model').Facet;
const FacetValue = require('@adobe/commerce-cif-model').FacetValue;
const MissingPropertyException = require('@adobe/commerce-cif-common/exception').MissingPropertyException;

/**
 * Utility class to map commercetools objects to CCIF objects. Private marked methods should not be used outside
 * of this class.
 */
class ProductMapper {

    /**
     * Constructor.
     * 
     * @param {LanguageParser} languageParser LanguageParser reference
     */
    constructor(languageParser) {
        this.languageParser = languageParser;
    }

    /**
     * Maps a commercetools products search to a PagedResponse
     *
     * @param ctResult              JSON object returned by the commercetools product search.
     * @returns {PagedResponse}     A paged response with products.
     */
    mapPagedProductResponse(result, args) {

        let results = this.mapProducts(result.body.results, args);
        let pr = new PagedResponse.Builder()
            .withCount(result.body.count)
            .withOffset(result.body.offset || 0)
            .withTotal(result.body.total)
            .withResults(results)
            .build();
        if (result.body.facets && Object.keys(result.body.facets).length > 0) {
            let availableFacets = this.getProductFacets(result);
            pr.facets = this._mapFacets(result.body.facets, availableFacets, args);
        }

        return pr;
    }

    /**
     * Maps an array of commercetools products to an array of CCIF products
     *
     * @param ctProducts            JSON array of commercetools products.
     * @returns {Product}           An array of CCIF products.
     */
    mapProducts(ctProducts) {
        return ctProducts.map(ctProduct => this._mapProduct(ctProduct));
    }

    /**
     * Maps a single commercetools product to a CCIF product.
     *
     * @param response              JSON response with commercetools product, containing the body enclosing property.
     * @param args                  OpenWhisk action arguments
     * @returns {Product}           A CCIF product.
     */
    mapProduct(response) {
        return this._mapProduct(response.body);
    }

    /**
     * Reused from mapProduct and mapProducts.
     *
     * @private
     */
    _mapProduct(ctProduct) {
        if (ctProduct.id === undefined) {
            console.error('id missing for commercetools product', ctProduct);
            throw new MissingPropertyException('id missing for commercetools product');
        }
        if (ctProduct.masterVariant === undefined || ctProduct.masterVariant.id === undefined) {
            console.error('master variant missing for commercetools product', ctProduct);
            throw new MissingPropertyException('master variant missing for commercetools product');
        }

        let masterVariantId = ctProduct.id + '-' + ctProduct.masterVariant.id;
        let name = this.languageParser.pickLanguage(ctProduct.name) || "";
        let product = new Product.Builder()
            .withId(ctProduct.id)
            .withMasterVariantId(masterVariantId)
            .withName(name)
            .withPrices([])
            .withVariants(this._mapProductVariants(ctProduct))
            .build();
        if (ctProduct.description) {
            product.description = this.languageParser.pickLanguage(ctProduct.description);
        }
        product.slug = this.languageParser.pickLanguage(ctProduct.slug);
        product.createdAt = ctProduct.createdAt;
        product.lastModifiedAt = ctProduct.lastModifiedAt;
        product.categories = this._mapProductCategories(ctProduct.categories);
        return product;
    }

    /**
     * Maps a CommerceTools cart line item to a CCIF product variant
     *
     * @param ctLineItem            A CommerceTools cart line item.
     * @returns {ProductVariant}    A CCIF product variant.
     */

    mapProductVariant(ctLineItem) {
        let attributesTypes = [];
        if (ctLineItem.productType.obj) {
            attributesTypes = this._extractAttributesTypes(ctLineItem);
        }

        // TODO: Get actual value from backend
        let available = true;
        let name = this.languageParser.pickLanguage(ctLineItem.name) || "";
        let prices = this._mapPrices(ctLineItem.variant.prices);

        let v = new ProductVariant.Builder()
            .withAvailable(available)
            .withId(ctLineItem.productId + '-' + ctLineItem.variant.id)
            .withName(name)
            .withPrices(prices)
            .withSku(ctLineItem.variant.sku)
            .build();

        v.slug = this.languageParser.pickLanguage(ctLineItem.productSlug);
        v.assets = this._mapImages(ctLineItem.variant.images);
        v.attributes = this._mapAttributes(attributesTypes, ctLineItem.variant.attributes);
        return v;
    }

    /**
     * Determines CommmerceTools list of facets based on product type attributes. Used to auto-discover the product type facets.
     *
     * @param results
     * @return {Array}
     */
    getProductFacets(result) {
        let facets = [];
        if (result && result.body.count > 0) {
            result.body.results[0].productType.obj.attributes.forEach(attribute => {
                if (attribute.isSearchable === true) {
                    let facet = new Facet.Builder()
                        .withId(`variants.attributes.${attribute.name}.en`)
                        .withName(this.languageParser.pickLanguage(attribute.label) || attribute.id)
                        .withType(null)
                        .withValues(null)
                        .build();
                    facets.push(facet);
                }
            });
        }

        facets.push(this._initProductFacet('categories.id', 'Category'));
        facets.push(this._initProductFacet('variants.prices.value.centAmount', 'Price'));

        return facets;
    }

    /**
     * @private
     */
    _mapProductVariants(ctProduct) {
        let attributesTypes = [];
        if (ctProduct.productType.obj) {
            attributesTypes = this._extractAttributesTypes(ctProduct);
        }

        let variants = [];
        // make sure the default variant is included in the variants;
        variants.push(this._mapProductVariant(ctProduct, ctProduct.masterVariant, attributesTypes));
        return variants.concat(ctProduct.variants.map(variant => {
            return this._mapProductVariant(ctProduct, variant, attributesTypes);
        }));
    }

    /**
     * @private
     */
    _mapProductVariant(ctProduct, variant, attributesTypes) {
        // TODO: Get actual value from backend
        let available = true;
        let name = this.languageParser.pickLanguage(variant.name) || this.languageParser.pickLanguage(ctProduct.name) || "";
        let prices = this._mapPrices(variant.prices);

        let v = new ProductVariant.Builder()
                .withAvailable(available)
                .withId(ctProduct.id + '-' + variant.id)
                .withName(name)
                .withPrices(prices)
                .withSku(variant.sku)
                .build();

        if (variant.description) {
            v.description = this.languageParser.pickLanguage(variant.description);
        }

        v.assets = this._mapImages(variant.images);
        v.attributes = this._mapAttributes(attributesTypes, variant.attributes);
        return v;
    }

    /**
     * @private
     */
    _mapProductCategories(categories) {
        if (categories) {
            return categories.map(category => {
                return new Category.Builder().withId(category.id).build();
            });
        }
    }

    /**
     * @private
     */
    _isVariantAttributeConstraint(attributeConstraint) {
        return attributeConstraint === 'Unique' || attributeConstraint === 'CombinationUnique';
    }

    /**
     * @private
     */
    _extractAttributesTypes(container) {
        return container.productType.obj.attributes
            .map(attribute => {
                return {
                    id: attribute.name,
                    name: this.languageParser.pickLanguage(attribute.label),
                    isVariantAxis: this._isVariantAttributeConstraint(attribute.attributeConstraint),
                    isLocalizedString: attribute.type && attribute.type.name == 'ltext'
                }
            });
    }

    /**
     * @private
     */
    _mapPrices(prices) {
        if (prices) {
            return prices.map(price => {
                let p = new MoneyValue.Builder()
                    .withAmount(price.value.centAmount)
                    .withCurrency(price.value.currencyCode)
                    .build();
                p.country = price.country;
                return p;
            });
        }
    }

    /**
     * @private
     */
    _mapImages(images) {
        if (images) {
            return images.map(image => {
                let id = '';
                if (image.id) {
                    id = image.id;
                } else {
                    id = image.url.substring(image.url.lastIndexOf('/') + 1);
                }
                let assets = new Asset.Builder()
                    .withId(id)
                    .withUrl(image.url)
                    .build();
                return assets;
            });
        }
    }

    /**
     * @private
     */
    _mapAttributes(attributesTypes, attributes) {
        if (attributesTypes && attributes) {
            return attributes.map(attribute => {
                let type = attributesTypes.find(attributeType => attributeType.id == attribute.name);
                if (type) {
                    let value = type.isLocalizedString ? this.languageParser.pickLanguage(attribute.value) : attribute.value;
                    let attr = new Attribute.Builder()
                        .withId(type.id)
                        .withName(type.name)
                        .withValue(value)
                        .build();
                    attr.isVariantAxis = type.isVariantAxis;
                    return attr;
                } else {
                    return new Attribute.Builder()
                        .withId(attribute.name)
                        .withName(null)
                        .withValue(this.languageParser.pickLanguage(attribute.value))
                        .build();
                }
            });
        }
    }

    /**
     * @private
     */
    _mapFacets(ctFacets, availableFacets, args) {
        if (!ctFacets || !availableFacets) {
            return;
        }

        let cifFacet;
        const ctFacetLabels = new Map(availableFacets.map(facet => [facet.id, facet.name]));
        const ctFacetNames = Object.keys(ctFacets);
        return ctFacetNames.map(facetName => {
            let type = null;
            let values = null;
            if (ctFacets[facetName].type === 'range') {
                type = ctFacets[facetName].type;
                values = ctFacets[facetName].ranges.map(range => {
                    let facetValue = `${range.from}-${range.to}`;
                    return this._getCifFacetValue(`${facetName}.${facetValue}`, facetValue, facetName, range.productCount, args);
                });
            } else {
                type = ctFacets[facetName].dataType;
                values = ctFacets[facetName].terms.map(ctTerm => {
                    return this._getCifFacetValue(`${facetName}.${ctTerm.term}`, ctTerm.term, facetName, ctTerm.productCount, args);
                });
            }

            cifFacet = new Facet.Builder()
                .withId(facetName)
                .withName(this.languageParser.pickLanguage(ctFacets[facetName].label) || ctFacetLabels.get(facetName) || facetName)
                .withType(type)
                .withValues(values)
                .build();
            cifFacet.missed = ctFacets[facetName].missing;

            return cifFacet;
        });
    }

    /**
     *
     * @private
     */
    _getCifFacetValue(valueId, facetValue, facetName, count, args) {

        let cifFacetValue = new FacetValue.Builder()
            .withId(valueId)
            .withValue(facetValue)
            .build();
        cifFacetValue.occurrences = count;
        if (args) {
            let selectedFacets = args.selectedFacets ? args.selectedFacets.split('|') : [];
            selectedFacets.forEach(facet => {
                if (facet.substring(0, facet.indexOf(':')) === facetName) {
                    if (this._getSelectedFacetValue(facet).includes(cifFacetValue.value)) {
                        cifFacetValue.selected = true;
                    }
                }
            });
        }

        return cifFacetValue;
    }

    /**
     *
     * @private
     */
    _initProductFacet(name, label) {
        return new Facet.Builder()
            .withId(name)
            .withName(this.languageParser.pickLanguage(label) || name)
            .withType(null)
            .withValues(null)
            .build();
    }

    /**
     * Example of selected facet values:
     *  - variants.prices.value.centAmount:range (5000 to 15000)
     *  - variants.attributes.color.en: "purple","red"
     *
     * @param selectedFacet
     * @return {Array} of values for the facets
     * @private
     */
    _getSelectedFacetValue(selectedFacet) {
        //removes any space and splits the facets values
        let facetValues = selectedFacet.replace(/\s/g, '').substring(selectedFacet.indexOf(':') + 1).split(',');
        if (selectedFacet.includes(':range')) {
            return facetValues.map(facetValue => {
                //transform  facet range values 'range (5000 to 15000)' to '5000-15000'
                return  facetValue.replace(/range\(([\d]+)to([\d]+)\)/g, '$1-$2');
            });
        } else {
            return facetValues.map(facetValue => {
                return facetValue.replace(/"/g, '');
            });
        }

    }
}

module.exports = ProductMapper;
