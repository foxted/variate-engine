import * as debug from './lang/debug';
import * as errors from './lang/errors';
import * as bucketing from './utilities/bucketing';
import _ from './utilities';

const LOCAL_STORAGE_MAIN_TRAFFIC_BUCKET_KEY = 'testing-tool-main-bucket';
const LOCAL_STORAGE_TRAFFIC_BUCKETS_KEY = 'testing-tool-buckets';

class Testing {
    constructor(options) {
        this.setupOptions(options);
    }

    /**
     * Get testing options
     * @returns {*}
     */
    get options() {
        return this._options;
    }

    /**
     * Set testing options
     * @param options
     */
    set options(options) {
        this._options = Object.assign({}, this._options, options);
    }

    /**
     * Get testing configuration
     * @returns {*}
     */
    get config() {
        return this._options.config;
    }

    /**
     * Set testing configuration
     * @param config
     */
    set config(config) {
        this._options.config = config;
    }

    /**
     * Get status of the testing tool
     * @returns {*|boolean}
     */
    get isReady() {
        return this._isReady;
    }

    /**
     * Set status of the testing tool
     * @param value
     */
    set isReady(value) {
        if (typeof value !== 'boolean') {
            throw new TypeError(errors.IS_READY_TYPE_ERROR);
        }
        this._isReady = value;
    }

    /**
     * Get qualification status for visitor
     * @returns {*|boolean}
     */
    get isQualified() {
        return this._isQualified;
    }

    /**
     * Set qualification status for visitor
     * @param value
     */
    set isQualified(value) {
        if (typeof value !== 'boolean') {
            throw new TypeError(errors.IS_QUALIFIED_TYPE_ERROR);
        }
        this._isQualified = value;
    }

    /**
     * Get testing environment
     * @returns {*}
     */
    get env() {
        return this._env;
    }

    /**
     * Set testing environment
     * @param value
     */
    set env(value) {
        this._env = Object.assign({}, this._env, value);
    }

    /**
     * Get active experiments
     * @returns {*|Array}
     */
    get experiments() {
        return this._experiments;
    }

    /**
     * Set active experiments
     * @param value
     */
    set experiments(value) {
        this._experiments = value || [];
    }

    /**
     * Initialize testing:
     * use this when loading the page for the first time
     */
    initialize() {
        this.setupEnvironment();
        this.qualify();
        this.isReady = true;
    }

    /**
     * Refresh testing:
     * use this after navigation (page URL/query params update)
     */
    refresh() {
        this.isReady = false;
        this.setupEnvironment();
        this.qualify();
        this.isReady = true;
    }

    /**
     * Initialize options
     */
    setupOptions(options) {
        this.options = Object.assign({
            debug: false,
            config: {}
        }, options);
        this.options.debug && console.debug(debug.SETUP_OPTIONS);
    }

    /**
     * Initialize testing environment
     */
    setupEnvironment(custom) {
        this.options.debug && console.debug(debug.SETUP_ENVIRONMENT);

        // View information
        const view = _.inBrowser && window.location || Object.assign(
            { href: '', search: '' },
            _.objectValue('view', custom)
        );

        // Viewport information
        const viewport = {
            mainBucket: this.getMainTrafficBucket(),
            forcedQueryParams: this.extractQueryParams(view),
            doNotTrack: _.inBrowser && this.checkDoNotTrackSetting() || false,
            width: _.inBrowser && window.innerWidth || 0,
            height: _.inBrowser && window.innerHeight || 0,
            userAgent: _.UA,
        };

        // Targeting information
        const targeting = Object.assign({}, _.objectValue('targeting', custom));

        this.env = { view, viewport, targeting };
    }

    /**
     * Qualify visitor for experiments
     */
    qualify() {
        // 1. Get experiments based on bucket
        let experiments = this.loadExperiments();

        // 2. Check view targeting (URL)
        experiments = experiments.filter((experiment) => this.filterWithView(experiment));

        // 3. Check audience targeting
        experiments = experiments.filter((experiment) => this.filterWithAudience(experiment));

        // 3. Reduce to 1 variation per experiment to prepare for display
        experiments = experiments.filter((experiment) => this.filterVariationsWithBucket(experiment));

        this.experiments = experiments;
        this.isQualified = true;
    }

    /**
     * Go through experiments and load only the relevant experiments
     * based on visitor main bucket and if query params are present
     * @returns {Array}
     */
    loadExperiments() {
        this.options.debug && console.debug(debug.LOADING_EXPERIMENTS);

        let experiments = [];

        // Load live main experiments
        experiments.push(_.arrayValue('live.experiments', this.config));

        // Load live bucketed experiments if relevant
        experiments.push(...this.getBucketedExperiments(_.objectValue('live', this.config)));

        // Load draft experiments if query params forced
        if (this.shouldForceQueryParams()) {
            // Load draft main experiments
            experiments.push(..._.arrayValue('draft.experiments', this.config));

            // Load draft bucketed experiments if relevant
            experiments.push(...this.getBucketedExperiments(_.objectValue('draft', this.config)));
        }

        return experiments;
    }

    /**
     * Retrieve bucketed experiments
     * @param group
     * @returns {*}
     */
    getBucketedExperiments(group) {
        if (this.getMainTrafficBucket() <= _.arrayValue('bucketed.max', group)) {
            for (let bucket of _.arrayValue('bucketed.buckets', group)) {
                if (this.getMainTrafficBucket() >= _.value('max', bucket) && this.getMainTrafficBucket() <= _.value('max', bucket)) {
                    return _.arrayValue('experiments', bucket);
                }
            }
        }

        return [];
    }

    /**
     * Go through each experiment and filters their variation to
     * reduce to 1 based on visitor bucket
     */
    filterVariationsWithBucket() {

    }

    /**
     * Check visitor view options and check if qualified for given experiment
     * @param experiment
     * @returns {boolean}
     */
    filterWithView(experiment) {
        let isQualifiedForView = this.qualifyView(experiment);

        this.options.debug && console.debug(debug.TARGETING_VIEW_CHECK);
        this.options.debug && console.debug(isQualifiedForView ? debug.TARGETING_VIEW_QUALIFIED : debug.TARGETING_VIEW_NOT_QUALIFIED);

        return isQualifiedForView;
    }

    /**
     * Check visitor audience options and check if qualified for given experiment
     * @param experiment
     * @returns {boolean}
     */
    filterWithAudience(experiment) {
        let isQualifiedForAudience = this.qualifyAudience(experiment);

        this.options.debug && console.debug(debug.TARGETING_AUDIENCE_CHECK);

        return isQualifiedForAudience;
    }

    /**
     * Qualify visitor for given experiment based on current view (URL)
     * @param experiment
     * @returns {boolean}
     */
    qualifyView(experiment) {
        const excludes = _.arrayValue('targeting.views.exclude', experiment);

        for (let i in excludes) {
            if (this.env.view.href.match(excludes[i]).toString()) {
                return false;
            }
        }

        const includes = _.arrayValue('targeting.views.include', experiment);

        if (includes != null && includes.length > 0) {
            if (includes[0] === '*' || includes[0] === '\*') {
                return true;
            }

            for (let i in includes) {
                if (this.env.view.href.match(includes[i].toString())) {
                    return true;
                }
            }
        } else {
            return true;
        }

        return false;
    }

    /**
     * Qualify visitor for given experiment based on audience
     * @returns {boolean}
     */
    qualifyAudience(experiment) {
        return false;
    }

    /**
     * Bucket number generator from 0 to 100
     * @returns {number}
     */
    generateTrafficBucket() {
        return Math.floor((Math.random() * 100));
    }

    /**
     * Retrieve or generate main traffic bucket for visitor
     * @returns {number}
     */
    getMainTrafficBucket() {
        let bucket = parseInt(_.inBrowser && localStorage.getItem(LOCAL_STORAGE_MAIN_TRAFFIC_BUCKET_KEY), 10);

        if (!bucket) {
            bucket = this.generateTrafficBucket();
            _.inBrowser && localStorage.setItem(LOCAL_STORAGE_MAIN_TRAFFIC_BUCKET_KEY, bucket);
        }

        return bucket;
    }

    /**
     * Check the DoNotTrack settings in user's browser
     * @returns {boolean}
     */
    checkDoNotTrackSetting() {
        // Firefox override
        if (window.navigator.doNotTrack == 'unspecified') {
            return false;
        }

        return window.navigator.doNotTrack || 0;
    }

    /**
     * Should the query params be forced?
     * @returns {boolean}
     */
    shouldForceQueryParams() {
        if (Object.keys(this.env.viewport.forcedQueryParams).length && this.env.viewport.forcedQueryParams.force) {
            this.options.debug && console.debug(debug.QUERY_PARAMS);

            return true;
        }

        return false;
    }

    /**
     * Get query parameters
     * @param url
     * @returns {object}
     */
    extractQueryParams(url) {
        if (!url) return {};

        const queryParams = Object(url.search.substr(1).split('&').filter(item => item.length));
        let params = {};

        for (var i = 0; i < queryParams.length; i++) {
            let [key, value] = queryParams[i].split('=');

            if (!isNaN(value)) {
                params[key] = Number(value);
            } else if (value == 'true' || value == 'false') {
                params[key] = value == 'true' ? true : false;
            } else {
                params[key] = value;
            }
        }

        return params;
    }
}

Object.assign(Testing.prototype, bucketing);

export default Testing;
