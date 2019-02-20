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

const createClient = require('@commercetools/sdk-client').createClient;
const CommerceToolsCategory = require('./CommerceToolsCategory');
const CategoryMapper = require('./CategoryMapper');
const LanguageParser = require('@adobe/commerce-cif-commercetools-common/LanguageParser');
const InputValidator = require('@adobe/commerce-cif-common/input-validator');
const ERROR_TYPE = require('./constants').ERROR_TYPE;
const CommerceServiceBadRequestError = require('@adobe/commerce-cif-common/exception').CommerceServiceBadRequestError;
const CommerceServiceResourceNotFoundError = require('@adobe/commerce-cif-common/exception').CommerceServiceResourceNotFoundError;

/**
 * This action retrieves a commerceTools category by slug.
 *
 * @param   {string} args.CT_PROJECTKEY        commerceTools project key
 * @param   {string} args.CT_CLIENTID          commerceTools client id
 * @param   {string} args.CT_CLIENTSECRET      commerceTools client secret
 * @param   {string} args.CT_API_HOST          optional commerceTools API host uri
 * @param   {string} args.CT_AUTH_HOST         optional commerceTools AUTH host uri
 *
 * @param   {string} args.slug                 the category slug
 *
 * @return  {Promise.<Category>}               the Category object
 */
function getCategoryBySlug(args) {
    const validator = new InputValidator(args, ERROR_TYPE);
    const error = validator
        .checkArguments()
        .mandatoryParameter('slug')
        .error;
    if (error) {
        return validator.buildErrorResponse();
    }

    let slug = args.slug;
    let languageParser = new LanguageParser(args);
    let tag = languageParser.getFirstLanguageTag();
    let categoryMapper = new CategoryMapper(languageParser);
    let commerceToolsCategory = new CommerceToolsCategory(args, createClient, categoryMapper.mapPagedCategoryResponse.bind(categoryMapper));

    return commerceToolsCategory
        .where(`slug(${tag}="${slug}")`)
        .get()
        .then(data => {
            let error;
            if (data.response.body.count == 1) {
                return commerceToolsCategory._handleSuccess(data.response.body.results[0]);
            } else if (data.response.body.count == 0) {
                error = new CommerceServiceResourceNotFoundError(`Could not find a category with slug '${slug}' and language tag '${tag}'`);
            } else if (data.response.body.count > 1) {
                error = new CommerceServiceBadRequestError(`The request with slug '${slug}' matches multiple categories`);
            }
            return commerceToolsCategory.handleInternalError(error);
        });
}

module.exports.main = getCategoryBySlug;