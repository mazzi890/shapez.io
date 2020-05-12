import { BasicSerializableObject } from "../savegame/serialization";
import { GameRoot } from "./root";
import { ShapeDefinition, enumSubShape } from "./shape_definition";
import { enumColors } from "./colors";
import { randomChoice, clamp, randomInt, findNiceIntegerValue } from "../core/utils";
import { tutorialGoals, enumHubGoalRewards } from "./tutorial_goals";
import { createLogger } from "../core/logging";
import { globalConfig } from "../core/config";
import { Math_random } from "../core/builtins";
import { UPGRADES } from "./upgrades";
import { enumItemProcessorTypes } from "./components/item_processor";

const logger = createLogger("hub_goals");

export class HubGoals extends BasicSerializableObject {
    static getId() {
        return "HubGoals";
    }

    /**
     * @param {GameRoot} root
     */
    constructor(root) {
        super();

        this.root = root;

        this.level = 1;

        /**
         * Which story rewards we already gained
         */
        this.gainedRewards = {};

        /**
         * Mapping from shape hash -> amount
         * @type {Object<string, number>}
         */
        this.storedShapes = {};

        /**
         * Stores the levels for all upgrades
         * @type {Object<string, number>}
         */
        this.upgradeLevels = {};

        /**
         * Stores the improvements for all upgrades
         * @type {Object<string, number>}
         */
        this.upgradeImprovements = {};
        for (const key in UPGRADES) {
            this.upgradeImprovements[key] = UPGRADES[key].baseValue || 1;
        }

        this.createNextGoal();

        // Allow quickly switching goals in dev mode with key "C"
        if (G_IS_DEV) {
            this.root.gameState.inputReciever.keydown.add(key => {
                if (key.keyCode === 67) {
                    // Key: c
                    this.onGoalCompleted();
                }
            });
        }
    }

    /**
     * Returns how much of the current shape is stored
     * @param {ShapeDefinition} definition
     * @returns {number}
     */
    getShapesStored(definition) {
        return this.storedShapes[definition.getHash()] || 0;
    }

    /**
     * Returns how much of the current goal was already delivered
     */
    getCurrentGoalDelivered() {
        return this.getShapesStored(this.currentGoal.definition);
    }

    /**
     * Returns the current level of a given upgrade
     * @param {string} upgradeId
     */
    getUpgradeLevel(upgradeId) {
        return this.upgradeLevels[upgradeId] || 0;
    }

    /**
     * Returns whether the given reward is already unlocked
     * @param {enumHubGoalRewards} reward
     */
    isRewardUnlocked(reward) {
        if (G_IS_DEV && globalConfig.debug.allBuildingsUnlocked) {
            return true;
        }
        return !!this.gainedRewards[reward];
    }

    /**
     * Handles the given definition, by either accounting it towards the
     * goal or otherwise granting some points
     * @param {ShapeDefinition} definition
     */
    handleDefinitionDelivered(definition) {
        const hash = definition.getHash();
        this.storedShapes[hash] = (this.storedShapes[hash] || 0) + 1;

        // Check if we have enough for the next level
        const targetHash = this.currentGoal.definition.getHash();
        if (
            this.storedShapes[targetHash] >= this.currentGoal.required ||
            (G_IS_DEV && globalConfig.debug.rewardsInstant)
        ) {
            this.onGoalCompleted();
        }
    }

    /**
     * Creates the next goal
     */
    createNextGoal() {
        const storyIndex = this.level - 1;
        if (storyIndex < tutorialGoals.length) {
            const { shape, required, reward } = tutorialGoals[storyIndex];
            this.currentGoal = {
                /** @type {ShapeDefinition} */
                definition: this.root.shapeDefinitionMgr.registerOrReturnHandle(
                    ShapeDefinition.fromShortKey(shape)
                ),
                required,
                reward,
            };
            return;
        }

        const reward = enumHubGoalRewards.no_reward;

        this.currentGoal = {
            /** @type {ShapeDefinition} */
            definition: this.createRandomShape(),
            required: 1000 + findNiceIntegerValue(this.level * 47.5),
            reward,
        };
    }

    /**
     * Called when the level was completed
     */
    onGoalCompleted() {
        const reward = this.currentGoal.reward;
        this.gainedRewards[reward] = (this.gainedRewards[reward] || 0) + 1;
        this.root.signals.storyGoalCompleted.dispatch(this.level, reward);

        this.root.app.gameAnalytics.handleLevelCompleted(this.level);
        ++this.level;
        this.createNextGoal();
    }

    /**
     * Returns whether a given upgrade can be unlocked
     * @param {string} upgradeId
     */
    canUnlockUpgrade(upgradeId) {
        const handle = UPGRADES[upgradeId];
        const currentLevel = this.getUpgradeLevel(upgradeId);

        if (currentLevel >= handle.tiers.length) {
            // Max level
            return false;
        }

        if (G_IS_DEV && globalConfig.debug.upgradesNoCost) {
            return true;
        }

        const tierData = handle.tiers[currentLevel];

        for (let i = 0; i < tierData.required.length; ++i) {
            const requirement = tierData.required[i];
            if ((this.storedShapes[requirement.shape] || 0) < requirement.amount) {
                return false;
            }
        }
        return true;
    }

    /**
     * Tries to unlock the given upgrade
     * @param {string} upgradeId
     * @returns {boolean}
     */
    tryUnlockUgprade(upgradeId) {
        if (!this.canUnlockUpgrade(upgradeId)) {
            return false;
        }

        const handle = UPGRADES[upgradeId];
        const currentLevel = this.getUpgradeLevel(upgradeId);

        const tierData = handle.tiers[currentLevel];
        if (!tierData) {
            return false;
        }

        if (G_IS_DEV && globalConfig.debug.upgradesNoCost) {
            // Dont take resources
        } else {
            for (let i = 0; i < tierData.required.length; ++i) {
                const requirement = tierData.required[i];

                // Notice: Don't have to check for hash here
                this.storedShapes[requirement.shape] -= requirement.amount;
            }
        }

        this.upgradeLevels[upgradeId] = (this.upgradeLevels[upgradeId] || 0) + 1;
        this.upgradeImprovements[upgradeId] += tierData.improvement;

        this.root.signals.upgradePurchased.dispatch(upgradeId);

        this.root.app.gameAnalytics.handleUpgradeUnlocked(upgradeId, currentLevel);

        return true;
    }

    /**
     * @returns {ShapeDefinition}
     */
    createRandomShape() {
        const layerCount = clamp(this.level / 50, 2, 4);
        /** @type {Array<import("./shape_definition").ShapeLayer>} */
        let layers = [];

        // @ts-ignore
        const randomColor = () => randomChoice(Object.values(enumColors));
        // @ts-ignore
        const randomShape = () => randomChoice(Object.values(enumSubShape));

        let anyIsMissingTwo = false;

        for (let i = 0; i < layerCount; ++i) {
            /** @type {import("./shape_definition").ShapeLayer} */
            const layer = [null, null, null, null];

            for (let quad = 0; quad < 4; ++quad) {
                layer[quad] = {
                    subShape: randomShape(),
                    color: randomColor(),
                };
            }

            // Sometimes shapes are missing
            if (Math_random() > 0.85) {
                layer[randomInt(0, 3)] = null;
            }

            // Sometimes they actually are missing *two* ones!
            // Make sure at max only one layer is missing it though, otherwise we could
            // create an uncreateable shape
            if (Math_random() > 0.95 && !anyIsMissingTwo) {
                layer[randomInt(0, 3)] = null;
                anyIsMissingTwo = true;
            }

            layers.push(layer);
        }

        const definition = new ShapeDefinition({ layers });
        return this.root.shapeDefinitionMgr.registerOrReturnHandle(definition);
    }

    ////////////// HELPERS

    /**
     * Belt speed
     * @returns {number} items / sec
     */
    getBeltBaseSpeed() {
        return globalConfig.beltSpeedItemsPerSecond * this.upgradeImprovements.belt;
    }

    /**
     * Underground belt speed
     * @returns {number} items / sec
     */
    getUndergroundBeltBaseSpeed() {
        return globalConfig.beltSpeedItemsPerSecond * this.upgradeImprovements.belt;
    }

    /**
     * Miner speed
     * @returns {number} items / sec
     */
    getMinerBaseSpeed() {
        return globalConfig.minerSpeedItemsPerSecond * this.upgradeImprovements.miner;
    }

    /**
     * Processor speed
     * @param {enumItemProcessorTypes} processorType
     * @returns {number} items / sec
     */
    getProcessorBaseSpeed(processorType) {
        switch (processorType) {
            case enumItemProcessorTypes.trash:
            case enumItemProcessorTypes.hub:
                return 1e30;
            case enumItemProcessorTypes.splitter:
                return (2 / globalConfig.beltSpeedItemsPerSecond) * this.upgradeImprovements.belt;
            case enumItemProcessorTypes.cutter:
            case enumItemProcessorTypes.rotater:
            case enumItemProcessorTypes.stacker:
            case enumItemProcessorTypes.mixer:
            case enumItemProcessorTypes.painter:
                return (
                    (1 / globalConfig.beltSpeedItemsPerSecond) *
                    this.upgradeImprovements.processors *
                    globalConfig.buildingSpeeds[processorType]
                );

            default:
                assertAlways(false, "invalid processor type: " + processorType);
        }

        return 1 / globalConfig.beltSpeedItemsPerSecond;
    }
}