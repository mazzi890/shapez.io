/* typehints:start */
import { Application } from "../application";
import { Vector } from "../core/vector";
import { GameRoot } from "../game/root";
/* typehints:end */

import { newEmptyMap, clamp } from "../core/utils";
import { createLogger } from "../core/logging";
import { globalConfig } from "../core/config";

const logger = createLogger("sound");

export const SOUNDS = {
    // Menu and such
    uiClick: "ui/ui_click.mp3",
    uiError: "ui/ui_error.mp3",
    dialogError: "ui/dialog_error.mp3",
    dialogOk: "ui/dialog_ok.mp3",
    swishHide: "ui/ui_swish_hide.mp3",
    swishShow: "ui/ui_swish_show.mp3",
};

export const MUSIC = {
    mainMenu: "main_menu.mp3",
    gameBg: "theme_full.mp3",
};

export class SoundInstanceInterface {
    constructor(key, url) {
        this.key = key;
        this.url = url;
    }

    /** @returns {Promise<void>} */
    load() {
        abstract;
        return Promise.resolve();
    }

    play(volume) {
        abstract;
    }

    deinitialize() {}
}

export class MusicInstanceInterface {
    constructor(key, url) {
        this.key = key;
        this.url = url;
    }

    stop() {
        abstract;
    }

    play() {
        abstract;
    }

    /** @returns {Promise<void>} */
    load() {
        abstract;
        return Promise.resolve();
    }

    /** @returns {boolean} */
    isPlaying() {
        abstract;
        return false;
    }

    deinitialize() {}
}

export class SoundInterface {
    constructor(app, soundClass, musicClass) {
        /** @type {Application} */
        this.app = app;

        this.soundClass = soundClass;
        this.musicClass = musicClass;

        /** @type {Object<string, SoundInstanceInterface>} */
        this.sounds = newEmptyMap();

        /** @type {Object<string, MusicInstanceInterface>} */
        this.music = newEmptyMap();

        /** @type {MusicInstanceInterface} */
        this.currentMusic = null;

        this.pageIsVisible = true;

        this.musicMuted = false;
        this.soundsMuted = false;
    }

    /**
     * Initializes the sound
     * @returns {Promise<any>}
     */
    initialize() {
        for (const soundKey in SOUNDS) {
            const soundPath = SOUNDS[soundKey];
            const sound = new this.soundClass(soundKey, soundPath);
            this.sounds[soundPath] = sound;
        }

        for (const musicKey in MUSIC) {
            const musicPath = MUSIC[musicKey];
            const music = new this.musicClass(musicKey, musicPath);
            this.music[musicPath] = music;
        }

        // this.musicMuted = this.app.userProfile.getMusicMuted();
        // this.soundsMuted = this.app.userProfile.getSoundsMuted();

        this.musicMuted = false;
        this.soundsMuted = false;

        if (G_IS_DEV && globalConfig.debug.disableMusic) {
            this.musicMuted = true;
        }

        return Promise.resolve();
    }

    /**
     * Pre-Loads the given sounds
     * @param {string} key
     * @returns {Promise<void>}
     */
    loadSound(key) {
        if (this.sounds[key]) {
            return this.sounds[key].load();
        } else if (this.music[key]) {
            return this.music[key].load();
        } else {
            logger.error("Sound/Music by key not found:", key);
            return Promise.resolve();
        }
    }

    /** Deinits the sound */
    deinitialize() {
        const promises = [];
        for (const key in this.sounds) {
            promises.push(this.sounds[key].deinitialize());
        }
        for (const key in this.music) {
            promises.push(this.music[key].deinitialize());
        }
        return Promise.all(promises);
    }

    /**
     * Returns if the music is muted
     * @returns {boolean}
     */
    getMusicMuted() {
        return this.musicMuted;
    }

    /**
     * Returns if sounds are muted
     * @returns {boolean}
     */
    getSoundsMuted() {
        return this.soundsMuted;
    }

    /**
     * Sets if the music is muted
     * @param {boolean} muted
     */
    setMusicMuted(muted) {
        this.musicMuted = muted;
        if (this.musicMuted) {
            if (this.currentMusic) {
                this.currentMusic.stop();
            }
        } else {
            if (this.currentMusic) {
                this.currentMusic.play();
            }
        }
    }

    /**
     * Sets if the sounds are muted
     * @param {boolean} muted
     */
    setSoundsMuted(muted) {
        this.soundsMuted = muted;
    }

    /**
     * Focus change handler, called by the pap
     * @param {boolean} pageIsVisible
     */
    onPageRenderableStateChanged(pageIsVisible) {
        this.pageIsVisible = pageIsVisible;
        if (this.currentMusic) {
            if (pageIsVisible) {
                if (!this.currentMusic.isPlaying() && !this.musicMuted) {
                    this.currentMusic.play();
                }
            } else {
                this.currentMusic.stop();
            }
        }
    }

    /**
     * @param {string} key
     */
    playUiSound(key) {
        if (this.soundsMuted) {
            return;
        }
        if (!this.sounds[key]) {
            logger.warn("Sound", key, "not found, probably not loaded yet");
            return;
        }
        this.sounds[key].play(1.0);
    }

    /**
     *
     * @param {string} key
     * @param {Vector} worldPosition
     * @param {GameRoot} root
     */
    play3DSound(key, worldPosition, root) {
        if (!this.sounds[key]) {
            logger.warn("Music", key, "not found, probably not loaded yet");
            return;
        }
        if (!this.pageIsVisible || this.soundsMuted) {
            return;
        }

        // hack, but works
        if (root.time.getIsPaused()) {
            return;
        }

        let volume = 1.0;
        if (!root.camera.isWorldPointOnScreen(worldPosition)) {
            volume = 0.2;
        }
        volume *= clamp(root.camera.zoomLevel / 3);
        this.sounds[key].play(clamp(volume));
    }

    /**
     * @param {string} key
     */
    playThemeMusic(key) {
        const music = this.music[key];
        if (key !== null && !music) {
            logger.warn("Music", key, "not found");
        }
        if (this.currentMusic !== music) {
            if (this.currentMusic) {
                logger.log("Stopping", this.currentMusic.key);
                this.currentMusic.stop();
            }
            this.currentMusic = music;
            if (music && this.pageIsVisible && !this.musicMuted) {
                logger.log("Starting", this.currentMusic.key);
                music.play();
            }
        }
    }
}
