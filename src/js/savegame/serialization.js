import { JSON_stringify } from "../core/builtins";
import {
    BaseDataType,
    TypeArray,
    TypeBoolean,
    TypeClass,
    TypeClassId,
    TypeEntity,
    TypeEntityWeakref,
    TypeEnum,
    TypeFixedClass,
    TypeInteger,
    TypeKeyValueMap,
    TypeMetaClass,
    TypeNullable,
    TypeNumber,
    TypePair,
    TypePositiveInteger,
    TypePositiveNumber,
    TypeString,
    TypeVector,
    TypeClassFromMetaclass,
    TypeClassData,
} from "./serialization_data_types";
import { createLogger } from "../core/logging";

const logger = createLogger("serialization");

// Schema declarations
export const types = {
    int: new TypeInteger(),
    uint: new TypePositiveInteger(),
    float: new TypeNumber(),
    ufloat: new TypePositiveNumber(),
    string: new TypeString(),
    entity: new TypeEntity(),
    weakEntityRef: new TypeEntityWeakref(),
    vector: new TypeVector(),
    tileVector: new TypeVector(),
    bool: new TypeBoolean(),

    /**
     * @param {BaseDataType} wrapped
     */
    nullable(wrapped) {
        return new TypeNullable(wrapped);
    },

    /**
     * @param {FactoryTemplate<*>|SingletonFactoryTemplate<*>} registry
     */
    classId(registry) {
        return new TypeClassId(registry);
    },
    /**
     * @param {BaseDataType} valueType
     * @param {boolean=} includeEmptyValues
     */
    keyValueMap(valueType, includeEmptyValues = true) {
        return new TypeKeyValueMap(valueType, includeEmptyValues);
    },

    /**
     * @param {Array<string>} values
     */
    enum(values) {
        return new TypeEnum(values);
    },

    /**
     * @param {FactoryTemplate<*>} registry
     */
    obj(registry) {
        return new TypeClass(registry);
    },

    /**
     * @param {FactoryTemplate<*>} registry
     */
    objData(registry) {
        return new TypeClassData(registry);
    },

    /**
     * @param {typeof BasicSerializableObject} cls
     */
    knownType(cls) {
        return new TypeFixedClass(cls);
    },

    /**
     * @param {BaseDataType} innerType
     */
    array(innerType) {
        return new TypeArray(innerType);
    },

    /**
     * @param {SingletonFactoryTemplate<*>} innerType
     */
    classRef(registry) {
        return new TypeMetaClass(registry);
    },

    /**
     * @param {BaseDataType} a
     * @param {BaseDataType} b
     */
    pair(a, b) {
        return new TypePair(a, b);
    },

    /**
     * @param {typeof BasicSerializableObject} classHandle
     * @param {SingletonFactoryTemplate<*>} registry
     */
    classWithMetaclass(classHandle, registry) {
        return new TypeClassFromMetaclass(classHandle, registry);
    },
};

/**
 * A full schema declaration
 * @typedef {Object.<string, BaseDataType>} Schema
 */

const globalSchemaCache = {};

/* dev:start */
const classnamesCache = {};
/* dev:end*/

export class BasicSerializableObject {
    /* dev:start */
    /**
     * Fixes typeof DerivedComponent is not assignable to typeof Component, compiled out
     * in non-dev builds
     */
    constructor(...args) {}

    /* dev:end */

    static getId() {
        abstract;
    }

    /**
     * Should return the serialization schema
     * @returns {Schema}
     */
    static getSchema() {
        return {};
    }

    // Implementation
    /** @returns {Schema} */
    static getCachedSchema() {
        const id = this.getId();

        /* dev:start */
        assert(
            classnamesCache[id] === this || classnamesCache[id] === undefined,
            "Class name taken twice: " + id + " (from " + this.name + ")"
        );
        classnamesCache[id] = this;
        /* dev:end */

        const entry = globalSchemaCache[id];
        if (entry) {
            return entry;
        }

        const schema = this.getSchema();
        globalSchemaCache[id] = schema;
        return schema;
    }

    /** @returns {object} */
    serialize() {
        return serializeSchema(
            this,
            /** @type {typeof BasicSerializableObject} */ (this.constructor).getCachedSchema()
        );
    }

    /** @returns {string|void} */
    deserialize(data) {
        return deserializeSchema(
            this,
            /** @type {typeof BasicSerializableObject} */ (this.constructor).getCachedSchema(),
            data
        );
    }

    /** @returns {string|void} */
    static verify(data) {
        return verifySchema(this.getCachedSchema(), data);
    }
}

/**
 * Serializes an object using the given schema, mergin with the given properties
 * @param {object} obj The object to serialize
 * @param {Schema} schema The schema to use
 * @param {object=} mergeWith Any additional properties to merge with the schema, useful for super calls
 * @returns {object} Serialized data object
 */
export function serializeSchema(obj, schema, mergeWith = {}) {
    for (const key in schema) {
        if (!obj.hasOwnProperty(key)) {
            logger.error("Invalid schema, property", key, "does not exist on", obj, "(schema=", schema, ")");
            assert(
                obj.hasOwnProperty(key),
                "serialization: invalid schema, property does not exist on object: " + key
            );
        }
        if (!schema[key]) {
            assert(false, "Invalid schema: " + JSON_stringify(schema) + " / " + key);
        }

        if (G_IS_DEV) {
            try {
                mergeWith[key] = schema[key].serialize(obj[key]);
            } catch (ex) {
                logger.error(
                    "Serialization of",
                    obj,
                    "failed on key '" + key + "' ->",
                    ex,
                    "(schema was",
                    schema,
                    ")"
                );
                throw ex;
            }
        } else {
            mergeWith[key] = schema[key].serialize(obj[key]);
        }
    }
    return mergeWith;
}

/**
 * Deserializes data into an object
 * @param {object} obj The object to store the deserialized data into
 * @param {Schema} schema The schema to use
 * @param {object} data The serialized data
 * @param {string|void|null=} baseclassErrorResult Convenience, if this is a string error code, do nothing and return it
 * @returns {string|void} String error code or nothing on success
 */
export function deserializeSchema(obj, schema, data, baseclassErrorResult = null) {
    if (baseclassErrorResult) {
        return baseclassErrorResult;
    }

    if (!data) {
        logger.error("Got 'NULL' data for", obj, "and schema", schema, "!");
        return "Got null data";
    }

    for (const key in schema) {
        if (!data.hasOwnProperty(key)) {
            logger.error("Data", data, "does not contain", key, "(schema:", schema, ")");
            return "Missing key in schema: " + key + " of class " + obj.constructor.name;
        }
        if (!schema[key].allowNull() && (data[key] === null || data[key] === undefined)) {
            logger.error("Data", data, "has null value for", key, "(schema:", schema, ")");
            return "Non-nullable entry is null: " + key + " of class " + obj.constructor.name;
        }

        const errorStatus = schema[key].deserializeWithVerify(data[key], obj, key, obj.root);
        if (errorStatus) {
            error(
                "serialization",
                "Deserialization failed with error '" + errorStatus + "' on object",
                obj,
                "and key",
                key,
                "(root? =",
                obj.root ? "y" : "n",
                ")"
            );
            return errorStatus;
        }
    }
}

/**
 * Verifies stored data using the given schema
 * @param {Schema} schema The schema to use
 * @param {object} data The data to verify
 * @returns {string|void} String error code or nothing on success
 */
export function verifySchema(schema, data) {
    for (const key in schema) {
        if (!data.hasOwnProperty(key)) {
            error("verify", "Data", data, "does not contain", key, "(schema:", schema, ")");
            return "verify: missing key required by schema in stored data: " + key;
        }
        if (!schema[key].allowNull() && (data[key] === null || data[key] === undefined)) {
            error("verify", "Data", data, "has null value for", key, "(schema:", schema, ")");
            return "verify: non-nullable entry is null: " + key;
        }

        const errorStatus = schema[key].verifySerializedValue(data[key]);
        if (errorStatus) {
            error("verify", errorStatus);
            return "verify: " + errorStatus;
        }
    }
}

/**
 * Extends a schema by adding the properties from the new schema to the existing base schema
 * @param {Schema} base
 * @param {Schema} newOne
 * @returns {Schema}
 */
export function extendSchema(base, newOne) {
    /** @type {Schema} */
    const result = Object.assign({}, base);
    for (const key in newOne) {
        if (result.hasOwnProperty(key)) {
            logger.error("Extend schema got duplicate key:", key);
            continue;
        }
        result[key] = newOne[key];
    }
    return result;
}
