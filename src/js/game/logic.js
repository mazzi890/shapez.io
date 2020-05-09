import { GameRoot } from "./root";
import { Entity } from "./entity";
import { Vector, enumDirectionToVector, enumDirection } from "../core/vector";
import { MetaBuilding } from "./meta_building";
import { StaticMapEntityComponent } from "./components/static_map_entity";
import { Math_abs } from "../core/builtins";
import { Rectangle } from "../core/rectangle";
import { createLogger } from "../core/logging";

const logger = createLogger("ingame/logic");

/**
 * Typing helper
 * @typedef {Array<{
 *  entity: Entity,
 *  slot: import("./components/item_ejector").ItemEjectorSlot,
 *  fromTile: Vector,
 *  toDirection: enumDirection
 * }>} EjectorsAffectingTile
 */

/**
 * Typing helper
 * @typedef {Array<{
 *  entity: Entity,
 *  slot: import("./components/item_acceptor").ItemAcceptorSlot,
 *  toTile: Vector,
 *  fromDirection: enumDirection
 * }>} AcceptorsAffectingTile
 */

/**
 * @typedef {{
 *     acceptors: AcceptorsAffectingTile,
 *     ejectors: EjectorsAffectingTile
 * }} AcceptorsAndEjectorsAffectingTile
 */

export class GameLogic {
    /**
     *
     * @param {GameRoot} root
     */
    constructor(root) {
        this.root = root;
    }

    /**
     *
     * @param {Vector} origin
     * @param {number} rotation
     * @param {MetaBuilding} building
     */
    isAreaFreeToBuild(origin, rotation, building) {
        const checker = new StaticMapEntityComponent({
            origin,
            tileSize: building.getDimensions(),
            rotationDegrees: rotation,
        });

        const rect = checker.getTileSpaceBounds();

        for (let x = rect.x; x < rect.x + rect.w; ++x) {
            for (let y = rect.y; y < rect.y + rect.h; ++y) {
                const contents = this.root.map.getTileContentXY(x, y);
                if (contents && !contents.components.ReplaceableMapEntity) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     *
     * @param {Vector} origin
     * @param {number} rotation
     * @param {MetaBuilding} building
     */
    checkCanPlaceBuilding(origin, rotation, building) {
        if (!building.getIsUnlocked(this.root)) {
            return false;
        }
        return this.isAreaFreeToBuild(origin, rotation, building);
    }

    /**
     *
     * @param {object} param0
     * @param {Vector} param0.origin
     * @param {number} param0.rotation
     * @param {number} param0.rotationVariant
     * @param {MetaBuilding} param0.building
     */
    tryPlaceBuilding({ origin, rotation, rotationVariant, building }) {
        if (this.checkCanPlaceBuilding(origin, rotation, building)) {
            // Remove any removeable entities below
            const checker = new StaticMapEntityComponent({
                origin,
                tileSize: building.getDimensions(),
                rotationDegrees: rotation,
            });

            const rect = checker.getTileSpaceBounds();

            for (let x = rect.x; x < rect.x + rect.w; ++x) {
                for (let y = rect.y; y < rect.y + rect.h; ++y) {
                    const contents = this.root.map.getTileContentXY(x, y);
                    if (contents && contents.components.ReplaceableMapEntity) {
                        if (!this.tryDeleteBuilding(contents)) {
                            logger.error("Building has replaceable component but is also unremovable");
                            return false;
                        }
                    }
                }
            }

            building.createAndPlaceEntity(this.root, origin, rotation, rotationVariant);
            return true;
        }
        return false;
    }

    /**
     * Returns whether the given building can get removed
     * @param {Entity} building
     */
    canDeleteBuilding(building) {
        return building.components.StaticMapEntity && !building.components.Unremovable;
    }

    /**
     * Tries to delete the given building
     * @param {Entity} building
     */
    tryDeleteBuilding(building) {
        if (!this.canDeleteBuilding(building)) {
            return false;
        }
        this.root.map.removeStaticEntity(building);
        this.root.entityMgr.destroyEntity(building);
        return true;
    }

    /**
     * Returns the acceptors and ejectors which affect the current tile
     * @param {Vector} tile
     * @returns {AcceptorsAndEjectorsAffectingTile}
     */
    getEjectorsAndAcceptorsAtTile(tile) {
        /** @type {EjectorsAffectingTile} */
        let ejectors = [];
        /** @type {AcceptorsAffectingTile} */
        let acceptors = [];

        for (let dx = -1; dx <= 1; ++dx) {
            for (let dy = -1; dy <= 1; ++dy) {
                if (Math_abs(dx) + Math_abs(dy) !== 1) {
                    continue;
                }

                const entity = this.root.map.getTileContentXY(tile.x + dx, tile.y + dy);
                if (entity) {
                    const staticComp = entity.components.StaticMapEntity;
                    const itemEjector = entity.components.ItemEjector;
                    if (itemEjector) {
                        for (let ejectorSlot = 0; ejectorSlot < itemEjector.slots.length; ++ejectorSlot) {
                            const slot = itemEjector.slots[ejectorSlot];
                            const wsTile = staticComp.localTileToWorld(slot.pos);
                            const wsDirection = staticComp.localDirectionToWorld(slot.direction);
                            const targetTile = wsTile.add(enumDirectionToVector[wsDirection]);
                            if (targetTile.equals(tile)) {
                                ejectors.push({
                                    entity,
                                    slot,
                                    fromTile: wsTile,
                                    toDirection: wsDirection,
                                });
                            }
                        }
                    }

                    const itemAcceptor = entity.components.ItemAcceptor;
                    if (itemAcceptor) {
                        for (let acceptorSlot = 0; acceptorSlot < itemAcceptor.slots.length; ++acceptorSlot) {
                            const slot = itemAcceptor.slots[acceptorSlot];
                            const wsTile = staticComp.localTileToWorld(slot.pos);
                            for (let k = 0; k < slot.directions.length; ++k) {
                                const direction = slot.directions[k];
                                const wsDirection = staticComp.localDirectionToWorld(direction);

                                const sourceTile = wsTile.add(enumDirectionToVector[wsDirection]);
                                if (sourceTile.equals(tile)) {
                                    acceptors.push({
                                        entity,
                                        slot,
                                        toTile: wsTile,
                                        fromDirection: wsDirection,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        return { ejectors, acceptors };
    }
}
