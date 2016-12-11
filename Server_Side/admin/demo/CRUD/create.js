'use strict';

const hfc = require('hfc');
const Asset = require(__dirname+'/../../../tools/utils/asset');

let tracing = require(__dirname+'/../../../tools/traces/trace.js');
let map_ID = require(__dirname+'/../../../tools/map_ID/map_ID.js');
let initial_assets = require(__dirname+'/../../../blockchain/assets/assets/initial_assets.js');
let fs = require('fs');

const TYPES = [
    'regulator_to_manufacturer',
    'manufacturer_to_private',
    'private_to_lease_company',
    'lease_company_to_private',
    'private_to_scrap_merchant'
];

let assetData;

function create(req, res, next, usersToSecurityContext) {
    try {
        let chain = hfc.getChain('myChain');
        assetData = new Asset(usersToSecurityContext);

        let cars;
        res.write(JSON.stringify({message:'Creating assets'})+'&&');
        fs.writeFileSync(__dirname+'/../../../logs/demo_status.log', '{"logs": []}');

        tracing.create('ENTER', 'POST admin/demo', req.body);

        let scenario = req.body.scenario;

        if(scenario === 'simple' || scenario === 'full') {
            cars = initial_assets[scenario];
        } else {
            let error = {};
            error.message = 'Scenario type not recognised';
            error.error = true;
            res.end(JSON.stringify(error));
            return;
        }

        if(cars.hasOwnProperty('cars')) {
            tracing.create('INFO', 'Demo', 'Found cars');
            cars = cars.cars;
            let v5cIDResults;
            updateDemoStatus({message: 'Creating assets'});
            chain.getEventHub().connect();
            return createAssets(cars)
            .then(function(results) {
                v5cIDResults = results;
                return v5cIDResults.reduce(function(prev, v5cID, index) {
                    let car = cars[index];
                    let seller = map_ID.user_to_id('DVLA');
                    let buyer = map_ID.user_to_id(car.Owners[1]);
                    return prev.then(function() {
                        return transferAsset(v5cID, seller, buyer, 'authority_to_manufacturer');
                    });
                }, Promise.resolve());
            })
            .then(function() {
                updateDemoStatus({message: 'Updating assets'});
                return v5cIDResults.reduce(function(prev, v5cID, index){
                    let car = cars[index];
                    return prev.then(function() {
                        return populateAsset(v5cID, car);
                    });
                }, Promise.resolve());
            })
            .then(function() {
                updateDemoStatus({message: 'Transfering assets between owners'});
                return v5cIDResults.reduce(function(prev, v5cID, index) {
                    let car = cars[index];
                    return prev.then(function() {
                        return transferBetweenOwners(v5cID, car);
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

function transferBetweenOwners(v5cID, car, results) {
    let functionName;
    let newCar = JSON.parse(JSON.stringify(car));
    if (!results) {
        results = [];
    }
    if (newCar.Owners.length > 2) {
        let seller = map_ID.user_to_id(newCar.Owners[1]); // First after DVLA
        let buyer = map_ID.user_to_id(newCar.Owners[2]); // Second after DVLA
        functionName = TYPES[results.length + 1];
        return transferAsset(v5cID, seller, buyer, functionName)
        .then(function(result) {
            console.log('[#] Transfer asset ' + v5cID + ' between ' + seller + ' -> ' + buyer);
            results.push(result);
            newCar.Owners.shift();
            return transferBetweenOwners(v5cID, newCar, results);
        });
    } else {
        return Promise.resolve(results);
    }
}

// Uses recurision because Promise.all() breaks HFC
function createAssets(cars, results) {
    let newCars = JSON.parse(JSON.stringify(cars));
    if (!results) {results = [];}
    if (newCars.length > 0) {
        return createAsset()
            .then(function(result) {
                console.log('[#] Created asset ' + result);
                results.push(result);
                newCars.pop();
                return createAssets(newCars, results);
            });
    } else {
        return Promise.resolve(results);
    }
}

function createAsset() {
    console.log('[#] Creating Asset');
    return assetData.create('DVLA');
}

function populateAssetProperty(v5cID, ownerId, propertyName, propertyValue) {
    let normalisedPropertyName = propertyName.toLowerCase();
    return assetData.updateAttribute(ownerId, 'update_'+normalisedPropertyName, propertyValue, v5cID);
}

function populateAsset(v5cID, car) {
    console.log('[#] Populating Asset');
    let result = Promise.resolve();
    for(let propertyName in car) {
        let normalisedPropertyName = propertyName.toLowerCase();
        let propertyValue = car[propertyName];
        if (propertyName !== 'Owners') {
            result = result.then(function() {
                return populateAssetProperty(v5cID, map_ID.user_to_id(car.Owners[1]), normalisedPropertyName, propertyValue);
            });
        }
    }
    return result;
}

function transferAsset(v5cID, seller, buyer, functionName) {
    console.log('[#] Transfering Asset to ' + buyer);
    return assetData.transfer(seller, buyer, functionName, v5cID);
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
