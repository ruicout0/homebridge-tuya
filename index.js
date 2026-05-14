import TuyaAccessory from './lib/TuyaAccessory.js';
import TuyaDiscovery from './lib/TuyaDiscovery.js';

import OutletAccessory from './lib/OutletAccessory.js';
import SimpleLightAccessory from './lib/SimpleLightAccessory.js';
import MultiOutletAccessory from './lib/MultiOutletAccessory.js';
import CustomMultiOutletAccessory from './lib/CustomMultiOutletAccessory.js';
import RGBTWLightAccessory from './lib/RGBTWLightAccessory.js';
import RGBTWOutletAccessory from './lib/RGBTWOutletAccessory.js';
import TWLightAccessory from './lib/TWLightAccessory.js';
import AirConditionerAccessory from './lib/AirConditionerAccessory.js';
import AirPurifierAccessory from './lib/AirPurifierAccessory.js';
import DehumidifierAccessory from './lib/DehumidifierAccessory.js';
import ConvectorAccessory from './lib/ConvectorAccessory.js';
import GarageDoorAccessory from './lib/GarageDoorAccessory.js';
import SimpleDimmerAccessory from './lib/SimpleDimmerAccessory.js';
import SimpleDimmer2Accessory from './lib/SimpleDimmer2Accessory.js';
import SimpleBlindsAccessory from './lib/SimpleBlindsAccessory.js';
import SimpleHeaterAccessory from './lib/SimpleHeaterAccessory.js';
import SimpleFanAccessory from './lib/SimpleFanAccessory.js';
import SimpleFanLightAccessory from './lib/SimpleFanLightAccessory.js';
import SwitchAccessory from './lib/SwitchAccessory.js';
import ValveAccessory from './lib/ValveAccessory.js';
import OilDiffuserAccessory from './lib/OilDiffuserAccessory.js';
import createEnergyCharacteristics from './lib/EnergyCharacteristics.js';

const PLUGIN_NAME = 'homebridge-tuya';
const PLATFORM_NAME = 'TuyaLan';

const CLASS_DEF = {
    outlet: OutletAccessory,
    simplelight: SimpleLightAccessory,
    rgbtwlight: RGBTWLightAccessory,
    rgbtwoutlet: RGBTWOutletAccessory,
    twlight: TWLightAccessory,
    multioutlet: MultiOutletAccessory,
    custommultioutlet: CustomMultiOutletAccessory,
    airconditioner: AirConditionerAccessory,
    airpurifier: AirPurifierAccessory,
    dehumidifier: DehumidifierAccessory,
    convector: ConvectorAccessory,
    garagedoor: GarageDoorAccessory,
    simpledimmer: SimpleDimmerAccessory,
    simpledimmer2: SimpleDimmer2Accessory,
    simpleblinds: SimpleBlindsAccessory,
    simpleheater: SimpleHeaterAccessory,
    switch: SwitchAccessory,
    fan: SimpleFanAccessory,
    fanlight: SimpleFanLightAccessory,
    watervalve: ValveAccessory,
    oildiffuser: OilDiffuserAccessory
};

let Characteristic, PlatformAccessory, Service, Categories, AdaptiveLightingController, UUID;

export default function(homebridge) {
    ({
        platformAccessory: PlatformAccessory,
        hap: {Characteristic, Service, AdaptiveLightingController, Accessory: {Categories}, uuid: UUID}
    } = homebridge);

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TuyaLan, true);
}

class TuyaLan {
    constructor(...props) {
        [this.log, this.config, this.api] = [...props];

        // Store HAP references from API (reliable in Homebridge 2.0)
        const {Characteristic: C, Service: S, Accessory: {Categories: Cat}, uuid: U} = this.api.hap;
        Characteristic = C;
        Service = S;
        Categories = Cat;
        UUID = U;
        PlatformAccessory = this.api.platformAccessory;

        this.cachedAccessories = new Map();
        this.api.hap.EnergyCharacteristics = createEnergyCharacteristics(Characteristic);

        if(!this.config || !this.config.devices) {
            this.log("No devices found. Check that you have specified them in your config.json file.");
            return false;
        }

        this._expectedUUIDs = this.config.devices.map(device => UUID.generate(PLUGIN_NAME +(device.fake ? ':fake:' : ':') + device.id));

        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
    }

    discoverDevices() {
        const devices = {};
        const connectedDevices = [];
        const fakeDevices = [];
        this.config.devices.forEach(device => {
            try {
                device.id = ('' + device.id).trim();
                device.key = ('' + device.key).trim();
                device.type = ('' + device.type).trim();

                device.ip = ('' + (device.ip || '')).trim();
            } catch(ex) {}

            if (!device.type) return this.log.error('%s (%s) doesn\'t have a type defined.', device.name || 'Unnamed device', device.id);
            if (!CLASS_DEF[device.type.toLowerCase()]) return this.log.error('%s (%s) doesn\'t have a valid type defined.', device.name || 'Unnamed device', device.id);

            if (device.fake) fakeDevices.push({name: device.id.slice(8), ...device});
            else devices[device.id] = {name: device.id.slice(8), ...device};
        });

        const deviceIds = Object.keys(devices);
        if (deviceIds.length === 0) return this.log.error('No valid configured devices found.');

        this.log.info('Starting discovery...');

        TuyaDiscovery.start({ids: deviceIds, log: this.log})
            .on('discover', config => {
                if (!config || !config.id) return;
                if (!devices[config.id]) return this.log.warn('Discovered a device that has not been configured yet (%s@%s).', config.id, config.ip);

                connectedDevices.push(config.id);

                this.log.info('Discovered %s (%s) identified as %s (%s)', devices[config.id].name, config.id, devices[config.id].type, config.version);

                const device = new TuyaAccessory({
                    ...devices[config.id], ...config,
                    log: this.log,
                    UUID: UUID.generate(PLUGIN_NAME + ':' + config.id),
                    connect: false
                });
                this.addAccessory(device);
            });

        fakeDevices.forEach(config => {
            this.log.info('Adding fake device: %s', config.name);
            this.addAccessory(new TuyaAccessory({
                ...config,
                log: this.log,
                UUID: UUID.generate(PLUGIN_NAME + ':fake:' + config.id),
                connect: false
            }));
        });

        setTimeout(() => {
            deviceIds.forEach(deviceId => {
                if (connectedDevices.includes(deviceId)) return;

                if (devices[deviceId].ip) {

                    this.log.info('Failed to discover %s (%s) in time but will connect via %s.', devices[deviceId].name, deviceId, devices[deviceId].ip);

                    const device = new TuyaAccessory({
                        ...devices[deviceId],
                        log: this.log,
                        UUID: UUID.generate(PLUGIN_NAME + ':' + deviceId),
                        connect: false
                    });
                    this.addAccessory(device);
                } else {
                    this.log.warn('Failed to discover %s (%s) in time but will keep looking.', devices[deviceId].name, deviceId);
                }
            });
        }, 60000);
    }

    registerPlatformAccessories(platformAccessories) {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, Array.isArray(platformAccessories) ? platformAccessories : [platformAccessories]);
    }

    configureAccessory(accessory) {
        const {Characteristic: Char, Service: Svc} = this.api.hap;
        const PA = this.api.platformAccessory;
        if (accessory instanceof PA && this._expectedUUIDs && this._expectedUUIDs.includes(accessory.UUID)) {
            this.cachedAccessories.set(accessory.UUID, accessory);
            accessory.services.forEach(service => {
                if (service.UUID === Svc.AccessoryInformation.UUID) return;
                service.characteristics.some(characteristic => {
                    if (!characteristic.props ||
                        !Array.isArray(characteristic.props.perms) ||
                        characteristic.props.perms.length !== 3 ||
                        !(characteristic.props.perms.includes(Char.Perms.WRITE) && characteristic.props.perms.includes(Char.Perms.NOTIFY))
                    ) return;

                    this.log.info('Marked %s unreachable by faulting Service.%s.%s', accessory.displayName, service.displayName, characteristic.displayName);

                    characteristic.updateValue(new Error('Unreachable'));
                    return true;
                });
            });
        } else {
            setTimeout(() => {
                this.removeAccessory(accessory);
            }, 1000);
        }
    }

    addAccessory(device) {
        const deviceConfig = device.context;
        const type = (deviceConfig.type || '').toLowerCase();

        const Accessory = CLASS_DEF[type];

        let accessory = this.cachedAccessories.get(deviceConfig.UUID),
            isCached = true;

        if (accessory && accessory.category !== Accessory.getCategory(Categories)) {
            this.log.info("%s has a different type (%s vs %s)", accessory.displayName, accessory.category, Accessory.getCategory(Categories));
            this.removeAccessory(accessory);
            accessory = null;
        }

        if (!accessory) {
            accessory = new PlatformAccessory(deviceConfig.name, deviceConfig.UUID, Accessory.getCategory(Categories));
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, deviceConfig.manufacturer || "Unknown")
                .setCharacteristic(Characteristic.Model, deviceConfig.model || "Unknown")
                .setCharacteristic(Characteristic.SerialNumber, deviceConfig.id.slice(8));

            isCached = false;
        }

        if (accessory && accessory.displayName !== deviceConfig.name) {
            this.log.info(
                "Configuration name %s differs from cached displayName %s. Updating cached displayName to %s ",
                deviceConfig.name, accessory.displayName, deviceConfig.name);
            accessory.displayName = deviceConfig.name;
        }

        this.cachedAccessories.set(deviceConfig.UUID, new Accessory(this, accessory, device, !isCached));
    }

    removeAccessory(homebridgeAccessory) {
        if (!homebridgeAccessory) return;

        this.log.warn('Unregistering', homebridgeAccessory.displayName);

        delete this.cachedAccessories[homebridgeAccessory.UUID];
        this.api.unregisterPlatformAccessories(PLATFORM_NAME, PLATFORM_NAME, [homebridgeAccessory]);
    }

    removeAccessoryByUUID(uuid) {
        if (uuid) this.removeAccessory(this.cachedAccessories.get(uuid));
    }
}
