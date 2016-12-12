'use strict';

const hfc = require('hfc');
const Asset = require(__dirname+'/../../../tools/utils/asset');

let tracing = require(__dirname+'/../../../tools/traces/trace.js');
let map_ID = require(__dirname+'/../../../tools/map_ID/map_ID.js');
let initial_assets = require(__dirname+'/../../../blockchain/assets/assets/initial_assets.js');
let fs = require('fs');

const TYPES = [
    'miner_to_distributor',
    'distributor_to_dealership',
    'dealership_to_buyer',
    'buyer_to_trader',
    'trader_to_cutter',
'cutter_to_jewellery_maker',
'jewellery_maker_to_customer'

];

let assetData;

function create(req, res, next, usersToSecurityContext) {
    try {
        let chain = hfc.getChain('myChain');
        assetData = new Asset(usersToSecurityContext);

        let diamonds;
        res.write(JSON.stringify({message:'Creating assets'})+'&&');
        fs.writeFileSync(__dirname+'/../../../logs/demo_status.log', '{"logs": []}');

        tracing.create('ENTER', 'POST admin/demo', req.body);

        let scenario = req.body.scenario;

        if(scenario === 'simple' || scenario === 'full') {
            diamonds = initial_assets[scenario];
        } else {
            let error = {};
            error.message = 'Scenario type not recognised';
            error.error = true;
            res.end(JSON.stringify(error));
            return;
        }

        if(diamonds.hasOwnProperty('diamonds')) {
            tracing.create('INFO', 'Demo', 'Found diamonds');
            diamonds = diamonds.diamonds;
            let assetIDResults;
            updateDemoStatus({message: 'Creating assets'});
            chain.getEventHub().connect();
            return createAssets(diamonds)
            .then(function(results) {
                assetIDResults = results;
                return assetIDResults.reduce(function(prev, assetID, index) {
                    let Diamond = diamonds[index];
                    let seller = map_ID.user_to_id('Kollur');
                    let buyer = map_ID.user_to_id(Diamond.Owners[1]);
                    return prev.then(function() {
                        return transferAsset(assetID, seller, buyer, 'authority_to_distributor');
                    });
                }, Promise.resolve());
            })
            .then(function() {
                updateDemoStatus({message: 'Updating assets'});
                return assetIDResults.reduce(function(prev, assetID, index){
                    let Diamond = diamonds[index];
                    return prev.then(function() {
                        return populateAsset(assetID, Diamond);
                    });
                }, Promise.resolve());
            })
            .then(function() {
                updateDemoStatus({message: 'Transfering assets between owners'});
                return assetIDResults.reduce(function(prev, assetID, index) {
                    let Diamond = diamonds[index];
                    return prev.then(function() {
                        return transferBetweenOwners(assetID, Diamond);
                    });
                }, Promise.resolve());
            })
            .then(function() {
                updateDemoStatus({message: 'Demo setup'});
                chain.getEventHub().disconnect();
                res.end(JSON.stringify({message: 'Demo setup'}));
            })
            .catch(function(err) {
                tracing.create('ERROR   DEMO', err, '');
                updateDemoStatus({'message: ': JSON.parse(err), error: true});
                tracing.create('ERROR', 'POST admin/demo', err.stack);
                chain.getEventHub().disconnect();
                res.end(JSON.stringify(err));
            });
        } else {
            let error = {};
            error.message = 'Initial assets not found';
            error.error = true;
            updateDemoStatus({'message: ': JSON.parse(error), error: true});
            res.end(JSON.stringify(error));
            return;
        }
    } catch (e) {
        console.log(e);
    }
}

function transferBetweenOwners(assetID, Diamond, results) {
    let functionName;
    let newDiamond = JSON.parse(JSON.stringify(Diamond));
    if (!results) {
        results = [];
    }
    if (newDiamond.Owners.length > 2) {
        let seller = map_ID.user_to_id(newDiamond.Owners[1]); // First after Kollur
        let buyer = map_ID.user_to_id(newDiamond.Owners[2]); // Second after Kollur
        functionName = TYPES[results.length + 1];
        return transferAsset(assetID, seller, buyer, functionName)
        .then(function(result) {
            console.log('[#] Transfer asset ' + assetID + ' between ' + seller + ' -> ' + buyer);
            results.push(result);
            newDiamond.Owners.shift();
            return transferBetweenOwners(assetID, newDiamond, results);
        });
    } else {
        return Promise.resolve(results);
    }
}

// Uses recurision because Promise.all() breaks HFC
function createAssets(diamonds, results) {
    let newdiamonds = JSON.parse(JSON.stringify(diamonds));
    if (!results) {results = [];}
    if (newdiamonds.length > 0) {
        return createAsset()
            .then(function(result) {
                console.log('[#] Created asset ' + result);
                results.push(result);
                newdiamonds.pop();
                return createAssets(newdiamonds, results);
            });
    } else {
        return Promise.resolve(results);
    }
}

function createAsset() {
    console.log('[#] Creating Asset');
    return assetData.create('Kollur');
}

function populateAssetProperty(assetID, ownerId, propertyName, propertyValue) {
    let normalisedPropertyName = propertyName.toLowerCase();
    return assetData.updateAttribute(ownerId, 'update_'+normalisedPropertyName, propertyValue, assetID);
}

function populateAsset(assetID, Diamond) {
    console.log('[#] Populating Asset');
    let result = Promise.resolve();
    for(let propertyName in Diamond) {
        let normalisedPropertyName = propertyName.toLowerCase();
        let propertyValue = Diamond[propertyName];
        if (propertyName !== 'Owners') {
            result = result.then(function() {
                return populateAssetProperty(assetID, map_ID.user_to_id(Diamond.Owners[1]), normalisedPropertyName, propertyValue);
            });
        }
    }
    return result;
}

function transferAsset(assetID, seller, buyer, functionName) {
    console.log('[#] Transfering Asset to ' + buyer);
    return assetData.transfer(seller, buyer, functionName, assetID);
}

function updateDemoStatus(status) {
    try {
        let statusFile = fs.readFileSync(__dirname+'/../../../logs/demo_status.log');
        let demoStatus = JSON.parse(statusFile);
        demoStatus.logs.push(status);
        fs.writeFileSync(__dirname+'/../../../logs/demo_status.log', JSON.stringify(demoStatus));

        if(!status.hasOwnProperty('error')) {
            if(status.message === 'Demo setup') {
                tracing.create('EXIT', 'POST admin/demo', status);
            } else {
                tracing.create('INFO', 'POST admin/demo', status.message);
            }
        } else {
            tracing.create('ERROR', 'POST admin/demo', status);
        }
    } catch (e) {
        console.log(e);
    }
}

exports.create = create;
