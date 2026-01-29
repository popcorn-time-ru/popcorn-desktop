/**
 * OpenSubtitles Provider - Uses the new OpenSubtitles.com REST API
 *
 * The old XML-RPC API (opensubtitles.org) has been deprecated.
 * This provider uses the new REST API via the opensubtitles.com npm package.
 *
 * API Documentation: https://opensubtitles.stoplight.io/docs/opensubtitles-api/
 *
 * Requirements:
 *   - API Key from https://www.opensubtitles.com/consumers
 *   - Username/Password for authenticated downloads (optional but recommended)
 */
(function (App) {
    'use strict';

    var OS = require('opensubtitles.com');
    var openSRT = null;
    var authToken = null;

    var OpenSubtitles = function () {};

    OpenSubtitles.prototype.constructor = OpenSubtitles;
    OpenSubtitles.prototype.config = {
        name: 'OpenSubtitles'
    };

    /**
     * Normalize language codes to match app expectations
     * Handles Portuguese Brazil variant (pb -> pt-br)
     */
    var normalizeLangCodes = function (data) {
        Object.keys(data).forEach(function(key) {
            if (key === 'pb' || key.indexOf('pb|') === 0) {
                data[key.replace('pb', 'pt-br')] = data[key];
                delete data[key];
            }
        });
        return data;
    };

    /**
     * Map OpenSubtitles.com language codes to the format expected by the app
     * The new API returns ISO 639-2B codes, we need to convert some of them
     */
    var mapLanguageCode = function (lang) {
        var langMap = {
            'por': 'pt',
            'pob': 'pt-br',
            'eng': 'en',
            'spa': 'es',
            'fre': 'fr',
            'ger': 'de',
            'ita': 'it',
            'dut': 'nl',
            'pol': 'pl',
            'rus': 'ru',
            'jpn': 'ja',
            'chi': 'zh',
            'kor': 'ko',
            'ara': 'ar',
            'tur': 'tr',
            'vie': 'vi',
            'tha': 'th',
            'ind': 'id',
            'gre': 'el',
            'heb': 'he',
            'rum': 'ro',
            'cze': 'cs',
            'hun': 'hu',
            'swe': 'sv',
            'dan': 'da',
            'fin': 'fi',
            'nor': 'no',
            'bul': 'bg',
            'hrv': 'hr',
            'srp': 'sr',
            'slv': 'sl',
            'ukr': 'uk',
            'cat': 'ca',
            'eus': 'eu',
            'glg': 'gl'
        };
        return langMap[lang] || lang;
    };

    /**
     * Format the API response to match the expected Butter format
     * Returns: { "en": "url", "es": "url", "en|2": "url", ... }
     */
    var formatForButter = function (response) {
        var data = {};
        var langCounts = {};
        var seenUrls = {};

        if (!response || !response.data || !Array.isArray(response.data)) {
            win.info('0 subtitles found');
            return Common.sanitize(data);
        }

        response.data.forEach(function (subtitle) {
            if (!subtitle.attributes || !subtitle.attributes.files || !subtitle.attributes.files.length) {
                return;
            }

            var langCode = mapLanguageCode(subtitle.attributes.language);
            var file = subtitle.attributes.files[0];

            if (!file.file_id) {
                return;
            }

            // Create a download URL placeholder - actual download requires POST to /download
            // We store the file_id and will resolve it when downloading
            var subtitleData = {
                file_id: file.file_id,
                lang: langCode,
                downloads: subtitle.attributes.download_count || 0
            };

            // For now, store as a special URL format that we'll handle in the download phase
            // Format: oscom://file_id
            var url = 'oscom://' + file.file_id;

            // Skip if we've already seen this URL
            if (seenUrls[url]) {
                return;
            }
            seenUrls[url] = true;

            // Track language counts for multi-subtitle support
            if (!langCounts[langCode]) {
                langCounts[langCode] = 0;
            }
            langCounts[langCode]++;

            // First subtitle for a language uses just the lang code
            // Subsequent ones use lang|n format
            var key = langCode;
            if (langCounts[langCode] > 1) {
                key = langCode + '|' + langCounts[langCode];
            }

            data[key] = url;
        });

        data = normalizeLangCodes(data);
        win.info(Object.keys(data).length + ' subtitles found');

        return Common.sanitize(data);
    };

    /**
     * Initialize the OpenSubtitles.com client
     */
    var initClient = function () {
        var apiKey = Settings.opensubtitles.apikey;

        if (!apiKey) {
            win.warn('OpenSubtitles: No API key configured');
            return null;
        }

        return new OS({
            apikey: apiKey,
            useragent: 'Popcorn Time v' + (Settings.version || '0.5.1')
        });
    };

    /**
     * Login to OpenSubtitles.com to get an auth token
     * Required for downloading subtitles
     */
    OpenSubtitles.prototype.login = function () {
        var self = this;

        return new Promise(function (resolve, reject) {
            var client = initClient();
            if (!client) {
                return reject(new Error('No API key configured'));
            }

            var username = AdvSettings.get('opensubtitlesUsername');
            var password = AdvSettings.get('opensubtitlesPassword');

            if (!username || !password) {
                return reject(new Error('No credentials configured'));
            }

            client.login({
                username: username,
                password: password
            }).then(function (response) {
                if (response && response.token) {
                    authToken = response.token;
                    openSRT = client;
                    resolve(response);
                } else {
                    reject(new Error('No token returned'));
                }
            }).catch(reject);
        });
    };

    /**
     * Fetch subtitles for a video
     * @param {Object} queryParams - Query parameters
     * @param {string} queryParams.imdbid - IMDb ID (e.g., 'tt1375666')
     * @param {string} queryParams.filename - Video filename
     * @param {number} queryParams.season - Season number (for TV shows)
     * @param {number} queryParams.episode - Episode number (for TV shows)
     */
    OpenSubtitles.prototype.fetch = function (queryParams) {
        var self = this;

        return new Promise(function (resolve, reject) {
            var client = initClient();
            if (!client) {
                win.warn('OpenSubtitles: Cannot fetch - no API key');
                return resolve({});
            }

            // Build search query for new API
            var searchQuery = {};

            // IMDb ID (remove 'tt' prefix if present, API expects just the number)
            if (queryParams.imdbid) {
                searchQuery.imdb_id = queryParams.imdbid;
            }

            // For TV shows
            if (queryParams.season) {
                searchQuery.season_number = parseInt(queryParams.season, 10);
            }
            if (queryParams.episode) {
                searchQuery.episode_number = parseInt(queryParams.episode, 10);
            }

            // Filename query as fallback
            if (queryParams.filename && !queryParams.imdbid) {
                searchQuery.query = queryParams.filename;
            }

            win.info('OpenSubtitles: Searching with params:', JSON.stringify(searchQuery));

            client.subtitles(searchQuery)
                .then(function (response) {
                    var formatted = formatForButter(response);
                    resolve(formatted);
                })
                .catch(function (err) {
                    win.error('OpenSubtitles.fetch error:', err.message || err);
                    resolve({});
                });
        });
    };

    /**
     * Get subtitle details by IMDb ID
     */
    OpenSubtitles.prototype.detail = function (id, attrs) {
        return this.fetch({
            imdbid: id
        }).then(function (data) {
            App.vent.trigger('update:subtitles', data);
            return {
                subtitle: data
            };
        });
    };

    /**
     * Get the actual download URL for a subtitle
     * The new API requires a POST request to /download endpoint
     * @param {string} fileId - The file_id from the search results
     */
    OpenSubtitles.prototype.getDownloadUrl = function (fileId) {
        var self = this;

        return new Promise(function (resolve, reject) {
            var client = openSRT || initClient();
            if (!client) {
                return reject(new Error('No API client available'));
            }

            // Check if we need to login first
            var downloadPromise;
            if (!authToken) {
                // Try to login first if we have credentials
                var username = AdvSettings.get('opensubtitlesUsername');
                var password = AdvSettings.get('opensubtitlesPassword');

                if (username && password) {
                    downloadPromise = self.login().then(function () {
                        return openSRT.download({ file_id: parseInt(fileId, 10) });
                    });
                } else {
                    // Try anonymous download (limited to 5/day per IP)
                    downloadPromise = client.download({ file_id: parseInt(fileId, 10) });
                }
            } else {
                downloadPromise = client.download({ file_id: parseInt(fileId, 10) });
            }

            downloadPromise
                .then(function (response) {
                    if (response && response.link) {
                        resolve(response.link);
                    } else {
                        reject(new Error('No download link in response'));
                    }
                })
                .catch(function (err) {
                    win.error('OpenSubtitles.getDownloadUrl error:', err.message || err);
                    reject(err);
                });
        });
    };

    /**
     * Upload subtitles (placeholder - not fully implemented for new API)
     */
    OpenSubtitles.prototype.upload = function (queryParams) {
        return Promise.reject(new Error('Upload not yet implemented for new API'));
    };

    App.Providers.install(OpenSubtitles);

})(window.App);
